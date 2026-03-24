import { Context, Next } from "hono";

const requests = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of requests) {
    if (now > value.resetAt) requests.delete(key);
  }
}, 60_000);

export function rateLimiter(
  maxRequests: number = 10,
  windowMs: number = 60_000,
) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    const entry = requests.get(key);
    if (entry && now < entry.resetAt) {
      entry.count++;
      if (entry.count > maxRequests) {
        return c.json(
          { error: "Terlalu banyak permintaan. Coba lagi nanti." },
          429,
        );
      }
    } else {
      requests.set(key, { count: 1, resetAt: now + windowMs });
    }

    await next();
  };
}
