export const SHARE_CODE_LENGTH = 6;
export const SHARE_PAYLOAD_MAX_LENGTH = 4 * 1024;
export const SHARE_CODE_PATTERN = /^[0-9A-Za-z]{6}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_BYTE_LIMIT = Math.floor(256 / BASE62_CHARS.length) * BASE62_CHARS.length;

export function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function isValidEncodedShare(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= SHARE_PAYLOAD_MAX_LENGTH
    && /^[0-9A-Za-z]+$/.test(value);
}

export async function readRequestText(request, maxBytes) {
  const declaredLength = Number(request?.headers?.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, tooLarge: true, text: "" };
  }
  if (!request?.body || typeof request.body.getReader !== "function") {
    const text = await request.text();
    const byteLength = new TextEncoder().encode(text).byteLength;
    return byteLength <= maxBytes
      ? { ok: true, tooLarge: false, text }
      : { ok: false, tooLarge: true, text: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false, tooLarge: true, text: "" };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, tooLarge: false, text };
}

export function generateShareCode() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("secure random source unavailable");
  }
  let code = "";
  while (code.length < SHARE_CODE_LENGTH) {
    const bytes = new Uint8Array(SHARE_CODE_LENGTH);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= RANDOM_BYTE_LIMIT) continue;
      code += BASE62_CHARS[byte % BASE62_CHARS.length];
      if (code.length === SHARE_CODE_LENGTH) break;
    }
  }
  return code;
}

async function findShareCodeByPayload(db, encoded) {
  const row = await db.prepare(
    "SELECT code FROM simulation_shares WHERE payload = ?1"
  ).bind(encoded).first();
  const code = String(row?.code || "");
  return SHARE_CODE_PATTERN.test(code) ? code : "";
}

export async function insertShare({ db, encoded, createdAt = Date.now(), attempts = 8 } = {}) {
  if (!db || typeof db.prepare !== "function") throw new Error("D1 binding is unavailable");
  const existingCode = await findShareCodeByPayload(db, encoded);
  if (existingCode) return { code: existingCode, created: false };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateShareCode();
    const result = await db.prepare(
      "INSERT OR IGNORE INTO simulation_shares (code, payload, created_at) VALUES (?, ?, ?)"
    ).bind(code, encoded, createdAt).run();
    if (Number(result?.meta?.changes || 0) === 1) return { code, created: true };
    const concurrentCode = await findShareCodeByPayload(db, encoded);
    if (concurrentCode) return { code: concurrentCode, created: false };
  }
  throw new Error("share-code-collision-limit");
}
