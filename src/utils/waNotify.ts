import { User } from "../models/User.js";
import { SystemConfig } from "../models/SystemConfig.js";
import { whatsapp } from "../services/whatsapp.js";

/**
 * Default message templates with placeholder support.
 * Placeholders: {{appName}}, {{name}}, {{items}}, {{reason}}, {{days}}, {{count}}
 */
export const DEFAULT_TEMPLATES: Record<string, string> = {
  borrowing_approved:
    "✅ *Peminjaman Disetujui*\n\nHalo {{name}},\nPermintaan peminjaman Anda telah disetujui. Silakan ambil barang di tempat yang ditentukan.",
  borrowing_rejected:
    "❌ *Peminjaman Ditolak*\n\nHalo {{name}},\nPermintaan peminjaman Anda ditolak.\nAlasan: {{reason}}",
  borrowing_returned:
    "📦 *Pengembalian Berhasil*\n\nHalo {{name}},\nBarang pinjaman Anda telah dikonfirmasi pengembaliannya. Terima kasih!",
  consumable_approved:
    "✅ *Permintaan Disetujui*\n\nHalo {{name}},\nPermintaan barang habis pakai Anda telah disetujui. Barang akan segera disiapkan.",
  consumable_rejected:
    "❌ *Permintaan Ditolak*\n\nHalo {{name}},\nPermintaan barang habis pakai Anda ditolak.\nAlasan: {{reason}}",
  consumable_fulfilled:
    "📦 *Barang Siap Diambil*\n\nHalo {{name}},\nBarang habis pakai yang Anda minta telah diserahkan. Terima kasih!",
  new_request_admin:
    "📬 *{{appName}} - Permintaan Baru*\n\nAda permintaan baru dari {{name}} yang menunggu persetujuan.\nSilakan cek dashboard.",
  low_stock_admin:
    "⚠️ *{{appName}} - Stok Rendah*\n\n{{items}} sudah di bawah batas minimum stok. Segera lakukan pengadaan.",
  overdue_borrower:
    "⚠️ *{{appName}} - Pengingat Terlambat*\n\nHalo {{name}},\n\nPeminjaman Anda ({{items}}) sudah terlambat {{days}} hari. Segera kembalikan barang.\n\nTerima kasih.",
  overdue_admin:
    "📋 *{{appName}} - Ringkasan Harian*\n\nAda {{count}} peminjaman terlambat.\nSilakan cek dashboard untuk detail.",
};

/**
 * Get all message templates (custom + defaults merged).
 */
export async function getTemplates(): Promise<Record<string, string>> {
  try {
    const config = await SystemConfig.findOne({ key: "waTemplates" }).lean();
    const custom = (config?.value as unknown as Record<string, string>) || {};
    return { ...DEFAULT_TEMPLATES, ...custom };
  } catch {
    return { ...DEFAULT_TEMPLATES };
  }
}

/**
 * Get app name from SystemConfig, defaulting to "InvenTrack".
 */
export async function getAppName(): Promise<string> {
  try {
    const config = await SystemConfig.findOne({ key: "appName" }).lean();
    return config ? String(config.value) : "InvenTrack";
  } catch {
    return "InvenTrack";
  }
}

/**
 * Render a template with variable substitution.
 */
function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Send a WhatsApp message using a message template.
 * Fails silently — WA is "best effort".
 */
export async function sendWANotification(
  userId: string,
  templateKey: string,
  vars: Record<string, string> = {},
): Promise<void> {
  try {
    const config = await SystemConfig.findOne({ key: "whatsappEnabled" });
    if (!config || !config.value) {
      console.log(`[WA] Notification skipped (disabled): ${templateKey}`);
      return;
    }

    const user = await User.findById(userId).select("phone name").lean();
    if (!user?.phone) {
      console.log(
        `[WA] Notification skipped (no phone): ${templateKey} for user ${userId}`,
      );
      return;
    }

    const templates = await getTemplates();
    const appName = await getAppName();
    const template = templates[templateKey] || templateKey;
    const message = renderTemplate(template, {
      appName,
      name: user.name,
      ...vars,
    });

    const sent = await whatsapp.sendMessage(user.phone, message);
    if (sent) {
      console.log(`[WA] Sent ${templateKey} to ${user.name}`);
    } else {
      console.warn(
        `[WA] Failed to send ${templateKey} to ${user.name} (not connected?)`,
      );
    }
  } catch (err) {
    console.error(`[WA] Error sending ${templateKey}:`, err);
  }
}

/**
 * Send WA notification to all active admins.
 * Fails silently — WA is "best effort".
 */
export async function sendWAToAdmins(
  templateKey: string,
  vars: Record<string, string> = {},
): Promise<void> {
  try {
    const config = await SystemConfig.findOne({ key: "whatsappEnabled" });
    if (!config || !config.value) {
      console.log(`[WA] Admin notification skipped (disabled): ${templateKey}`);
      return;
    }

    const admins = await User.find({
      role: { $in: ["super_admin", "admin"] },
      isActive: true,
      phone: { $ne: "" },
    })
      .select("phone name")
      .lean();

    if (admins.length === 0) {
      console.log(
        `[WA] Admin notification skipped (no admins with phone): ${templateKey}`,
      );
      return;
    }

    const templates = await getTemplates();
    const appName = await getAppName();
    const template = templates[templateKey] || templateKey;

    for (const admin of admins) {
      if (!admin.phone) continue;
      const message = renderTemplate(template, {
        appName,
        name: admin.name,
        ...vars,
      });
      whatsapp
        .sendMessage(admin.phone, message)
        .then((sent) => {
          if (sent)
            console.log(`[WA] Sent ${templateKey} to admin ${admin.name}`);
          else
            console.warn(`[WA] Failed ${templateKey} to admin ${admin.name}`);
        })
        .catch((err) =>
          console.error(
            `[WA] Error ${templateKey} to admin ${admin.name}:`,
            err,
          ),
        );
    }
  } catch (err) {
    console.error(`[WA] Error sending admin notification ${templateKey}:`, err);
  }
}
