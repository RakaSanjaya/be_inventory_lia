import { Hono } from "hono";
import { Category } from "../models/Category.js";
import { Item } from "../models/Item.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { categorySchema } from "../utils/validation.js";

const categories = new Hono();
categories.use("*", authMiddleware);

categories.get("/", async (c) => {
  try {
    const list = await Category.find().sort({ name: 1 });
    return c.json({ categories: list });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

categories.post("/", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = categorySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const category = await Category.create(parsed.data);
    return c.json({ category }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

categories.put("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = categorySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const category = await Category.findByIdAndUpdate(
      c.req.param("id"),
      parsed.data,
      { new: true },
    );
    if (!category) return c.json({ error: "Kategori tidak ditemukan" }, 404);
    return c.json({ category });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

categories.delete("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const itemCount = await Item.countDocuments({ category: id });
    if (itemCount > 0) {
      return c.json(
        {
          error: `Tidak dapat menghapus kategori. Masih ada ${itemCount} barang yang menggunakan kategori ini.`,
        },
        400,
      );
    }
    const category = await Category.findByIdAndDelete(id);
    if (!category) return c.json({ error: "Kategori tidak ditemukan" }, 404);
    return c.json({ message: "Kategori berhasil dihapus" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default categories;
