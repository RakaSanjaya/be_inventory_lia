import { Hono } from "hono";
import { Location } from "../models/Location.js";
import { Item } from "../models/Item.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { locationSchema } from "../utils/validation.js";

const locations = new Hono();
locations.use("*", authMiddleware);

locations.get("/", async (c) => {
  try {
    const list = await Location.find().sort({ building: 1, room: 1 });
    return c.json({ locations: list });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

locations.post("/", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = locationSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const location = await Location.create(parsed.data);
    return c.json({ location }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

locations.put("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = locationSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const location = await Location.findByIdAndUpdate(
      c.req.param("id"),
      parsed.data,
      { new: true },
    );
    if (!location) return c.json({ error: "Lokasi tidak ditemukan" }, 404);
    return c.json({ location });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

locations.delete("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const itemCount = await Item.countDocuments({ location: id });
    if (itemCount > 0) {
      return c.json(
        {
          error: `Tidak dapat menghapus lokasi. Masih ada ${itemCount} barang di lokasi ini.`,
        },
        400,
      );
    }
    const location = await Location.findByIdAndDelete(id);
    if (!location) return c.json({ error: "Lokasi tidak ditemukan" }, 404);
    return c.json({ message: "Lokasi berhasil dihapus" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default locations;
