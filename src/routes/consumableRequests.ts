import { Hono } from "hono";
import { ConsumableRequest } from "../models/ConsumableRequest.js";
import { Item } from "../models/Item.js";
import { Notification } from "../models/Notification.js";
import { AuditLog } from "../models/AuditLog.js";
import { StockTransaction } from "../models/StockTransaction.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import {
  createConsumableRequestSchema,
  rejectSchema,
} from "../utils/validation.js";

const consumableRequests = new Hono();
consumableRequests.use("*", authMiddleware);

// List requests
consumableRequests.get("/", async (c) => {
  try {
    const userRole = c.get("userRole");
    const userId = c.get("userId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const status = c.req.query("status") || "";

    const query: any = {};
    if (!["super_admin", "admin"].includes(userRole)) {
      query.requester = userId;
    }
    if (status) query.status = status;

    const total = await ConsumableRequest.countDocuments(query);
    const list = await ConsumableRequest.find(query)
      .populate("requester", "name email department")
      .populate("items.item", "name code availableQty")
      .populate("approvedBy", "name")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    return c.json({
      requests: list,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Create request
consumableRequests.post("/", async (c) => {
  try {
    const userId = c.get("userId");
    const raw = await c.req.json();
    const parsed = createConsumableRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = parsed.data as any;
    data.requester = userId;

    // Check availability
    for (const ri of data.items) {
      const item = await Item.findById(ri.item);
      if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
      if (item.type !== "consumable")
        return c.json({ error: `${item.name} bukan barang habis pakai` }, 400);
      if (item.availableQty < ri.quantity) {
        return c.json(
          {
            error: `Stok ${item.name} tidak cukup (tersedia: ${item.availableQty})`,
          },
          400,
        );
      }
    }

    const request = await ConsumableRequest.create(data);
    return c.json({ request }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Approve request
consumableRequests.put(
  "/:id/approve",
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const userId = c.get("userId");
      const request = await ConsumableRequest.findById(c.req.param("id"));
      if (!request) return c.json({ error: "Permintaan tidak ditemukan" }, 404);
      if (request.status !== "pending")
        return c.json({ error: "Status tidak valid" }, 400);

      request.status = "approved";
      request.approvedBy = userId as any;
      request.approvedAt = new Date();
      await request.save();

      await Notification.create({
        user: request.requester,
        title: "Permintaan Disetujui",
        message: "Permintaan barang habis pakai Anda telah disetujui.",
        type: "success",
        relatedModel: "ConsumableRequest",
        relatedId: request._id,
      });

      await AuditLog.create({
        user: userId,
        action: "approve_consumable",
        targetModel: "ConsumableRequest",
        targetId: request._id,
        changes: { status: "approved" },
      });

      return c.json({ request });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// Reject request
consumableRequests.put(
  "/:id/reject",
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const raw = await c.req.json();
      const parsed = rejectSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0].message }, 400);
      }
      const { notes } = parsed.data;
      const request = await ConsumableRequest.findById(c.req.param("id"));
      if (!request) return c.json({ error: "Permintaan tidak ditemukan" }, 404);
      if (request.status !== "pending")
        return c.json({ error: "Status tidak valid" }, 400);

      request.status = "rejected";
      request.notes = notes;
      await request.save();

      await AuditLog.create({
        user: c.get("userId"),
        action: "reject_consumable",
        targetModel: "ConsumableRequest",
        targetId: request._id,
        changes: { status: "rejected", reason: notes },
      });

      return c.json({ request });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// Fulfill request (reduce stock)
consumableRequests.put(
  "/:id/fulfill",
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const request = await ConsumableRequest.findById(c.req.param("id"));
      if (!request) return c.json({ error: "Permintaan tidak ditemukan" }, 404);
      if (request.status !== "approved")
        return c.json({ error: "Harus disetujui terlebih dahulu" }, 400);

      // Atomically reduce stock with floor check to prevent negative stock
      for (const ri of request.items) {
        const before = await Item.findById(ri.item);
        const result = await Item.findOneAndUpdate(
          { _id: ri.item, availableQty: { $gte: ri.quantity } },
          { $inc: { availableQty: -ri.quantity, quantity: -ri.quantity } },
          { new: true },
        );
        if (result && before) {
          await StockTransaction.create({
            item: ri.item,
            type: "consume",
            quantity: ri.quantity,
            previousQty: before.quantity,
            newQty: result.quantity,
            previousAvailableQty: before.availableQty,
            newAvailableQty: result.availableQty,
            reason: "Permintaan habis pakai dipenuhi",
            reference: { model: "ConsumableRequest", id: request._id },
            performedBy: c.get("userId" as any),
          });
        }
        if (!result) {
          // Rollback previous decrements
          const idx = request.items.indexOf(ri);
          for (let i = 0; i < idx; i++) {
            const prev = request.items[i];
            await Item.findByIdAndUpdate(prev.item, {
              $inc: { availableQty: prev.quantity, quantity: prev.quantity },
            });
          }
          const item = await Item.findById(ri.item);
          return c.json(
            { error: `Stok ${item?.name || "barang"} tidak cukup` },
            400,
          );
        }
      }

      request.status = "fulfilled";
      request.fulfilledAt = new Date();
      await request.save();

      await AuditLog.create({
        user: c.get("userId"),
        action: "fulfill_consumable",
        targetModel: "ConsumableRequest",
        targetId: request._id,
        changes: { status: "fulfilled" },
      });

      return c.json({ request });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

export default consumableRequests;
