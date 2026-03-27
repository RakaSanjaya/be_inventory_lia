import { Hono } from "hono";
import { Borrowing } from "../models/Borrowing.js";
import { Item } from "../models/Item.js";
import { User } from "../models/User.js";
import { Notification } from "../models/Notification.js";
import { AuditLog } from "../models/AuditLog.js";
import { StockTransaction } from "../models/StockTransaction.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import {
  createBorrowingSchema,
  rejectSchema,
  returnBorrowingSchema,
} from "../utils/validation.js";
import { sendWANotification, sendWAToAdmins } from "../utils/waNotify.js";
import type { AppEnv } from "../types/env.js";

const borrowings = new Hono<AppEnv>();
borrowings.use("*", authMiddleware);

// List all borrowings (admin)
borrowings.get("/", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const status = c.req.query("status") || "";
    const search = c.req.query("search") || "";
    const startDate = c.req.query("startDate") || "";
    const endDate = c.req.query("endDate") || "";

    const query: any = {};
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // If search, first find matching user IDs by name
    if (search) {
      const matchingUsers = await User.find({
        name: { $regex: search, $options: "i" },
      }).select("_id");
      query.borrower = { $in: matchingUsers.map((u) => u._id) };
    }

    const total = await Borrowing.countDocuments(query);
    const list = await Borrowing.find(query)
      .populate("borrower", "name email department")
      .populate("items.item", "name code")
      .populate("approvedBy", "name")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    return c.json({
      borrowings: list,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// My borrowings
borrowings.get("/my", async (c) => {
  try {
    const userId = c.get("userId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const status = c.req.query("status") || "";

    const query: any = { borrower: userId };
    if (status) query.status = status;

    const total = await Borrowing.countDocuments(query);
    const list = await Borrowing.find(query)
      .populate("items.item", "name code")
      .populate("approvedBy", "name")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return c.json({
      borrowings: list,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Overdue borrowings
borrowings.get("/overdue", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const list = await Borrowing.find({
      status: "borrowed",
      expectedReturnDate: { $lt: new Date() },
    })
      .populate("borrower", "name email department")
      .populate("items.item", "name code")
      .sort({ expectedReturnDate: 1 });
    return c.json({ borrowings: list });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get borrowing detail
borrowings.get("/:id", async (c) => {
  try {
    const borrowing = await Borrowing.findById(c.req.param("id"))
      .populate("borrower", "name email department phone")
      .populate("items.item", "name code type condition")
      .populate("approvedBy", "name");
    if (!borrowing) return c.json({ error: "Peminjaman tidak ditemukan" }, 404);

    // Non-admin users can only view their own borrowings
    const userRole = c.get("userRole");
    const userId = c.get("userId");
    if (
      userRole !== "super_admin" &&
      userRole !== "admin" &&
      (borrowing.borrower as any)?._id?.toString() !== userId
    ) {
      return c.json({ error: "Akses ditolak" }, 403);
    }

    return c.json({ borrowing });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Create borrowing request
borrowings.post("/", async (c) => {
  try {
    const userId = c.get("userId");
    const raw = await c.req.json();
    const parsed = createBorrowingSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = parsed.data as any;
    data.borrower = userId;

    // Check availability
    for (const bi of data.items) {
      const item = await Item.findById(bi.item);
      if (!item) return c.json({ error: `Barang tidak ditemukan` }, 404);
      if (item.availableQty < bi.quantity) {
        return c.json(
          {
            error: `Stok ${item.name} tidak cukup (tersedia: ${item.availableQty})`,
          },
          400,
        );
      }
    }

    const borrowing = await Borrowing.create(data);
    return c.json({ borrowing }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Bulk approve
borrowings.put(
  "/bulk/approve",
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const userId = c.get("userId");
      const { ids } = await c.req.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: "ID peminjaman wajib diisi" }, 400);
      }

      const results = { success: 0, failed: 0, errors: [] as string[] };

      for (const id of ids) {
        try {
          const borrowing = await Borrowing.findById(id);
          if (!borrowing || borrowing.status !== "pending") {
            results.failed++;
            continue;
          }

          let stockOk = true;
          for (const bi of borrowing.items) {
            const before = await Item.findById(bi.item);
            const result = await Item.findOneAndUpdate(
              { _id: bi.item, availableQty: { $gte: bi.quantity } },
              { $inc: { availableQty: -bi.quantity } },
              { new: true },
            );
            if (!result) {
              // Rollback
              const idx = borrowing.items.indexOf(bi);
              for (let i = 0; i < idx; i++) {
                await Item.findByIdAndUpdate(borrowing.items[i].item, {
                  $inc: { availableQty: borrowing.items[i].quantity },
                });
              }
              stockOk = false;
              break;
            }
            try {
              await StockTransaction.create({
                item: bi.item,
                type: "borrow",
                quantity: bi.quantity,
                previousQty: before?.quantity ?? 0,
                newQty: result.quantity ?? 0,
                previousAvailableQty: before?.availableQty ?? 0,
                newAvailableQty: result.availableQty ?? 0,
                reason: "Peminjaman disetujui (bulk)",
                reference: { model: "Borrowing", id: borrowing._id },
                performedBy: userId,
              });
            } catch (txErr) {
              console.error("[StockTransaction] bulk borrow log error:", txErr);
            }
          }

          if (!stockOk) {
            results.failed++;
            continue;
          }

          borrowing.status = "borrowed";
          borrowing.approvedBy = userId as any;
          borrowing.approvedAt = new Date();
          await borrowing.save();

          await Notification.create({
            user: borrowing.borrower,
            title: "Peminjaman Disetujui",
            message: "Permintaan peminjaman Anda telah disetujui.",
            type: "success",
            relatedModel: "Borrowing",
            relatedId: borrowing._id,
          });

          // WhatsApp notification
          sendWANotification(
            borrowing.borrower.toString(),
            "borrowing_approved",
          );

          results.success++;
        } catch {
          results.failed++;
        }
      }

      return c.json(results);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// Bulk reject
borrowings.put("/bulk/reject", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const { ids, notes } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ID peminjaman wajib diisi" }, 400);
    }

    const results = { success: 0, failed: 0 };

    for (const id of ids) {
      try {
        const borrowing = await Borrowing.findById(id);
        if (!borrowing || borrowing.status !== "pending") {
          results.failed++;
          continue;
        }

        borrowing.status = "rejected";
        borrowing.notes = notes || "Ditolak secara massal";
        await borrowing.save();

        await Notification.create({
          user: borrowing.borrower,
          title: "Peminjaman Ditolak",
          message: `Permintaan peminjaman Anda ditolak. ${notes || ""}`,
          type: "error",
          relatedModel: "Borrowing",
          relatedId: borrowing._id,
        });

        // WhatsApp notification
        sendWANotification(
          borrowing.borrower.toString(),
          "borrowing_rejected",
          {
            reason: notes || "Ditolak secara massal",
          },
        );

        results.success++;
      } catch {
        results.failed++;
      }
    }

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Approve borrowing
borrowings.put("/:id/approve", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const userId = c.get("userId");
    const borrowing = await Borrowing.findById(c.req.param("id"));
    if (!borrowing) return c.json({ error: "Peminjaman tidak ditemukan" }, 404);
    if (borrowing.status !== "pending")
      return c.json({ error: "Status tidak valid" }, 400);

    // Atomically reduce available qty with floor check to prevent negative stock
    for (const bi of borrowing.items) {
      const before = await Item.findById(bi.item);
      const result = await Item.findOneAndUpdate(
        { _id: bi.item, availableQty: { $gte: bi.quantity } },
        { $inc: { availableQty: -bi.quantity } },
        { new: true },
      );
      if (result) {
        try {
          await StockTransaction.create({
            item: bi.item,
            type: "borrow",
            quantity: bi.quantity,
            previousQty: before?.quantity ?? 0,
            newQty: result.quantity ?? 0,
            previousAvailableQty: before?.availableQty ?? 0,
            newAvailableQty: result.availableQty ?? 0,
            reason: "Peminjaman disetujui",
            reference: { model: "Borrowing", id: borrowing._id },
            performedBy: userId,
          });
        } catch (txErr) {
          console.error("[StockTransaction] borrow log error:", txErr);
        }
      }
      if (!result) {
        // Rollback previous decrements
        const idx = borrowing.items.indexOf(bi);
        for (let i = 0; i < idx; i++) {
          await Item.findByIdAndUpdate(borrowing.items[i].item, {
            $inc: { availableQty: borrowing.items[i].quantity },
          });
        }
        const item = await Item.findById(bi.item);
        return c.json(
          { error: `Stok ${item?.name || "barang"} tidak cukup` },
          400,
        );
      }
    }

    borrowing.status = "borrowed";
    borrowing.approvedBy = userId as any;
    borrowing.approvedAt = new Date();
    await borrowing.save();

    // Create notification
    await Notification.create({
      user: borrowing.borrower,
      title: "Peminjaman Disetujui",
      message: "Permintaan peminjaman Anda telah disetujui.",
      type: "success",
      relatedModel: "Borrowing",
      relatedId: borrowing._id,
    });

    // WhatsApp notification
    sendWANotification(borrowing.borrower.toString(), "borrowing_approved");

    await AuditLog.create({
      user: userId,
      action: "approve_borrowing",
      targetModel: "Borrowing",
      targetId: borrowing._id,
      changes: { status: "borrowed", items: borrowing.items.length },
    });

    return c.json({ borrowing });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Reject borrowing
borrowings.put("/:id/reject", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = rejectSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const { notes } = parsed.data;
    const borrowing = await Borrowing.findById(c.req.param("id"));
    if (!borrowing) return c.json({ error: "Peminjaman tidak ditemukan" }, 404);
    if (borrowing.status !== "pending")
      return c.json({ error: "Status tidak valid" }, 400);

    borrowing.status = "rejected";
    borrowing.notes = notes;
    await borrowing.save();

    await Notification.create({
      user: borrowing.borrower,
      title: "Peminjaman Ditolak",
      message: `Permintaan peminjaman Anda ditolak. ${notes || ""}`,
      type: "error",
      relatedModel: "Borrowing",
      relatedId: borrowing._id,
    });

    // WhatsApp notification
    sendWANotification(borrowing.borrower.toString(), "borrowing_rejected", {
      reason: notes,
    });

    await AuditLog.create({
      user: c.get("userId"),
      action: "reject_borrowing",
      targetModel: "Borrowing",
      targetId: borrowing._id,
      changes: { status: "rejected", reason: notes },
    });

    return c.json({ borrowing });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Process return
borrowings.put("/:id/return", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = returnBorrowingSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = parsed.data;
    const borrowing = await Borrowing.findById(c.req.param("id"));
    if (!borrowing) return c.json({ error: "Peminjaman tidak ditemukan" }, 404);
    if (borrowing.status !== "borrowed" && borrowing.status !== "overdue") {
      return c.json({ error: "Status tidak valid untuk pengembalian" }, 400);
    }

    // Update returned quantities and return stock
    for (const returnItem of data.items) {
      const bi = borrowing.items.find(
        (b) => b.item.toString() === returnItem.itemId,
      );
      if (bi) {
        const before = await Item.findById(bi.item);
        bi.returnedQty = returnItem.returnedQty;
        bi.conditionOnReturn = returnItem.condition;
        await Item.findByIdAndUpdate(bi.item, {
          $inc: { availableQty: returnItem.returnedQty },
          ...(returnItem.condition === "damaged"
            ? { condition: "damaged" }
            : {}),
        });
        try {
          await StockTransaction.create({
            item: bi.item,
            type: "return",
            quantity: returnItem.returnedQty,
            previousQty: before?.quantity ?? 0,
            newQty: before?.quantity ?? 0,
            previousAvailableQty: before?.availableQty ?? 0,
            newAvailableQty:
              (before?.availableQty ?? 0) + returnItem.returnedQty,
            reason: `Pengembalian barang${returnItem.condition === "damaged" ? " (rusak)" : ""}`,
            reference: { model: "Borrowing", id: borrowing._id },
            performedBy: c.get("userId"),
          });
        } catch (txErr) {
          console.error("[StockTransaction] return log error:", txErr);
        }
      }
    }

    borrowing.status = "returned";
    borrowing.actualReturnDate = new Date();
    borrowing.returnNotes = data.returnNotes;
    await borrowing.save();

    await Notification.create({
      user: borrowing.borrower,
      title: "Pengembalian Berhasil",
      message: "Barang pinjaman Anda telah berhasil dikembalikan.",
      type: "success",
      relatedModel: "Borrowing",
      relatedId: borrowing._id,
    });

    // WhatsApp notification
    sendWANotification(borrowing.borrower.toString(), "borrowing_returned");

    await AuditLog.create({
      user: c.get("userId"),
      action: "return_borrowing",
      targetModel: "Borrowing",
      targetId: borrowing._id,
      changes: { status: "returned", returnNotes: data.returnNotes },
    });

    return c.json({ borrowing });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default borrowings;
