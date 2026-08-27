import { ShareRepositoryPort } from "../app/ports/share_repository_port.js";

const BASE62_CODE_PATTERN = /^[0-9A-Za-z]{6}$/;
const BASE62_PAYLOAD_PATTERN = /^[0-9A-Za-z]+$/;
const MAX_PAYLOAD_LENGTH = 4 * 1024;

function normalizeResponseBody(body) {
  return body && typeof body === "object" ? body : {};
}
function isValidPayload(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_PAYLOAD_LENGTH
    && BASE62_PAYLOAD_PATTERN.test(value);
}

/**
 * HTTP adapter for the Cloudflare Pages Function + D1 share API.
 * Network/API failures are returned as a structured result so the caller can
 * fall back to the self-contained local serializer when running offline.
 */
export class HttpShareRepository extends ShareRepositoryPort {
  constructor({ endpoint = "/api/shares", fetchFn = null } = {}) {
    super();
    this.endpoint = endpoint.replace(/\/$/, "");
    this.fetchFn = fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  }

  async createShare(encoded) {
    if (!this.fetchFn) return { ok: false, error: "fetch-unavailable" };
    if (!isValidPayload(encoded)) return { ok: false, error: "invalid-share-payload" };
    try {
      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ encoded })
      });
      const body = normalizeResponseBody(await response.json().catch(() => null));
      if (!response.ok || body.ok !== true || !BASE62_CODE_PATTERN.test(String(body.code || ""))) {
        return { ok: false, error: body.error || `share-api-http-${response.status}`, status: response.status };
      }
      return { ok: true, code: String(body.code) };
    } catch {
      return { ok: false, error: "share-api-network" };
    }
  }

  async loadShare(code) {
    const normalizedCode = String(code || "");
    if (!this.fetchFn) return { ok: false, error: "fetch-unavailable" };
    if (!BASE62_CODE_PATTERN.test(normalizedCode)) return { ok: false, error: "invalid-share-code" };
    try {
      const response = await this.fetchFn(`${this.endpoint}/${encodeURIComponent(normalizedCode)}`, {
        headers: { accept: "application/json" }
      });
      const body = normalizeResponseBody(await response.json().catch(() => null));
      if (!response.ok || body.ok !== true || String(body.code || "") !== normalizedCode || !isValidPayload(body.encoded)) {
        return { ok: false, error: body.error || `share-api-http-${response.status}`, status: response.status };
      }
      return { ok: true, code: normalizedCode, encoded: body.encoded };
    } catch {
      return { ok: false, error: "share-api-network" };
    }
  }
}
