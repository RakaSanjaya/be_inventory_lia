import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { connectDB } from "./config/database.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import categoryRoutes from "./routes/categories.js";
import locationRoutes from "./routes/locations.js";
import itemRoutes from "./routes/items.js";
import borrowingRoutes from "./routes/borrowings.js";
import consumableRequestRoutes from "./routes/consumableRequests.js";
import combinedRequestRoutes from "./routes/combinedRequests.js";
import dashboardRoutes from "./routes/dashboard.js";
import notificationRoutes from "./routes/notifications.js";
import activityLogRoutes from "./routes/activityLog.js";
import stockRoutes from "./routes/stock.js";

dotenv.config();

const app = new Hono();

// Security headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

// Security: Request size limit
app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength) > 1_048_576) {
    return c.json({ error: "Request terlalu besar" }, 413);
  }
  await next();
});

// CORS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001"];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// Routes
app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/locations", locationRoutes);
app.route("/api/items", itemRoutes);
app.route("/api/borrowings", borrowingRoutes);
app.route("/api/consumable-requests", consumableRequestRoutes);
app.route("/api/combined-requests", combinedRequestRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/activity-log", activityLogRoutes);
app.route("/api/stock", stockRoutes);

// Health check
app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

// Connect DB and start server
const PORT = parseInt(process.env.PORT || "4000");

connectDB().then(() => {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`🚀 Server running on http://localhost:${info.port}`);
  });
});

export default app;
