import {
  insertShare,
  isValidEncodedShare,
  jsonResponse,
  readRequestText,
  SHARE_PAYLOAD_MAX_LENGTH
} from "../_shared/share_api.js";

const MAX_REQUEST_BYTES = SHARE_PAYLOAD_MAX_LENGTH + 256;

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return jsonResponse({ ok: false, error: "share-storage-unavailable" }, { status: 503 });
  }
  const contentType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ ok: false, error: "unsupported-media-type" }, { status: 415 });
  }

  let body;
  try {
    const requestBody = await readRequestText(request, MAX_REQUEST_BYTES);
    if (requestBody.tooLarge) {
      return jsonResponse({ ok: false, error: "share-payload-too-large" }, { status: 413 });
    }
    body = JSON.parse(requestBody.text);
  } catch {
    return jsonResponse({ ok: false, error: "invalid-json" }, { status: 400 });
  }

  const encoded = body?.encoded;
  if (!isValidEncodedShare(encoded)) {
    return jsonResponse({ ok: false, error: "invalid-share-payload" }, { status: 400 });
  }

  try {
    const share = await insertShare({ db: env.DB, encoded });
    return jsonResponse({ ok: true, code: share.code }, {
      status: share.created ? 201 : 200
    });
  } catch (error) {
    console.error("simulation share insert failed", error);
    return jsonResponse({ ok: false, error: "share-storage-failed" }, { status: 503 });
  }
}
