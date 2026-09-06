import {
  insertShare,
  isValidEncodedShare,
  isValidThumbnail,
  jsonResponse,
  readRequestText,
  SHARE_PAYLOAD_MAX_LENGTH,
  SHARE_THUMBNAIL_MAX_LENGTH
} from "../_shared/share_api.js";

const MAX_REQUEST_BYTES = SHARE_PAYLOAD_MAX_LENGTH + SHARE_THUMBNAIL_MAX_LENGTH + 512;

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

  const thumbnail = typeof body?.thumbnail === "string" && body.thumbnail ? body.thumbnail.trim() : null;
  if (thumbnail && !isValidThumbnail(thumbnail)) {
    return jsonResponse({ ok: false, error: "invalid-thumbnail" }, { status: 400 });
  }

  const locale = typeof body?.locale === "string" && body.locale ? body.locale.trim().toLowerCase() : "zh-tw";

  try {
    const share = await insertShare({ db: env.DB, encoded, thumbnail, locale });
    return jsonResponse({ ok: true, code: share.code }, {
      status: share.created ? 201 : 200
    });
  } catch (error) {
    console.error("simulation share insert failed", error);
    return jsonResponse({ ok: false, error: "share-storage-failed" }, { status: 503 });
  }
}
