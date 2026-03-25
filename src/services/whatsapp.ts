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

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private qr: string | null = null;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qr = qr;
          this.emit("qr", qr);
        }

        if (connection === "close") {
          const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = reason !== DisconnectReason.loggedOut;

          this.sock = null;
          this.status = "disconnected";
          this.emit("status", this.status);

          if (shouldReconnect) {
            console.log("[WA] Connection closed, reconnecting in 5s...");
            this.reconnectTimer = setTimeout(() => this.connect(), 5000);
          } else {
            console.log("[WA] Logged out. Clearing session.");
            this.clearSession();
          }
        }

        if (connection === "open") {
          this.qr = null;
          this.status = "connected";
          this.emit("status", this.status);
          console.log("[WA] Connected successfully");
        }
      });

      this.sock = sock;
    } catch (err) {
      console.error("[WA] Connection error:", err);
      this.status = "disconnected";
      this.emit("status", this.status);
    }
  }

  async disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
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
