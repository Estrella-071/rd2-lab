import {
  isValidEncodedShare,
  jsonResponse,
  SHARE_CODE_PATTERN
} from "../../_shared/share_api.js";

export async function onRequestGet({ params, env }) {
  const code = String(params?.code || "");
  if (!SHARE_CODE_PATTERN.test(code)) {
    return jsonResponse({ ok: false, error: "invalid-share-code" }, { status: 400 });
  }
  if (!env?.DB) {
    return jsonResponse({ ok: false, error: "share-storage-unavailable" }, { status: 503 });
  }
  try {
    const row = await env.DB.prepare(
      "SELECT code, payload, created_at FROM simulation_shares WHERE code = ?1"
    ).bind(code).first();
    if (!row || !isValidEncodedShare(row.payload)) {
      return jsonResponse({ ok: false, error: "share-not-found" }, { status: 404 });
    }
    return jsonResponse({
      ok: true,
      code: row.code,
      encoded: row.payload,
      createdAt: Number(row.created_at) || null
    }, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300"
      }
    });
  } catch (error) {
    console.error("simulation share lookup failed", error);
    return jsonResponse({ ok: false, error: "share-storage-failed" }, { status: 503 });
  }
}
