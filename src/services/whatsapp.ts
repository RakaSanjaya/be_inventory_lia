import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
} from "baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import { EventEmitter } from "events";

const AUTH_DIR = path.resolve(process.cwd(), "wa-session");
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 3_000; // 3 seconds

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private qr: string | null = null;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;

  getStatus() {
    return this.status;
  }

  getQR() {
    return this.qr;
  }

  async connect() {
    if (this.status === "connecting" || this.status === "connected") return;
    this.status = "connecting";
    this.emit("status", this.status);

    try {
      if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["InvenTrack", "Server", "1.0.0"],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        keepAliveIntervalMs: 30_000,
        retryRequestDelayMs: 2_000,
        connectTimeoutMs: 60_000,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qr = qr;
          this.emit("qr", qr);
        }

        if (connection === "close") {
          this.stopKeepAlive();
          const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
          this.sock = null;
          this.status = "disconnected";
          this.emit("status", this.status);

          if (reason === DisconnectReason.loggedOut) {
            console.log("[WA] Logged out. Clearing session.");
            this.reconnectAttempts = 0;
            this.clearSession();
            return;
          }

          if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(
              `[WA] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`,
            );
            this.reconnectAttempts = 0;
            return;
          }

          // Exponential backoff: 3s, 6s, 12s, 24s... capped at 5 min
          const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
            300_000,
          );
          this.reconnectAttempts++;

          const reasonName =
            Object.entries(DisconnectReason).find(
              ([, v]) => v === reason,
            )?.[0] || reason;
          console.log(
            `[WA] Connection closed (reason: ${reasonName}). Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
          );

          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        }

        if (connection === "open") {
          this.qr = null;
          this.status = "connected";
          this.reconnectAttempts = 0;
          this.emit("status", this.status);
          this.startKeepAlive();
          console.log("[WA] Connected successfully");
        }
      });

      this.sock = sock;
    } catch (err) {
      console.error("[WA] Connection error:", err);
      this.status = "disconnected";
      this.emit("status", this.status);

      // Also retry on initial connection error
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
          300_000,
        );
        this.reconnectAttempts++;
        console.log(
          `[WA] Retrying connection in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
        );
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    // Send periodic presence update to keep the connection alive
    this.keepAliveTimer = setInterval(async () => {
      if (this.sock && this.status === "connected") {
        try {
          await this.sock.sendPresenceUpdate("available");
        } catch {
          // Ignore keep-alive errors — connection.update will handle disconnect
        }
      }
    }, 25_000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  async disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopKeepAlive();
    this.reconnectAttempts = 0;
    if (this.sock) {
      await this.sock.logout().catch(() => {});
      this.sock = null;
    }
    this.status = "disconnected";
    this.qr = null;
    this.emit("status", this.status);
    this.clearSession();
  }

  private clearSession() {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  }

  /**
   * Send a WhatsApp text message.
   * @param phone - Phone number in local (08xxx) or international (628xxx) format
   * @param text  - Message body
   */
  async sendMessage(phone: string, text: string): Promise<boolean> {
    if (!this.sock || this.status !== "connected") return false;

    try {
      const jid = this.formatJid(phone);
      await this.sock.sendMessage(jid, { text });
      return true;
    } catch (err) {
      console.error("[WA] Send error:", err);
      return false;
    }
  }

  /**
   * Convert a local phone number to WhatsApp JID.
   * Handles 08xxx → 628xxx conversion.
   */
  private formatJid(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
    if (cleaned.startsWith("0")) cleaned = "62" + cleaned.slice(1);
    if (!cleaned.includes("@")) cleaned += "@s.whatsapp.net";
    return cleaned;
  }
}

// Singleton
export const whatsapp = new WhatsAppService();
