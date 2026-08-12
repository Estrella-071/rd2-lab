import { normalizeLocale, SUPPORTED_LOCALES } from "./localization.js";

export const PUBLIC_SITE_ORIGIN = "https://rd2-lab.pages.dev";
export const URL_ROUTE_KINDS = Object.freeze({
  HOME: "home",
  TREE_NODE: "tree-node",
  COMPENDIUM: "compendium",
  COMPENDIUM_CARD: "compendium-card",
  SIMULATION: "simulation"
});

const COMPENDIUM_CATEGORIES = new Set(["dice", "monster", "event"]);
const SIMULATION_PATH_MARKER = "simulation";

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function normalizePathname(pathname) {
  const value = String(pathname || "/");
  return value.startsWith("/") ? value : `/${value}`;
}

function splitPath(pathname) {
  return normalizePathname(pathname)
    .split("/")
    .map(decodeSegment)
    .filter(Boolean);
}

function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.includes(String(value || "").toLowerCase());
}

function parseUrl(input) {
  if (input instanceof URL) return input;
  try {
    return new URL(String(input || "/"), PUBLIC_SITE_ORIGIN);
  } catch {
    return new URL("/", PUBLIC_SITE_ORIGIN);
  }
}

function parseLegacyQuery(url) {
  const eventId = url.searchParams.get("event") || url.searchParams.get("event_id") || "";
  const eventMode = url.searchParams.get("event_mode") || "all";
  const nodeId = url.searchParams.get("node") || url.searchParams.get("node_id") || "";
  const share = url.searchParams.get("s") || url.searchParams.get("sim") || url.searchParams.get("state") || "";
  if (eventId) return { kind: URL_ROUTE_KINDS.COMPENDIUM_CARD, category: "event", id: eventId, eventMode };
  if (nodeId) return { kind: URL_ROUTE_KINDS.TREE_NODE, id: nodeId };
  if (share) return { kind: URL_ROUTE_KINDS.SIMULATION, share: decodeSegment(share) };
  return null;
}

/**
 * Parse the public URL contract without touching browser globals.
 *
 * The first path segment is a locale when it is one of the four supported
 * locale slugs. Route data is intentionally ID based so labels can change
 * without invalidating links.
 */
export function parseUrlState(input = "/") {
  const url = parseUrl(input);
  const segments = splitPath(url.pathname);
  const hasLocalePath = isSupportedLocale(segments[0]);
  const locale = hasLocalePath ? normalizeLocale(segments.shift()) : null;
  const [route, subtype, identifier] = segments;

  if (route === "tree" && subtype === "node" && identifier) {
    return { kind: URL_ROUTE_KINDS.TREE_NODE, locale, hasLocalePath, id: identifier, url };
  }
  if (route === "compendium" && COMPENDIUM_CATEGORIES.has(subtype) && identifier) {
    return {
      kind: URL_ROUTE_KINDS.COMPENDIUM_CARD,
      locale,
      hasLocalePath,
      category: subtype,
      id: identifier,
      eventMode: url.searchParams.get("mode") || "all",
      url
    };
  }
  if (route === "compendium" && COMPENDIUM_CATEGORIES.has(subtype) && !identifier) {
    return {
      kind: URL_ROUTE_KINDS.COMPENDIUM,
      locale,
      hasLocalePath,
      category: subtype,
      eventMode: url.searchParams.get("mode") || "all",
      url
    };
  }
  if (route === SIMULATION_PATH_MARKER) {
    const isLocalState = subtype === "state" && Boolean(identifier);
    return {
      kind: URL_ROUTE_KINDS.SIMULATION,
      locale,
      hasLocalePath,
      share: isLocalState ? identifier : subtype || "",
      shareKind: isLocalState ? "state" : "code",
      url
    };
  }

  const legacy = parseLegacyQuery(url);
  if (legacy) return { ...legacy, locale, hasLocalePath, url };
  return { kind: URL_ROUTE_KINDS.HOME, locale, hasLocalePath, url };
}

function routeSegment(value, fallback = "") {
  const normalized = String(value ?? fallback).trim();
  return normalized ? encodeURIComponent(normalized) : "";
}

export function normalizeUrlLocale(value, fallback = "zh-tw") {
  return normalizeLocale(value, fallback);
}

function buildLocalePrefix(locale, includeLocale) {
  return includeLocale ? `/${routeSegment(normalizeUrlLocale(locale))}` : "";
}

export function isLocaleFreeShareRoute(route = {}) {
  return route.kind === URL_ROUTE_KINDS.SIMULATION && Boolean(route.share);
}

export function buildSimulationSharePath({ share = "", shareKind = "code" } = {}) {
  if (!share) return "/simulation/";
  const marker = shareKind === "state" ? "/state" : "";
  return `/simulation${marker}/${routeSegment(share)}`;
}

export function buildLocalePath({ locale = "zh-tw", includeLocale = true, kind = URL_ROUTE_KINDS.HOME, category = "", id = "", share = "", shareKind = "code" } = {}) {
  const localePrefix = buildLocalePrefix(locale, includeLocale);
  if (kind === URL_ROUTE_KINDS.TREE_NODE && id) return `${localePrefix}/tree/node/${routeSegment(id)}`;
  if (kind === URL_ROUTE_KINDS.COMPENDIUM_CARD && COMPENDIUM_CATEGORIES.has(category) && id) {
    return `${localePrefix}/compendium/${routeSegment(category)}/${routeSegment(id)}`;
  }
  if (kind === URL_ROUTE_KINDS.COMPENDIUM && COMPENDIUM_CATEGORIES.has(category)) {
    return `${localePrefix}/compendium/${routeSegment(category)}`;
  }
  if (kind === URL_ROUTE_KINDS.SIMULATION && share) {
    return includeLocale
      ? `${localePrefix}${buildSimulationSharePath({ share, shareKind })}`
      : buildSimulationSharePath({ share, shareKind });
  }
  if (kind === URL_ROUTE_KINDS.SIMULATION) return `${localePrefix}/simulation/`;
  return `${localePrefix}/`;
}

export function buildLocaleUrl({ locale = "zh-tw", eventMode = "all", ...route } = {}) {
  const includeLocale = route.includeLocale ?? !isLocaleFreeShareRoute(route);
  const path = buildLocalePath({ locale, includeLocale, ...route });
  if ((route.kind === URL_ROUTE_KINDS.COMPENDIUM_CARD || route.kind === URL_ROUTE_KINDS.COMPENDIUM)
    && route.category === "event"
    && eventMode
    && eventMode !== "all") {
    return `${path}?mode=${routeSegment(eventMode)}`;
  }
  return path;
}

export function buildPublicUrl({ origin = PUBLIC_SITE_ORIGIN, ...route } = {}) {
  const base = String(origin || PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
  return `${base}${buildLocaleUrl(route)}`;
}

export function buildAlternateLocaleUrl(input, locale) {
  const parsed = parseUrlState(input);
  const targetLocale = normalizeUrlLocale(locale);
  return buildPublicUrl({
    origin: parsed.url.origin,
    locale: targetLocale,
    kind: parsed.kind,
    category: parsed.category,
    id: parsed.id,
    share: parsed.share,
    shareKind: parsed.shareKind,
    includeLocale: !isLocaleFreeShareRoute(parsed),
    eventMode: parsed.eventMode
  });
}

export function buildUrlStatePath(input, locale) {
  const parsed = parseUrlState(input);
  return buildLocaleUrl({
    locale: normalizeUrlLocale(locale),
    kind: parsed.kind,
    category: parsed.category,
    id: parsed.id,
    share: parsed.share,
    shareKind: parsed.shareKind,
    includeLocale: !isLocaleFreeShareRoute(parsed),
    eventMode: parsed.eventMode
  });
}

export function isSimulationPath(input) {
  return parseUrlState(input).kind === URL_ROUTE_KINDS.SIMULATION;
}
