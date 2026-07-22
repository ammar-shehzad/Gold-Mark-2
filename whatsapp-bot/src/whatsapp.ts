import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "baileys";
import { Boom } from "@hapi/boom";
import { rm } from "node:fs/promises";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { supabase } from "./supabase.js";

const logger = pino({ level: "warn" });

let sock: WASocket | null = null;
let ready = false;
let reconnectAttempts = 0;

const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_ATTEMPTS_BEFORE_GIVING_UP = 5;

async function reportStatus(patch: { connected: boolean; qr_data?: string | null; connected_number?: string | null }) {
  const { error } = await supabase
    .from("mallpay_whatsapp_status")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) console.error("Failed to report status to Supabase:", error.message);
}

export async function connectWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ auth: state, logger, version });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      reconnectAttempts = 0;
      console.log("\nScan this QR code with WhatsApp (Linked Devices -> Link a device):\n");
      qrcode.generate(qr, { small: true });
      reportStatus({ connected: false, qr_data: qr }).catch(() => {});
    }

    if (connection === "open") {
      ready = true;
      reconnectAttempts = 0;
      const number = sock?.user?.id?.split(":")[0] ?? null;
      console.log("WhatsApp connected.");
      reportStatus({ connected: true, qr_data: null, connected_number: number }).catch(() => {});
    }

    if (connection === "close") {
      ready = false;
      const err = lastDisconnect?.error as Boom | undefined;
      const statusCode = err?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(
        `WhatsApp connection closed (statusCode=${statusCode ?? "unknown"}, reason="${err?.message ?? "unknown"}")`
      );
      reportStatus({ connected: false }).catch(() => {});

      if (loggedOut) {
        // Automatic handover: when the linked number logs the bot out from
        // its phone (Linked Devices -> Log out), the saved session keys are
        // permanently dead. Wipe them and reconnect immediately — that
        // reconnect has no session, so it generates a fresh QR, which
        // reportStatus pushes to the admin's /whatsapp page for the next
        // number to scan. No manual folder deletion or restart needed.
        console.log("Logged out — clearing the dead session and generating a fresh QR to re-link.");
        rm("auth", { recursive: true, force: true })
          .catch((e) => console.error("Could not remove auth/ folder:", e))
          .then(() => connectWhatsApp())
          .catch((e) => console.error("Reconnect after logout failed:", e));
        return;
      }

      reconnectAttempts += 1;
      if (reconnectAttempts > MAX_ATTEMPTS_BEFORE_GIVING_UP) {
        console.error(
          `Giving up after ${reconnectAttempts} failed attempts in a row — not retrying further to avoid hammering WhatsApp's servers. Restart the bot manually once the underlying issue is fixed.`
        );
        return;
      }

      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
      console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_ATTEMPTS_BEFORE_GIVING_UP})...`);
      setTimeout(() => {
        connectWhatsApp().catch((e) => console.error("Reconnect failed:", e));
      }, delay);
    }
  });
}

export function isWhatsAppReady(): boolean {
  return ready;
}

/** Normalizes a phone number (digits only, with country code) into a WhatsApp JID. */
export function toJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

export async function sendWhatsAppMessage(phoneNumber: string, message: string): Promise<void> {
  if (!sock || !ready) throw new Error("WhatsApp is not connected yet.");
  await sock.sendMessage(toJid(phoneNumber), { text: message });
}

export async function sendWhatsAppImageMessage(phoneNumber: string, imageUrl: string, caption: string): Promise<void> {
  if (!sock || !ready) throw new Error("WhatsApp is not connected yet.");
  await sock.sendMessage(toJid(phoneNumber), { image: { url: imageUrl }, caption });
}
