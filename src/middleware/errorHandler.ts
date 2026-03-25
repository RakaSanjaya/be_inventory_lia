import { Context, Next } from "hono";
import { ZodError } from "zod";
import mongoose from "mongoose";

export const errorHandler = async (c: Context, next: Next) => {
  try {
    await next();
  } catch (err: unknown) {
    // Zod validation error
    if (err instanceof ZodError) {
      return c.json({ error: err.issues[0]?.message || "Validasi gagal" }, 400);
    }

    // Mongoose validation error
    if (err instanceof mongoose.Error.ValidationError) {
      const firstError = Object.values(err.errors)[0];
      return c.json(
        { error: firstError?.message || "Validasi data gagal" },
        400,
      );
    }

    // Mongoose cast error (invalid ObjectId etc.)
    if (err instanceof mongoose.Error.CastError) {
      return c.json({ error: "ID tidak valid" }, 400);
    }

    // MongoDB duplicate key
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 11000
    ) {
      return c.json({ error: "Data sudah ada (duplikat)" }, 409);
    }

    // Generic Error — hide internal details in production
    const message =
      process.env.NODE_ENV === "production"
        ? "Terjadi kesalahan server"
        : err instanceof Error
          ? err.message
          : "Terjadi kesalahan server";

    console.error(
      "[ERROR]",
      new Date().toISOString(),
      c.req.method,
      c.req.path,
      err instanceof Error ? err.stack : err,
    );

    return c.json({ error: message }, 500);
  }
};

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(
    `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`,
  );
};
