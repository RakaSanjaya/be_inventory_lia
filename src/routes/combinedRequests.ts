import { Hono } from "hono";
import { z } from "zod";
import { Borrowing } from "../models/Borrowing.js";
import { ConsumableRequest } from "../models/ConsumableRequest.js";
import { Item } from "../models/Item.js";
import { Notification } from "../models/Notification.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types/env.js";

const combinedRequestSchema = z.object({
  borrowItems: z
    .array(
      z.object({
        item: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .optional()
    .default([]),
  consumableItems: z
    .array(
      z.object({
        item: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .optional()
    .default([]),
  purpose: z.string().min(1, "Keperluan wajib diisi").max(500),
  notes: z.string().max(500).optional(),
  expectedReturnDate: z.string().optional(),
});

const combinedRequests = new Hono<AppEnv>();
combinedRequests.use("*", authMiddleware);

/**
 * POST /api/combined-requests
 * Submit satu form yang mengandung:
 *   borrowItems: [{ item, quantity, expectedReturnDate }]
 *   consumableItems: [{ item, quantity }]
 *   purpose: string
 *   notes?: string
 *
 * Akan membuat:
 *   - 1 Borrowing (jika ada borrowItems)
 *   - 1 ConsumableRequest (jika ada consumableItems)
 * Keduanya dibuat dalam satu request ke backend.
 */
combinedRequests.post("/", async (c) => {
  try {
    const userId = c.get("userId");
    const raw = await c.req.json();
    const parsed = combinedRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }

    const { borrowItems, consumableItems, purpose, notes, expectedReturnDate } =
      parsed.data;

    if (borrowItems.length === 0 && consumableItems.length === 0) {
      return c.json({ error: "Tambahkan minimal satu barang" }, 400);
    }

    const results: { borrowing?: any; consumableRequest?: any } = {};

    // --- Validate Borrow Items ---
    if (borrowItems.length > 0) {
      for (const bi of borrowItems) {
        const item = await Item.findById(bi.item);
        if (!item)
          return c.json({ error: `Barang tidak ditemukan: ${bi.item}` }, 404);
        if (item.type !== "returnable")
          return c.json(
            { error: `${item.name} bukan barang pinjam (returnable)` },
            400,
          );
        if (item.availableQty < bi.quantity)
          return c.json(
            {
              error: `Stok ${item.name} tidak cukup (tersedia: ${item.availableQty})`,
            },
            400,
          );
      }

      const borrowing = await Borrowing.create({
        borrower: userId,
        items: borrowItems.map((bi: any) => ({
          item: bi.item,
          quantity: bi.quantity,
        })),
        purpose,
        notes,
        expectedReturnDate,
        status: "pending",
        borrowDate: new Date(),
      });
      results.borrowing = borrowing;

      await Notification.create({
        user: userId,
        title: "Peminjaman Dibuat",
        message: `Permintaan peminjaman ${borrowItems.length} barang sedang menunggu persetujuan.`,
        type: "info",
        relatedModel: "Borrowing",
        relatedId: borrowing._id,
      });
    }

    // --- Validate Consumable Items ---
    if (consumableItems.length > 0) {
      for (const ci of consumableItems) {
        const item = await Item.findById(ci.item);
        if (!item)
          return c.json({ error: `Barang tidak ditemukan: ${ci.item}` }, 404);
        if (item.type !== "consumable")
          return c.json(
            { error: `${item.name} bukan barang habis pakai` },
            400,
          );
        if (item.availableQty < ci.quantity)
          return c.json(
            {
              error: `Stok ${item.name} tidak cukup (tersedia: ${item.availableQty})`,
            },
            400,
          );
      }

      const consumableRequest = await ConsumableRequest.create({
        requester: userId,
        items: consumableItems.map((ci: any) => ({
          item: ci.item,
          quantity: ci.quantity,
        })),
        purpose,
        notes,
        status: "pending",
      });
      results.consumableRequest = consumableRequest;

      await Notification.create({
        user: userId,
        title: "Permintaan Habis Pakai Dibuat",
        message: `Permintaan ${consumableItems.length} barang habis pakai sedang menunggu persetujuan.`,
        type: "info",
        relatedModel: "ConsumableRequest",
        relatedId: consumableRequest._id,
      });
    }

    return c.json(
      { ...results, message: "Permintaan gabungan berhasil dibuat" },
      201,
    );
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default combinedRequests;
