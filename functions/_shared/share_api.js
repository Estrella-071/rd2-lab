export const SHARE_CODE_LENGTH = 6;
export const SHARE_PAYLOAD_MAX_LENGTH = 4 * 1024;
export const SHARE_THUMBNAIL_MAX_LENGTH = 128 * 1024;
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

export function isValidThumbnail(value) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string" || value.length > SHARE_THUMBNAIL_MAX_LENGTH) return false;
  return /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(value);
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

async function updateExistingShareThumbnail(db, code, thumbnail, locale = "zh-tw") {
  if (!thumbnail) return;
  const normalizedLocale = String(locale || "zh-tw").trim().toLowerCase();
  try {
    const row = await db.prepare(
      "SELECT thumbnail FROM simulation_shares WHERE code = ?1"
    ).bind(code).first().catch(() => null);

    const existing = row?.thumbnail;
    if (!existing) {
      await db.prepare(
        "UPDATE simulation_shares SET thumbnail = ?1 WHERE code = ?2"
      ).bind(thumbnail, code).run();
      return;
    }

    let thumbMap = {};
    if (typeof existing === "string" && existing.startsWith("{")) {
      try {
        thumbMap = JSON.parse(existing);
      } catch {
        thumbMap = { "zh-tw": existing };
      }
    } else {
      thumbMap = { "zh-tw": existing };
    }
    thumbMap[normalizedLocale] = thumbnail;
    const serialized = JSON.stringify(thumbMap);

    await db.prepare(
      "UPDATE simulation_shares SET thumbnail = ?1 WHERE code = ?2"
    ).bind(serialized, code).run();
  } catch {
    // Safe fallback if column does not exist
  }
}

async function executeInsertShare(db, { code, encoded, thumbnail, createdAt }) {
  if (thumbnail) {
    try {
      return await db.prepare(
        "INSERT OR IGNORE INTO simulation_shares (code, payload, thumbnail, created_at) VALUES (?, ?, ?, ?)"
      ).bind(code, encoded, thumbnail, createdAt).run();
    } catch {
      // If thumbnail column doesn't exist, fall back to standard 3-column insert
    }
  }
  return await db.prepare(
    "INSERT OR IGNORE INTO simulation_shares (code, payload, created_at) VALUES (?, ?, ?)"
  ).bind(code, encoded, createdAt).run();
}

export async function insertShare({ db, encoded, thumbnail = null, locale = "zh-tw", createdAt = Date.now(), attempts = 8 } = {}) {
  if (!db || typeof db.prepare !== "function") throw new Error("D1 binding is unavailable");
  const existingCode = await findShareCodeByPayload(db, encoded);
  if (existingCode) {
    await updateExistingShareThumbnail(db, existingCode, thumbnail, locale);
    return { code: existingCode, created: false };
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateShareCode();
    const result = await executeInsertShare(db, { code, encoded, thumbnail, createdAt });
    if (Number(result?.meta?.changes || 0) === 1) return { code, created: true };
    const concurrentCode = await findShareCodeByPayload(db, encoded);
    if (concurrentCode) {
      await updateExistingShareThumbnail(db, concurrentCode, thumbnail, locale);
      return { code: concurrentCode, created: false };
    }
  }
  throw new Error("share-code-collision-limit");
}

export const SIMULATION_SEO_METADATA = Object.freeze({
  "zh-tw": Object.freeze({
    title: "模擬配點｜Random Dice 2 Lab",
    description: "規劃 Random Dice 2 配點、比較解鎖消耗，並分享建構結果。"
  }),
  en: Object.freeze({
    title: "Build simulation | Random Dice 2 Lab",
    description: "Plan a Random Dice 2 build, compare unlock costs, and share the result."
  }),
  ja: Object.freeze({
    title: "ビルドシミュレーション｜Random Dice 2 Lab",
    description: "Random Dice 2 のビルドを計画し、解放コストを比較して結果を共有できます。"
  }),
  ko: Object.freeze({
    title: "빌드 시뮬레이션 | Random Dice 2 Lab",
    description: "Random Dice 2 빌드를 계획하고 해금 비용을 비교하며 결과를 공유하세요."
  })
});

export function getSimulationSeoMetadata(locale) {
  const normalized = String(locale || "").trim().toLowerCase();
  return SIMULATION_SEO_METADATA[normalized] || SIMULATION_SEO_METADATA["zh-tw"];
}

export async function handleSimulationShareRequest({ request, params, env, locale = null }) {
  const code = String(params?.code || "");
  const url = new URL(request.url);

  // 1. 抓取原始的靜態 index.html
  const response = await env.ASSETS.fetch(new URL("/", url.origin));
  if (!response.ok) return response;

  // 2. 如果是合法的 6 碼分享代碼，替換 SEO 標籤與圖片
  if (SHARE_CODE_PATTERN.test(code)) {
    const normalizedLocale = locale ? String(locale).trim().toLowerCase() : null;
    const seo = getSimulationSeoMetadata(normalizedLocale);
    const imageQuery = normalizedLocale ? `?locale=${encodeURIComponent(normalizedLocale)}` : "";
    const imageUrl = `${url.origin}/api/shares/${code}/image${imageQuery}`;
    const sharePath = normalizedLocale ? `/${normalizedLocale}/simulation/${code}` : `/simulation/${code}`;
    const shareUrl = `${url.origin}${sharePath}`;
    const htmlLang = normalizedLocale || "zh-tw";

    if (typeof HTMLRewriter !== "undefined") {
      return new HTMLRewriter()
        .on("html", {
          element(el) {
            el.setAttribute("lang", htmlLang);
          }
        })
        .on("title", {
          element(el) {
            el.setInnerContent(seo.title);
          }
        })
        .on("meta[name=\"description\"]", {
          element(el) {
            el.setAttribute("content", seo.description);
          }
        })
        .on("meta[property=\"og:title\"]", {
          element(el) {
            el.setAttribute("content", seo.title);
          }
        })
        .on("meta[property=\"og:description\"]", {
          element(el) {
            el.setAttribute("content", seo.description);
          }
        })
        .on("meta[name=\"twitter:title\"]", {
          element(el) {
            el.setAttribute("content", seo.title);
          }
        })
        .on("meta[name=\"twitter:description\"]", {
          element(el) {
            el.setAttribute("content", seo.description);
          }
        })
        .on("meta[property=\"og:image\"]", {
          element(el) {
            el.setAttribute("content", imageUrl);
          }
        })
        .on("meta[name=\"twitter:image\"]", {
          element(el) {
            el.setAttribute("content", imageUrl);
          }
        })
        .on("meta[property=\"og:url\"]", {
          element(el) {
            el.setAttribute("content", shareUrl);
          }
        })
        .on("link[rel=\"canonical\"], link[id=\"seo-canonical\"]", {
          element(el) {
            el.setAttribute("href", shareUrl);
          }
        })
        .transform(response);
    }
  }

  return response;
}

