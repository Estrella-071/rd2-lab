import { SHARE_CODE_PATTERN } from "../../../_shared/share_api.js";

function resolveTargetThumbnail(rawThumbnail, locale) {
  if (typeof rawThumbnail !== "string" || !rawThumbnail) return null;
  if (rawThumbnail.startsWith("data:image/")) return rawThumbnail;
  if (rawThumbnail.startsWith("{")) {
    try {
      const map = JSON.parse(rawThumbnail);
      return (locale && map[locale]) || map["zh-tw"] || Object.values(map)[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

function createBinaryImageResponse(targetThumbnail) {
  if (!targetThumbnail?.startsWith("data:image/")) return null;
  const match = /^data:(image\/(?:jpeg|webp|png));base64,(.+)$/.exec(targetThumbnail);
  if (!match) return null;

  const contentType = match[1];
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.codePointAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function onRequestGet({ request, params, env }) {
  const code = String(params?.code || "");
  if (!SHARE_CODE_PATTERN.test(code)) {
    return new Response("Invalid share code", { status: 400 });
  }

  const url = new URL(request.url);
  const locale = String(url.searchParams.get("locale") || "").trim().toLowerCase();
  const fallbackUrl = new URL("/og-preview.png", url.origin).href;

  if (!env?.DB) {
    return Response.redirect(fallbackUrl, 302);
  }

  try {
    const row = await env.DB.prepare(
      "SELECT thumbnail FROM simulation_shares WHERE code = ?1"
    ).bind(code).first().catch(() => null);

    const targetThumbnail = resolveTargetThumbnail(row?.thumbnail, locale);
    const imageResponse = createBinaryImageResponse(targetThumbnail);
    if (imageResponse) return imageResponse;

    return Response.redirect(fallbackUrl, 302);
  } catch (error) {
    console.error("simulation share image lookup failed", error);
    return Response.redirect(fallbackUrl, 302);
  }
}
