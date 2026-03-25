import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Borrowing } from "../models/Borrowing.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { updateUserSchema } from "../utils/validation.js";

const users = new Hono();
users.use("*", authMiddleware);

// List users (admin only)
users.get("/", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const search = c.req.query("search") || "";
    const role = c.req.query("role") || "";

    const query: any = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (role) query.role = role;

    const total = await User.countDocuments(query);
    const usersList = await User.find(query)
      .select("-password")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    return c.json({
      users: usersList,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get user by ID
users.get("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const user = await User.findById(c.req.param("id")).select("-password");
    if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
    return c.json({ user });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Update user
users.put("/:id", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = updateUserSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const data = { ...parsed.data } as any;

    // Only super_admin can change roles
    const currentRole = c.get("userRole");
    if (data.role && currentRole !== "super_admin") {
      delete data.role;
    }

    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }
    const user = await User.findByIdAndUpdate(c.req.param("id"), data, {
      new: true,
    }).select("-password");
    if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
    return c.json({ user });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Delete user
users.delete("/:id", roleGuard("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const activeBorrowings = await Borrowing.countDocuments({
      borrower: id,
      status: { $in: ["pending", "approved", "borrowed"] },
    });
    if (activeBorrowings > 0) {
      return c.json(
        {
          error: `Tidak dapat menghapus user. Masih ada ${activeBorrowings} peminjaman aktif.`,
        },
        400,
      );
    }
    const user = await User.findByIdAndDelete(id);
    if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
    return c.json({ message: "User berhasil dihapus" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default users;
