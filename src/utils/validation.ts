import { z } from "zod";

/**
 * Normalisasi nomor telepon Indonesia ke format 628xxx
 * Menerima: 08xxx, 628xxx, +628xxx, 62-8xxx, +62 8xxx, dll.
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("0")) cleaned = "62" + cleaned.slice(1);
  return cleaned;
}

// ===== AUTH =====
const passwordSchema = z
  .string()
  .min(8, "Password minimal 8 karakter")
  .max(128)
  .regex(/[A-Z]/, "Password harus mengandung huruf besar")
  .regex(/[a-z]/, "Password harus mengandung huruf kecil")
  .regex(/[0-9]/, "Password harus mengandung angka")
  .regex(/[^A-Za-z0-9]/, "Password harus mengandung karakter spesial");

export const registerSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(100),
  email: z.string().email("Format email tidak valid"),
  password: passwordSchema,
  role: z
    .enum(["super_admin", "admin", "staff", "student"])
    .optional()
    .default("staff"),
  department: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

// ===== ITEMS =====
export const createItemSchema = z.object({
  code: z.string().min(1, "Kode barang wajib diisi").max(50),
  name: z.string().min(1, "Nama barang wajib diisi").max(200),
  description: z.string().max(1000).optional(),
  category: z.string().min(1, "Kategori wajib dipilih"),
  type: z.enum(["returnable", "consumable"]),
  quantity: z.number().int().min(0, "Jumlah tidak valid"),
  minStock: z.number().int().min(0).optional().default(0),
  location: z.string().min(1, "Lokasi wajib dipilih"),
  condition: z
    .enum(["good", "fair", "damaged", "under_repair"])
    .optional()
    .default("good"),
  acquisitionDate: z.string().optional(),
  price: z.number().min(0).optional().default(0),
  notes: z.string().max(1000).optional(),
});

export const updateItemSchema = createItemSchema.partial();

// ===== CATEGORIES =====
export const categorySchema = z.object({
  name: z.string().min(1, "Nama kategori wajib diisi").max(100),
  description: z.string().max(500).optional(),
});

// ===== LOCATIONS =====
export const locationSchema = z.object({
  building: z.string().min(1, "Gedung wajib diisi").max(100),
  room: z.string().min(1, "Ruangan wajib diisi").max(100),
  shelf: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

// ===== BORROWINGS =====
export const createBorrowingSchema = z.object({
  items: z
    .array(
      z.object({
        item: z.string().min(1),
        quantity: z.number().int().min(1, "Jumlah minimal 1"),
      }),
    )
    .min(1, "Minimal 1 barang"),
  purpose: z.string().min(1, "Keperluan wajib diisi").max(500),
  borrowDate: z.string().min(1),
  expectedReturnDate: z.string().min(1, "Tanggal pengembalian wajib diisi"),
});

export const rejectSchema = z.object({
  notes: z.string().min(1, "Alasan penolakan wajib diisi").max(500),
});

export const returnBorrowingSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        returnedQty: z.number().int().min(0),
        condition: z.enum(["good", "fair", "damaged"]),
      }),
    )
    .min(1),
  returnNotes: z.string().max(500).optional(),
});

// ===== CONSUMABLE REQUESTS =====
export const createConsumableRequestSchema = z.object({
  items: z
    .array(
      z.object({
        item: z.string().min(1),
        quantity: z.number().int().min(1, "Jumlah minimal 1"),
      }),
    )
    .min(1, "Minimal 1 barang"),
  purpose: z.string().min(1, "Keperluan wajib diisi").max(500),
});

// ===== USERS =====
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Password lama wajib diisi"),
  newPassword: passwordSchema,
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
  role: z.enum(["super_admin", "admin", "staff", "student"]).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});
