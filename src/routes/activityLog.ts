import { Hono } from 'hono';
import { AuditLog } from '../models/AuditLog.js';
import { authMiddleware, roleGuard } from '../middleware/auth.js';

const activityLog = new Hono();
activityLog.use('*', authMiddleware);

// List all activity logs (admin only)
activityLog.get('/', roleGuard('super_admin', 'admin'), async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '30');
    const action = c.req.query('action') || '';
    const targetModel = c.req.query('targetModel') || '';

    const query: any = {};
    if (action) query.action = action;
    if (targetModel) query.targetModel = targetModel;

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return c.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default activityLog;
