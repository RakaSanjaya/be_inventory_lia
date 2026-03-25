import { Hono } from "hono";
import { Notification } from "../models/Notification.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types/env.js";

const notifications = new Hono<AppEnv>();
notifications.use("*", authMiddleware);

notifications.get("/unread-count", async (c) => {
  try {
    const userId = c.get("userId");
    const unreadCount = await Notification.countDocuments({
      user: userId,
      isRead: false,
    });
    return c.json({ unreadCount });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

notifications.get("/", async (c) => {
  try {
    const userId = c.get("userId");
    const list = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50);
    const unreadCount = await Notification.countDocuments({
      user: userId,
      isRead: false,
    });
    return c.json({ notifications: list, unreadCount });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

notifications.put("/:id/read", async (c) => {
  try {
    const userId = c.get("userId");
    const notification = await Notification.findById(c.req.param("id"));
    if (!notification)
      return c.json({ error: "Notifikasi tidak ditemukan" }, 404);
    if (notification.user.toString() !== userId) {
      return c.json({ error: "Akses ditolak" }, 403);
    }
    notification.isRead = true;
    await notification.save();
    return c.json({ message: "Notifikasi dibaca" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

notifications.put("/read-all", async (c) => {
  try {
    const userId = c.get("userId");
    await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true },
    );
    return c.json({ message: "Semua notifikasi dibaca" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default notifications;
