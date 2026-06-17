import { getEnv } from "./runtime-env.server";

// AES-256-GCM (Web Crypto API — CF Workers 호환)
// 암호화된 값: "enc:<iv_hex>:<ciphertext_with_tag_hex>"
// ENCRYPTION_KEY 없으면 평문 그대로 저장 (마이그레이션 기간 호환)

const ENC_PREFIX = "enc:";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) {
    view[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return view;
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer> | Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(input: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(input);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function importAesKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const keyHex = getEnv("ENCRYPTION_KEY");
  if (!keyHex || keyHex.length !== 64) return plaintext;
  const key = await importAesKey(keyHex);
  const ivBuf = new ArrayBuffer(12);
  crypto.getRandomValues(new Uint8Array(ivBuf));
  const iv = new Uint8Array(ivBuf);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext));
  return `${ENC_PREFIX}${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const keyHex = getEnv("ENCRYPTION_KEY");
  if (!keyHex || keyHex.length !== 64) return stored;
  try {
    const rest = stored.slice(ENC_PREFIX.length);
    const colon = rest.indexOf(":");
    const iv = hexToBytes(rest.slice(0, colon));
    const ct = hexToBytes(rest.slice(colon + 1));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importAesKey(keyHex), ct);
    return new TextDecoder().decode(plain);
  } catch {
    return stored;
  }
}
