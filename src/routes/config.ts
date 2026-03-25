import { Hono } from "hono";
import { SystemConfig } from "../models/SystemConfig.js";
import { authMiddleware, roleGuard } from "../middleware/auth.js";

const config = new Hono();

/**
 * Public — any client may check whether registration is currently open.
 * The login page calls this to decide whether to show the register tab.
 */
config.get("/registration-status", async (c) => {
  try {
    const record = await SystemConfig.findOne({ key: "registrationEnabled" });
    // Default to true (open) if no record has ever been set.
    const registrationEnabled = record ? Boolean(record.value) : true;
    return c.json({ registrationEnabled });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Public — returns app display name for branding.
 */
config.get("/app-settings", async (c) => {
  try {
    const record = await SystemConfig.findOne({ key: "appName" });
    const appName = record ? String(record.value) : "InvenTrack";
    return c.json({ appName });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Admin — list all system configuration entries.
 */
config.get(
  "/",
  authMiddleware,
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const configs = await SystemConfig.find().select("-__v").lean();
      return c.json({ configs });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

/**
 * Admin — create or update a config value by key.
 * Body: { value: boolean | string | number }
 */
config.put(
  "/:key",
  authMiddleware,
  roleGuard("super_admin", "admin"),
  async (c) => {
    try {
      const key = c.req.param("key");
      const body = await c.req.json();
      if (body.value === undefined) {
        return c.json({ error: "value wajib diisi" }, 400);
      }
      const userId = (c as any).get("userId") as string | undefined;
      const updated = await SystemConfig.findOneAndUpdate(
        { key },
        { value: body.value, updatedBy: userId },
        { new: true, upsert: true },
      );
      return c.json({ config: updated });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

export default config;
