import { Hono } from "hono";
import { Item } from "../models/Item.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { createItemSchema, updateItemSchema } from "../utils/validation.js";

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

    const query: any = {};
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

// Delete item
items.delete("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const item = await Item.findByIdAndDelete(c.req.param("id"));
    if (!item) return c.json({ error: "Barang tidak ditemukan" }, 404);
    return c.json({ message: "Barang berhasil dihapus" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default items;
