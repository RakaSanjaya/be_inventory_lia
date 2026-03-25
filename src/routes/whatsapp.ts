import { Hono } from "hono";
import { authMiddleware, roleGuard } from "../middleware/auth.js";
import { whatsapp } from "../services/whatsapp.js";
import { SystemConfig } from "../models/SystemConfig.js";
import {
  DEFAULT_TEMPLATES,
  getTemplates,
  getAppName,
} from "../utils/waNotify.js";
import QRCode from "qrcode";
import type { AppEnv } from "../types/env.js";

const wa = new Hono<AppEnv>();
wa.use("*", authMiddleware);
wa.use("*", roleGuard("super_admin", "admin"));

// Get WhatsApp connection status
wa.get("/status", async (c) => {
  const config = await SystemConfig.findOne({ key: "whatsappEnabled" });
  return c.json({
    status: whatsapp.getStatus(),
    enabled: config ? Boolean(config.value) : false,
  });
});

// Get QR code for pairing
wa.get("/qr", async (c) => {
  const rawQR = whatsapp.getQR();
  if (!rawQR) {
    return c.json({
      qr: null,
      message:
        whatsapp.getStatus() === "connected"
          ? "Sudah terhubung"
          : "QR belum tersedia. Mulai koneksi terlebih dahulu.",
    });
  }

  // Convert QR string to data URL for display
  const dataUrl = await QRCode.toDataURL(rawQR, { width: 300, margin: 2 });
  return c.json({ qr: dataUrl });
});

// Connect to WhatsApp
wa.post("/connect", async (c) => {
  if (whatsapp.getStatus() === "connected") {
    return c.json({ message: "Sudah terhubung" });
  }
  whatsapp.connect();
  return c.json({ message: "Memulai koneksi WhatsApp..." });
});

// Disconnect WhatsApp
wa.post("/disconnect", async (c) => {
  await whatsapp.disconnect();
  return c.json({ message: "WhatsApp terputus dan sesi dihapus" });
});

// Toggle WA notifications on/off
wa.put("/toggle", async (c) => {
  const { enabled } = await c.req.json();
  await SystemConfig.findOneAndUpdate(
    { key: "whatsappEnabled" },
    { value: Boolean(enabled), updatedBy: c.get("userId") },
    { upsert: true },
  );
  return c.json({ enabled: Boolean(enabled) });
});

// Send test message
wa.post("/test", async (c) => {
  const { phone } = await c.req.json();
  if (!phone) return c.json({ error: "Nomor telepon wajib diisi" }, 400);
  const appName = await getAppName();
  const ok = await whatsapp.sendMessage(
    phone,
    `✅ Ini adalah pesan test dari ${appName}. WhatsApp notifikasi sudah terhubung!`,
  );
  if (!ok) {
    return c.json(
      { error: "Gagal mengirim. Pastikan WhatsApp terhubung." },
      500,
    );
  }
  return c.json({ message: "Pesan test berhasil dikirim" });
});

// Get message templates (defaults + custom overrides)
wa.get("/templates", async (c) => {
  const templates = await getTemplates();
  return c.json({ templates, defaults: DEFAULT_TEMPLATES });
});

// Update message templates
wa.put("/templates", async (c) => {
  const { templates } = await c.req.json();
  if (!templates || typeof templates !== "object") {
    return c.json({ error: "Format template tidak valid" }, 400);
  }

  // Only save non-empty templates that differ from defaults
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(templates)) {
    if (
      typeof value === "string" &&
      value.trim() &&
      value !== DEFAULT_TEMPLATES[key]
    ) {
      custom[key] = value;
    }
  }

  await SystemConfig.findOneAndUpdate(
    { key: "waTemplates" },
    { value: custom, updatedBy: c.get("userId") },
    { upsert: true },
  );

  const merged = await getTemplates();
  return c.json({ templates: merged });
});

export default wa;
