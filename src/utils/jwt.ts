import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

const REFRESH_SECRET = process.env.REFRESH_SECRET || JWT_SECRET + "_refresh";

export const generateToken = (userId: string, role: string): string => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "2h" });
};

export const generateRefreshToken = (userId: string, role: string): string => {
  return jwt.sign({ userId, role, type: "refresh" }, REFRESH_SECRET, {
    expiresIn: "7d",
  });
};

export const verifyToken = (
  token: string,
): { userId: string; role: string } => {
  return jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
};

export const verifyRefreshToken = (
  token: string,
): { userId: string; role: string } => {
  return jwt.verify(token, REFRESH_SECRET) as { userId: string; role: string };
};
