import { Hono } from "hono";
import { Item } from "../models/Item.js";
import { Borrowing } from "../models/Borrowing.js";
import { ConsumableRequest } from "../models/ConsumableRequest.js";
import { User } from "../models/User.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";

const dashboard = new Hono();
dashboard.use("*", authMiddleware);

// Summary stats
dashboard.get("/stats", async (c) => {
  try {
    const totalItems = await Item.countDocuments();
    const totalReturnable = await Item.countDocuments({ type: "returnable" });
    const totalConsumable = await Item.countDocuments({ type: "consumable" });
    const totalBorrowed = await Borrowing.countDocuments({
      status: "borrowed",
    });
    const totalOverdue = await Borrowing.countDocuments({
      status: "borrowed",
      expectedReturnDate: { $lt: new Date() },
    });
    const pendingApprovals = await Borrowing.countDocuments({
      status: "pending",
    });
    const pendingConsumable = await ConsumableRequest.countDocuments({
      status: "pending",
    });
    const totalUsers = await User.countDocuments();

    const damagedItems = await Item.countDocuments({ condition: "damaged" });
    const lowStockItems = await Item.countDocuments({
      type: "consumable",
      $expr: { $lte: ["$availableQty", "$minStock"] },
    });

    return c.json({
      stats: {
        totalItems,
        totalReturnable,
        totalConsumable,
        totalBorrowed,
        totalOverdue,
        pendingApprovals,
        pendingConsumable,
        totalUsers,
        damagedItems,
        lowStockItems,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Chart data: borrowings per month (last 12 months)
dashboard.get("/charts", async (c) => {
  try {
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);

    const monthlyBorrowings = await Borrowing.aggregate([
      { $match: { createdAt: { $gte: oneYearAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Top 10 most borrowed items
    const topItems = await Borrowing.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.item",
          totalBorrowed: { $sum: "$items.quantity" },
        },
      },
      { $sort: { totalBorrowed: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "items",
          localField: "_id",
          foreignField: "_id",
          as: "itemInfo",
        },
      },
      { $unwind: "$itemInfo" },
      {
        $project: {
          name: "$itemInfo.name",
          code: "$itemInfo.code",
          totalBorrowed: 1,
        },
      },
    ]);

    // Items by category
    const byCategory = await Item.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "cat",
        },
      },
      { $unwind: "$cat" },
      { $project: { name: "$cat.name", count: 1 } },
    ]);

    return c.json({ monthlyBorrowings, topItems, byCategory });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Recent activities
dashboard.get("/recent", async (c) => {
  try {
    const recentBorrowings = await Borrowing.find()
      .populate("borrower", "name")
      .populate("items.item", "name")
      .sort({ createdAt: -1 })
      .limit(10);

    const recentConsumable = await ConsumableRequest.find()
      .populate("requester", "name")
      .populate("items.item", "name")
      .sort({ createdAt: -1 })
      .limit(5);

    return c.json({ recentBorrowings, recentConsumable });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// CSV Export - inventory report
dashboard.get("/export/csv", roleGuard("super_admin", "admin"), async (c) => {
  try {
    const type = c.req.query("type") || "items";

    if (type === "items") {
      const items = await Item.find()
        .populate("category", "name")
        .populate("location", "building room")
        .lean();

      const header =
        "Kode,Nama,Kategori,Tipe,Jumlah,Tersedia,Min Stok,Lokasi,Kondisi,Harga\n";
      const rows = items
        .map((item: any) => {
          const catName = item.category?.name || "";
          const loc = item.location
            ? `${item.location.building} - ${item.location.room}`
            : "";
          return [
            `"${item.code}"`,
            `"${item.name}"`,
            `"${catName}"`,
            item.type,
            item.quantity,
            item.availableQty,
            item.minStock || 0,
            `"${loc}"`,
            item.condition,
            item.price || 0,
          ].join(",");
        })
        .join("\n");

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        "attachment; filename=inventory-report.csv",
      );
      return c.body("\uFEFF" + header + rows);
    }

    if (type === "borrowings") {
      const borrowings = await Borrowing.find()
        .populate("borrower", "name email department")
        .populate("items.item", "name code")
        .populate("approvedBy", "name")
        .sort({ createdAt: -1 })
        .lean();

      const header =
        "Tanggal,Peminjam,Departemen,Barang,Jumlah,Status,Tgl Kembali,Disetujui Oleh\n";
      const rows = borrowings
        .map((b: any) => {
          const itemsList = b.items
            .map((i: any) => `${i.item?.name || ""}(${i.quantity})`)
            .join("; ");
          return [
            new Date(b.createdAt).toLocaleDateString("id-ID"),
            `"${b.borrower?.name || ""}"`,
            `"${b.borrower?.department || ""}"`,
            `"${itemsList}"`,
            b.items.reduce((sum: number, i: any) => sum + i.quantity, 0),
            b.status,
            b.expectedReturnDate
              ? new Date(b.expectedReturnDate).toLocaleDateString("id-ID")
              : "",
            `"${b.approvedBy?.name || ""}"`,
          ].join(",");
        })
        .join("\n");

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        "attachment; filename=borrowings-report.csv",
      );
      return c.body("\uFEFF" + header + rows);
    }

    return c.json({ error: "Tipe export tidak valid" }, 400);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default dashboard;
