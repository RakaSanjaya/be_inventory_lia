import { Borrowing } from "../models/Borrowing.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { SystemConfig } from "../models/SystemConfig.js";
import { whatsapp } from "../services/whatsapp.js";
import { getTemplates, getAppName } from "../utils/waNotify.js";

const ONE_MINUTE = 60_000;
const INTERVAL = 30 * ONE_MINUTE; // Run every 30 minutes

async function checkOverdue() {
  try {
    const now = new Date();

    // Find borrowed items past their expected return date
    const overdueBorrowings = await Borrowing.find({
      status: "borrowed",
      expectedReturnDate: { $lt: now },
    })
      .populate("borrower", "name email phone")
      .populate("items.item", "name code");

    if (overdueBorrowings.length === 0) return;

    // Check if WA notifications are enabled
    const waConfig = await SystemConfig.findOne({ key: "whatsappEnabled" });
    const waEnabled = waConfig ? Boolean(waConfig.value) : false;
    const templates = waEnabled ? await getTemplates() : {};
    const appName = waEnabled ? await getAppName() : "InvenTrack";

    for (const b of overdueBorrowings) {
      // Update status to overdue if not already
      if (b.status !== ("overdue" as any)) {
        b.status = "overdue" as any;
        await b.save();
      }

      const borrower = b.borrower as any;
      if (!borrower?._id) continue;

      // Check if we already sent an overdue notification today
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const existing = await Notification.findOne({
        user: borrower._id,
        title: "Peminjaman Terlambat",
        relatedId: b._id,
        createdAt: { $gte: todayStart },
      });
      if (existing) continue;

      const itemNames = b.items
        .map((i: any) => (typeof i.item === "object" ? i.item.name : "Barang"))
        .join(", ");

      const daysLate = Math.ceil(
        (now.getTime() - new Date(b.expectedReturnDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      const message = `Peminjaman Anda (${itemNames}) sudah terlambat ${daysLate} hari. Segera kembalikan barang.`;

      // In-app notification
      await Notification.create({
        user: borrower._id,
        title: "Peminjaman Terlambat",
        message,
        type: "warning",
        relatedModel: "Borrowing",
        relatedId: b._id,
      });

      // WhatsApp notification
      if (waEnabled && borrower.phone) {
        const tpl = templates["overdue_borrower"] || "";
        const waText = tpl
          .replace(/\{\{name\}\}/g, borrower.name || "")
          .replace(/\{\{items\}\}/g, itemNames)
          .replace(/\{\{days\}\}/g, String(daysLate))
          .replace(/\{\{appName\}\}/g, appName);
        whatsapp.sendMessage(borrower.phone, waText).catch(() => {});
      }
    }

    // Notify admins about total overdue
    if (overdueBorrowings.length > 0) {
      const admins = await User.find({
        role: { $in: ["super_admin", "admin"] },
        isActive: true,
      });

      for (const admin of admins) {
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const existing = await Notification.findOne({
          user: admin._id,
          title: "Ringkasan Peminjaman Terlambat",
          createdAt: { $gte: todayStart },
        });
        if (existing) continue;

        await Notification.create({
          user: admin._id,
          title: "Ringkasan Peminjaman Terlambat",
          message: `Ada ${overdueBorrowings.length} peminjaman yang terlambat dikembalikan hari ini.`,
          type: "warning",
        });

        if (waEnabled && admin.phone) {
          const tpl = templates["overdue_admin"] || "";
          const text = tpl
            .replace(/\{\{count\}\}/g, String(overdueBorrowings.length))
            .replace(/\{\{appName\}\}/g, appName);
          whatsapp.sendMessage(admin.phone, text).catch(() => {});
        }
      }
    }

    console.log(
      `[CRON] Overdue check complete. Found ${overdueBorrowings.length} overdue.`,
    );
  } catch (err) {
    console.error("[CRON] Overdue check error:", err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startOverdueCron() {
  if (intervalId) return;
  console.log("[CRON] Overdue checker started (every 30 min)");
  // Run once immediately, then on interval
  checkOverdue();
  intervalId = setInterval(checkOverdue, INTERVAL);
}

export function stopOverdueCron() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
