/**
 * In-memory token blacklist for logout invalidation.
 * Tokens are stored with their expiry time and auto-cleaned periodically.
 *
 * For production with multiple server instances, replace with Redis.
 */

const blacklist = new Map<string, number>();

// Clean expired tokens every 5 minutes
setInterval(
  () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [token, exp] of blacklist) {
      if (exp <= now) blacklist.delete(token);
    }
  },
  5 * 60 * 1000,
);

export const blacklistToken = (token: string, expiresAt: number) => {
  blacklist.set(token, expiresAt);
};

export const isTokenBlacklisted = (token: string): boolean => {
  return blacklist.has(token);
};
