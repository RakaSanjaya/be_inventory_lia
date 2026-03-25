import { Hono } from "hono";
import { Item } from "../models/Item.js";
import { StockTransaction } from "../models/StockTransaction.js";
import { AuditLog } from "../models/AuditLog.js";
import { Notification } from "../models/Notification.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { z } from "zod";
import type { AppEnv } from "../types/env.js";

const stock = new Hono<AppEnv>();
stock.use("*", authMiddleware);

// ─── Schemas ───────────────────────────────────────────
const stockInSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
});

const stockOutSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
});

const adjustmentSchema = z.object({
  itemId: z.string().min(1),
  newQuantity: z.number().int().min(0),
  newAvailableQty: z.number().int().min(0),
  reason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
});

const transferSchema = z.object({
  itemId: z.string().min(1),
  toLocationId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
});

// ─── Barang Masuk (Stock In) ───────────────────────────
stock.post("/in", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const body = await c.req.json();
    const data = stockInSchema.parse(body);
    const userId = c.get("userId");

    const item = await Item.findById(data.itemId);
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);

    const prevQty = item.quantity;
    const prevAvail = item.availableQty;

    item.quantity += data.quantity;
    item.availableQty += data.quantity;
    await item.save();

    await StockTransaction.create({
      item: item._id,
      type: "in",
      quantity: data.quantity,
      previousQty: prevQty,
      newQty: item.quantity,
      previousAvailableQty: prevAvail,
      newAvailableQty: item.availableQty,
      reason: data.reason,
      notes: data.notes,
      performedBy: userId,
    });

    await AuditLog.create({
      user: userId,
      action: "stock_in",
      targetModel: "Item",
      targetId: item._id,
      changes: {
        quantity: { from: prevQty, to: item.quantity },
        reason: data.reason,
      },
    });

    return c.json({ message: "Stok masuk berhasil dicatat", item });
  } catch (error: any) {
    if (error.name === "ZodError")
      return c.json({ error: error.issues[0].message }, 400);
    return c.json({ error: error.message }, 500);
  }
});

// ─── Barang Keluar (Stock Out) ─────────────────────────
stock.post("/out", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const body = await c.req.json();
    const data = stockOutSchema.parse(body);
    const userId = c.get("userId");

    const item = await Item.findOneAndUpdate(
      { _id: data.itemId, availableQty: { $gte: data.quantity } },
      { $inc: { quantity: -data.quantity, availableQty: -data.quantity } },
      { new: true },
    );

    if (!item) {
      const check = await Item.findById(data.itemId);
      if (!check) return c.json({ error: "Barang tidak ditemukan" }, 404);
      return c.json(
        { error: `Stok tidak mencukupi. Tersedia: ${check.availableQty}` },
        400,
      );
    }

    const prevQty = item.quantity + data.quantity;
    const prevAvail = item.availableQty + data.quantity;

    await StockTransaction.create({
      item: item._id,
      type: "out",
      quantity: data.quantity,
      previousQty: prevQty,
      newQty: item.quantity,
      previousAvailableQty: prevAvail,
      newAvailableQty: item.availableQty,
      reason: data.reason,
      notes: data.notes,
      performedBy: userId,
    });

    await AuditLog.create({
      user: userId,
      action: "stock_out",
      targetModel: "Item",
      targetId: item._id,
      changes: {
        quantity: { from: prevQty, to: item.quantity },
        reason: data.reason,
      },
    });

    // Low stock alert
    if (item.minStock && item.availableQty <= item.minStock) {
      await Notification.create({
        user: userId,
        title: "Stok Rendah",
        message: `${item.name} (${item.code}) sisa ${item.availableQty} unit, di bawah minimum ${item.minStock}`,
        type: "warning",
        relatedModel: "Item",
        relatedId: item._id,
      });
    }

    return c.json({ message: "Stok keluar berhasil dicatat", item });
  } catch (error: any) {
    if (error.name === "ZodError")
      return c.json({ error: error.issues[0].message }, 400);
    return c.json({ error: error.message }, 500);
  }
});

// ─── Stock Adjustment (Penyesuaian/Opname) ─────────────
stock.post("/adjustment", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const body = await c.req.json();
    const data = adjustmentSchema.parse(body);
    const userId = c.get("userId");

    const item = await Item.findById(data.itemId);
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);

    if (data.newAvailableQty > data.newQuantity) {
      return c.json(
        { error: "Stok tersedia tidak boleh lebih dari total stok" },
        400,
      );
    }

    const prevQty = item.quantity;
    const prevAvail = item.availableQty;
    const diff = data.newQuantity - prevQty;

    item.quantity = data.newQuantity;
    item.availableQty = data.newAvailableQty;
    await item.save();

    await StockTransaction.create({
      item: item._id,
      type: "adjustment",
      quantity: Math.abs(diff),
      previousQty: prevQty,
      newQty: item.quantity,
      previousAvailableQty: prevAvail,
      newAvailableQty: item.availableQty,
      reason: data.reason,
      notes: data.notes,
      performedBy: userId,
    });

    await AuditLog.create({
      user: userId,
      action: "stock_adjustment",
      targetModel: "Item",
      targetId: item._id,
      changes: {
        quantity: { from: prevQty, to: data.newQuantity },
        availableQty: { from: prevAvail, to: data.newAvailableQty },
        reason: data.reason,
      },
    });

    return c.json({ message: "Penyesuaian stok berhasil", item });
  } catch (error: any) {
    if (error.name === "ZodError")
      return c.json({ error: error.issues[0].message }, 400);
    return c.json({ error: error.message }, 500);
  }
});

// ─── Transfer Lokasi ───────────────────────────────────
stock.post("/transfer", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const body = await c.req.json();
    const data = transferSchema.parse(body);
    const userId = c.get("userId");

    const item = await Item.findById(data.itemId).populate(
      "location",
      "building room",
    );
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);

    if (item.location._id?.toString() === data.toLocationId) {
      return c.json(
        { error: "Lokasi tujuan sama dengan lokasi saat ini" },
        400,
      );
    }

    const fromLocationId = item.location._id || item.location;
    const prevQty = item.quantity;
    const prevAvail = item.availableQty;

    item.location = data.toLocationId as any;
    await item.save();

    await item.populate("location", "building room");

    await StockTransaction.create({
      item: item._id,
      type: "transfer",
      quantity: data.quantity,
      previousQty: prevQty,
      newQty: item.quantity,
      previousAvailableQty: prevAvail,
      newAvailableQty: item.availableQty,
      reason: data.reason,
      notes: data.notes,
      fromLocation: fromLocationId,
      toLocation: data.toLocationId,
      performedBy: userId,
    });

    await AuditLog.create({
      user: userId,
      action: "stock_transfer",
      targetModel: "Item",
      targetId: item._id,
      changes: {
        location: { from: fromLocationId, to: data.toLocationId },
        reason: data.reason,
      },
    });

    return c.json({ message: "Transfer lokasi berhasil", item });
  } catch (error: any) {
    if (error.name === "ZodError")
      return c.json({ error: error.issues[0].message }, 400);
    return c.json({ error: error.message }, 500);
  }
});

// ─── Riwayat Transaksi Stok ────────────────────────────
stock.get("/history", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const itemId = c.req.query("itemId") || "";
    const type = c.req.query("type") || "";
    const startDate = c.req.query("startDate") || "";
    const endDate = c.req.query("endDate") || "";

    const query: any = {};
    if (itemId) query.item = itemId;
    if (type) query.type = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const total = await StockTransaction.countDocuments(query);
    const transactions = await StockTransaction.find(query)
      .populate("item", "code name type")
      .populate("performedBy", "name email")
      .populate("fromLocation", "building room")
      .populate("toLocation", "building room")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    return c.json({
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── Riwayat per Item ──────────────────────────────────
stock.get("/history/:itemId", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const { itemId } = c.req.param();
    const transactions = await StockTransaction.find({ item: itemId })
      .populate("performedBy", "name email")
      .populate("fromLocation", "building room")
      .populate("toLocation", "building room")
      .sort({ createdAt: -1 })
      .limit(50);

    return c.json({ transactions });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── Summary per Item ──────────────────────────────────
stock.get("/summary/:itemId", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const { itemId } = c.req.param();
    const summary = await StockTransaction.aggregate([
      {
        $match: {
          item: new (await import("mongoose")).default.Types.ObjectId(itemId),
        },
      },
      {
        $group: {
          _id: "$type",
          totalQty: { $sum: "$quantity" },
          count: { $sum: 1 },
        },
      },
    ]);

    return c.json({ summary });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default stock;
