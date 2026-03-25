import { Hono } from "hono";
import { Item } from "../models/Item.js";
import { Borrowing } from "../models/Borrowing.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { createItemSchema, updateItemSchema } from "../utils/validation.js";
import QRCode from "qrcode";
import { parse } from "csv-parse/sync";

const items = new Hono();
items.use("*", authMiddleware);

// List items with filtering, search, pagination
items.get("/", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const search = c.req.query("search") || "";
    const type = c.req.query("type") || "";
    const category = c.req.query("category") || "";
    const condition = c.req.query("condition") || "";
    const location = c.req.query("location") || "";

    const includeArchived = c.req.query("includeArchived") === "true";

    const query: any = {};
    if (!includeArchived) query.isArchived = { $ne: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }
    if (type) query.type = type;
    if (category) query.category = category;
    if (condition) query.condition = condition;
    if (location) query.location = location;

    const total = await Item.countDocuments(query);
    const itemsList = await Item.find(query)
      .populate("category", "name")
      .populate("location", "building room shelf")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    return c.json({
      items: itemsList,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get low stock consumables
items.get("/low-stock", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const lowStockItems = await Item.find({
      type: "consumable",
      $expr: { $lte: ["$availableQty", "$minStock"] },
    })
      .populate("category", "name")
      .populate("location", "building room");
    return c.json({ items: lowStockItems });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get item detail
items.get("/:id", async (c) => {
  try {
    const item = await Item.findById(c.req.param("id"))
      .populate("category", "name")
      .populate("location", "building room shelf");
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ item });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Create item
items.post("/", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = createItemSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = parsed.data as any;
    data.availableQty = data.quantity;
    const item = await Item.create(data);
    return c.json({ item }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Update item
items.put("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = updateItemSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = parsed.data;
    const item = await Item.findByIdAndUpdate(c.req.param("id"), data, {
      new: true,
    });
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ item });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Archive item (soft delete)
items.put("/:id/archive", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const item = await Item.findByIdAndUpdate(
      c.req.param("id"),
      { isArchived: true },
      { new: true },
    );
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ item, message: "Barang berhasil diarsipkan" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Restore archived item
items.put("/:id/restore", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const item = await Item.findByIdAndUpdate(
      c.req.param("id"),
      { isArchived: false },
      { new: true },
    );
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ item, message: "Barang berhasil dikembalikan" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Hard delete (super_admin only)
items.delete("/:id", roleGuard("super_admin"), async (c) => {
  try {
    // Prevent deletion if there are active borrowings
    const activeBorrowings = await Borrowing.countDocuments({
      "items.item": c.req.param("id"),
      status: { $in: ["pending", "borrowed"] },
    });
    if (activeBorrowings > 0) {
      return c.json({ error: "Barang masih memiliki peminjaman aktif" }, 400);
    }
    const item = await Item.findByIdAndDelete(c.req.param("id"));
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ message: "Barang berhasil dihapus permanen" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Generate QR Code for item
items.get("/:id/qrcode", async (c) => {
  try {
    const item = await Item.findById(c.req.param("id"));
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);

    const format = c.req.query("format") || "png";
    const qrData = JSON.stringify({
      code: item.code,
      name: item.name,
      id: item._id,
    });

    if (format === "svg") {
      const svg = await QRCode.toString(qrData, { type: "svg", margin: 2 });
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg);
    }

    const dataUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
    });
    return c.json({
      qrCode: dataUrl,
      item: { code: item.code, name: item.name },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Bulk import from CSV
items.post("/bulk-import", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const body = await c.req.json();
    const csvText = body.csv;
    if (!csvText || typeof csvText !== "string") {
      return c.json({ error: "Data CSV wajib diisi" }, 400);
    }

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return c.json({ error: "CSV kosong atau format tidak valid" }, 400);
    }

    if (records.length > 500) {
      return c.json({ error: "Maksimal 500 baris per import" }, 400);
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < records.length; i++) {
      try {
        const row = records[i] as Record<string, string>;
        const parsed = createItemSchema.safeParse({
          code: row.code || row.kode,
          name: row.name || row.nama,
          description: row.description || row.deskripsi || "",
          category: row.category || row.kategori,
          type: row.type || row.tipe || "returnable",
          quantity: parseInt(row.quantity || row.jumlah || "0"),
          minStock: parseInt(row.minStock || row.min_stok || "0"),
          location: row.location || row.lokasi,
          condition: row.condition || row.kondisi || "good",
          price: parseFloat(row.price || row.harga || "0"),
          notes: row.notes || row.catatan || "",
        });

        if (!parsed.success) {
          results.failed++;
          results.errors.push(
            `Baris ${i + 2}: ${parsed.error.issues[0].message}`,
          );
          continue;
        }

        const data = parsed.data as any;
        data.availableQty = data.quantity;
        await Item.create(data);
        results.success++;
      } catch (err: any) {
        results.failed++;
        const msg = err.code === 11000 ? "Kode duplikat" : err.message;
        results.errors.push(`Baris ${i + 2}: ${msg}`);
      }
    }

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default items;
