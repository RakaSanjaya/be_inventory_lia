import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/inventory";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 2,
        connectTimeoutMS: 10_000,
        serverSelectionTimeoutMS: 15_000,
        socketTimeoutMS: 45_000,
      });
      console.log("✅ MongoDB connected successfully");

      mongoose.connection.on("disconnected", () => {
        console.warn("⚠️ MongoDB disconnected");
      });
      mongoose.connection.on("reconnected", () => {
        console.log("🔄 MongoDB reconnected");
      });
      mongoose.connection.on("error", (err) => {
        console.error("❌ MongoDB connection error:", err.message);
      });

      return;
    } catch (error) {
      console.error(
        `❌ MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed:`,
        error,
      );
      if (attempt < MAX_RETRIES) {
        console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error("❌ All MongoDB connection attempts failed");
        process.exit(1);
      }
    }
  }
};

export const disconnectDB = async () => {
  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected gracefully");
};
