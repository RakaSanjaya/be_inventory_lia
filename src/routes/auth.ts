import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { User } from "../models/User.js";
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  decodeTokenExpiry,
} from "../utils/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { blacklistToken } from "../utils/tokenBlacklist.js";
import { SystemConfig } from "../models/SystemConfig.js";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
} from "../utils/validation.js";
import type { AppEnv } from "../types/env.js";

const auth = new Hono<AppEnv>();
const REFRESH_COOKIE_NAME = "inventory_refresh_token";
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const PUBLIC_REGISTER_ROLES = new Set(["staff", "student"]);

function setRefreshTokenCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
) {
  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearRefreshTokenCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, REFRESH_COOKIE_NAME, {
    path: "/api/auth",
  });
}

// Register
auth.post("/register", rateLimiter(5, 60_000), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = registerSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const { name, email, password, role, department, phone } = parsed.data;

    if (!PUBLIC_REGISTER_ROLES.has(role)) {
      return c.json(
        { error: "Role ini tidak dapat dibuat dari registrasi publik" },
        403,
      );
    }

    // Check if public registration is currently open
    const regConfig = await SystemConfig.findOne({
      key: "registrationEnabled",
    });
    if (regConfig && !Boolean(regConfig.value)) {
      return c.json(
        { error: "Pendaftaran akun baru sedang ditutup oleh administrator" },
        403,
      );
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return c.json({ error: "Email sudah terdaftar" }, 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || "staff",
      department,
      phone,
    });

    const token = generateToken(user._id.toString(), user.role);
    const refreshToken = generateRefreshToken(user._id.toString(), user.role);
    setRefreshTokenCookie(c, refreshToken);
    return c.json(
      {
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        },
      },
      201,
    );
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Login
auth.post("/login", rateLimiter(10, 60_000), async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const { email, password } = parsed.data;
    const user = await User.findOne({ email });
    if (!user) {
      return c.json({ error: "Email atau password salah" }, 401);
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return c.json({ error: "Email atau password salah" }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: "Akun dinonaktifkan" }, 403);
    }

    const token = generateToken(user._id.toString(), user.role);
    const refreshToken = generateRefreshToken(user._id.toString(), user.role);
    setRefreshTokenCookie(c, refreshToken);
    return c.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Refresh token
auth.post("/refresh", async (c) => {
  try {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      return c.json({ error: "Refresh token wajib diisi" }, 400);
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user || !user.isActive) {
      clearRefreshTokenCookie(c);
      return c.json({ error: "User tidak valid" }, 401);
    }

    const newToken = generateToken(user._id.toString(), user.role);
    const newRefreshToken = generateRefreshToken(
      user._id.toString(),
      user.role,
    );
    setRefreshTokenCookie(c, newRefreshToken);
    return c.json({ token: newToken });
  } catch {
    clearRefreshTokenCookie(c);
    return c.json({ error: "Refresh token tidak valid" }, 401);
  }
});

// Get current user
auth.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({ user });
});

// Update profile
auth.put("/profile", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { name, department, phone } = await c.req.json();

    const updates: Record<string, string> = {};
    if (name && typeof name === "string" && name.trim().length >= 2)
      updates.name = name.trim();
    if (department !== undefined) updates.department = department;
    if (phone !== undefined) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "Tidak ada data yang diubah" }, 400);
    }

    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
    }).select("-password");
    return c.json({ user });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Change password
auth.put("/change-password", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const raw = await c.req.json();
    const parsed = changePasswordSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }

    const user = await User.findById(userId);
    if (!user) return c.json({ error: "User tidak ditemukan" }, 404);

    const isMatch = await bcrypt.compare(
      parsed.data.currentPassword,
      user.password,
    );
    if (!isMatch) {
      return c.json({ error: "Password lama salah" }, 400);
    }

    user.password = await bcrypt.hash(parsed.data.newPassword, 10);
    await user.save();
    return c.json({ message: "Password berhasil diubah" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Logout
auth.post("/logout", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (token) {
      const expiry = decodeTokenExpiry(token);
      if (expiry) blacklistToken(token, expiry);
    }

    clearRefreshTokenCookie(c);
    return c.json({ message: "Berhasil logout" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default auth;
