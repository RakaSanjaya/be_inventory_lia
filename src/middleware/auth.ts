import { Context, Next } from "hono";
import { verifyToken } from "../utils/jwt.js";
import { User } from "../models/User.js";
import { isTokenBlacklisted } from "../utils/tokenBlacklist.js";
import type { AppEnv } from "../types/env.js";

export const authMiddleware = async (c: Context<AppEnv>, next: Next) => {
  try {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Token tidak ditemukan" }, 401);
    }

    const token = authHeader.split(" ")[1];

    if (isTokenBlacklisted(token)) {
      return c.json({ error: "Token sudah tidak valid" }, 401);
    }

    const decoded = verifyToken(token);

    const user = await User.findById(decoded.userId).select("-password");
    if (!user || !user.isActive) {
      return c.json({ error: "User tidak valid" }, 401);
    }

    c.set("user", user);
    c.set("userId", user._id.toString());
    c.set("userRole", user.role);
    await next();
  } catch (error) {
    return c.json({ error: "Token tidak valid" }, 401);
  }
};

export const roleGuard = (...roles: string[]) => {
  return async (c: Context<AppEnv>, next: Next) => {
    const userRole = c.get("userRole");
    if (!roles.includes(userRole)) {
      return c.json({ error: "Akses ditolak" }, 403);
    }
    await next();
  };
};
