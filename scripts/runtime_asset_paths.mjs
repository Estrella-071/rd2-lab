const PUBLIC_ICON_PATH_PATTERN = /^icons\/[A-Za-z0-9_.-]+\.png$/;

/**
 * Normalize and validate a data-driven icon reference before it participates
 * in the Pages allowlist or staging copy.  Public icons are intentionally
 * flat files; rejecting separators and traversal keeps both source and
 * destination paths inside the reviewed runtime boundary.
 */
export function normalizePublicIconPath(value, context = "runtime data") {
  const normalized = typeof value === "string"
    ? value.replace(/^sprite_icons\//, "icons/")
    : "";
  if (!PUBLIC_ICON_PATH_PATTERN.test(normalized)) {
    throw new Error(`Unsafe public icon path in ${context}: ${String(value)}`);
  }
  return normalized;
}
