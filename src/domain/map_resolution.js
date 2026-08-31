const MIN_MAP_RESOLUTION = 1;
const MAX_MAP_RESOLUTION = 3;

function normalizeScale(value) {
  return Math.max(MIN_MAP_RESOLUTION, Math.min(MAX_MAP_RESOLUTION, Math.round(Number(value) || MIN_MAP_RESOLUTION)));
}

/** Choose the smallest available raster bucket that covers the display scale. */
export function selectMapResolution({ scale = 1, devicePixelRatio = 1, available = [1, 2, 3] } = {}) {
  const normalizedScale = Number(scale);
  const normalizedDpr = Number(devicePixelRatio);
  const target = Math.max(0.01, Number.isFinite(normalizedScale) && normalizedScale > 0 ? normalizedScale : 1)
    * Math.max(1, Number.isFinite(normalizedDpr) && normalizedDpr > 0 ? normalizedDpr : 1);
  const buckets = [...available].map(normalizeScale).sort((left, right) => left - right);
  return buckets.find((value) => value >= target) || buckets.at(-1) || MIN_MAP_RESOLUTION;
}
