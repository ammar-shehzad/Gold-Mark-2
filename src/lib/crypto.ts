import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// AES-256-GCM via Node's built-in crypto — no new dependency. This is the
// one credential in the app that deviates from the rest of the codebase's
// "RLS is the only protection" norm: a Google refresh token is a standing
// bearer credential to the admin's Drive/Sheets, and the admin's own
// documented workflow (see README) is to browse tables directly in the
// Supabase Table Editor and download full backups — exactly where a
// plaintext token would otherwise sit.
//
// GOOGLE_TOKEN_ENC_KEY must be a base64-encoded 32-byte key, generated once
// via: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY;
  if (!raw) throw new Error("GOOGLE_TOKEN_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENC_KEY must decode to exactly 32 bytes (base64-encoded)");
  }
  return key;
}

/** Encrypts a UTF-8 string. Returns "iv:authTag:ciphertext", all base64. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a payload produced by encrypt(). */
export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
