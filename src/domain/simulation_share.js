import {
  getMaxRank,
  getNodeMap,
  isInitialSimulationNode,
  isSpecialUnlockNode,
  MAX_SIMULATION_TEAM_COMMON_NODES,
  MAX_SIMULATION_TEAM_DICE,
  MAX_SIMULATION_TEAM_RUNES_PER_DIE,
  normalizeTeam,
  normalizeRanks
} from "./simulation_plan.js";
import { buildSimulationSharePath, parseUrlState, URL_ROUTE_KINDS } from "./url_state.js";

export const SIMULATION_SHARE_KIND = "r";
export const SIMULATION_SHARE_VERSION = 1;
export const SIMULATION_SHARE_SEARCH_PARAM = "s";
export const MAX_SIMULATION_SHARE_ENCODED_LENGTH = 4 * 1024;
export const MAX_SIMULATION_SHARE_URL_LENGTH = 8 * 1024;
export const MAX_SIMULATION_SHARE_RANK_ENTRIES = 512;
const STABLE_RANK_FORMAT = "i";
const DECODED_SHARE_RESULT = Symbol("decodedSimulationShareResult");

function markDecodedShareResult(result) {
  Object.defineProperty(result, DECODED_SHARE_RESULT, { value: true });
  return result;
}

function asId(value) {
  return value === undefined || value === null ? "" : String(value);
}

function utf8Encode(text) {
  if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(text));
  const encoded = encodeURIComponent(text);
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.codePointAt(index));
    }
  }
  return bytes;
}

function utf8Decode(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(new Uint8Array(bytes));
  return decodeURIComponent(String.fromCodePoint(...bytes));
}

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62Encode(bytes) {
  const source = Array.from(bytes || [], (byte) => Number(byte) & 255);
  if (source.length === 0) return "";
  let leadingZeroCount = 0;
  while (leadingZeroCount < source.length && source[leadingZeroCount] === 0) leadingZeroCount += 1;
  let value = 0n;
  source.forEach((byte) => {
    value = (value << 8n) | BigInt(byte);
  });
  let digits = "";
  while (value > 0n) {
    digits = BASE62_CHARS[Number(value % 62n)] + digits;
    value /= 62n;
  }
  return "0".repeat(leadingZeroCount) + digits;
}

function base62Decode(value) {
  const encoded = String(value || "");
  if (!encoded) return [];
  let leadingZeroCount = 0;
  while (leadingZeroCount < encoded.length && encoded[leadingZeroCount] === "0") leadingZeroCount += 1;
  let number = 0n;
  for (let index = leadingZeroCount; index < encoded.length; index += 1) {
    const digit = BASE62_CHARS.indexOf(encoded[index]);
    if (digit < 0) throw new Error("invalid base62");
    number = number * 62n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  bytes.reverse();
  return [...Array.from({ length: leadingZeroCount }, () => 0), ...bytes];
}

function encodeBytes(bytes) {
  return base62Encode(bytes);
}

function decodeBytes(value) {
  return base62Decode(value || "");
}

function encodePayload(payload) {
  return encodeBytes(utf8Encode(JSON.stringify(payload)));
}

function decodePayload(value) {
  return JSON.parse(utf8Decode(decodeBytes(value)));
}

function toStableNumericId(value) {
  const id = asId(value);
  if (!/^(0|[1-9]\d*)$/.test(id)) return null;
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) && numericId <= 65535 ? numericId : null;
}

function encodeStableRanks(ranks) {
  const entries = Object.entries(normalizeRanks(ranks))
    .filter(([, rank]) => rank > 0)
    .map(([id, rank]) => ({
      id,
      numericId: toStableNumericId(id),
      rank: Math.min(255, Math.floor(Number(rank) || 0))
    }))
    .sort((left, right) => {
      if (left.numericId !== null && right.numericId !== null) return left.numericId - right.numericId;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
  if (entries.some(({ numericId }) => numericId === null)) {
    throw new TypeError("Simulation ranks require stable numeric node IDs.");
  }
  const bytes = new Uint8Array(entries.length * 3);
  entries.forEach(({ numericId, rank }, offset) => {
    const byteOffset = offset * 3;
    bytes[byteOffset] = (numericId >> 8) & 255;
    bytes[byteOffset + 1] = numericId & 255;
    bytes[byteOffset + 2] = rank;
  });
  return `${STABLE_RANK_FORMAT}${encodeBytes(bytes)}`;
}

function decodeStableRanks(value) {
  if (Array.isArray(value)) return value;
  const encoded = String(value || "");
  if (!encoded.startsWith(STABLE_RANK_FORMAT)) throw new Error("invalid stable ranks");
  const bytes = decodeBytes(encoded.slice(STABLE_RANK_FORMAT.length));
  if (bytes.length % 3 !== 0) throw new Error("invalid stable ranks");
  const entries = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    entries.push({
      id: String((bytes[offset] << 8) | bytes[offset + 1]),
      rank: bytes[offset + 2]
    });
  }
  return entries;
}

export function getDataVersion(treeData) {
  const explicit = treeData?.meta?.data_version ?? treeData?.meta?.version ?? treeData?.summary?.data_version ?? treeData?.summary?.version;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) return String(explicit);
  const canonical = (treeData?.nodes || []).map((node) => ({
    id: asId(node?.id),
    max: node?.max_rank ?? node?.max_level ?? 1,
    incoming: Array.isArray(node?.incoming) ? node.incoming.map(asId) : [],
    next: Array.isArray(node?.next_nodes) ? node.next_nodes.map(asId) : [],
    gold: Array.isArray(node?.gold_costs) ? node.gold_costs : [],
    core: Array.isArray(node?.core_costs) ? node.core_costs : [],
    condition: node?.unlock_condition || "",
    conditionValue: node?.unlock_condition_value || ""
  })).sort((left, right) => left.id.localeCompare(right.id));
  const text = JSON.stringify({ nodes: canonical, edges: treeData?.edges || [] });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.codePointAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableNodeRef(id) {
  const normalizedId = asId(id);
  const numericId = toStableNumericId(normalizedId);
  return numericId === null ? normalizedId : numericId;
}

function compactStableTeam(team) {
  const normalized = normalizeTeam(team);
  return {
    d: normalized.dice.map((entry) => [
      stableNodeRef(entry.id),
      entry.runes.map((rune) => [stableNodeRef(rune.id), rune.rank])
    ]),
    c: normalized.commonNodes.map((entry) => [stableNodeRef(entry.id), entry.rank])
  };
}

function decodeStableTeam(team) {
  return normalizeTeam({
    dice: Array.isArray(team?.d) ? team.d.slice(0, MAX_SIMULATION_TEAM_DICE).map((entry) => ({
      id: asId(entry?.[0]),
      runes: Array.isArray(entry?.[1])
        ? entry[1].slice(0, MAX_SIMULATION_TEAM_RUNES_PER_DIE).map((rune) => ({
          id: asId(rune?.[0]),
          rank: rune?.[1]
        }))
        : []
    })) : [],
    commonNodes: Array.isArray(team?.c)
      ? team.c.slice(0, MAX_SIMULATION_TEAM_COMMON_NODES).map((entry) => ({
        id: asId(entry?.[0]),
        rank: entry?.[1]
      }))
      : []
  });
}

export function createSimulationSharePayload({ simulation, treeData, team, dataVersion } = {}) {
  const ranks = normalizeRanks(simulation?.ranks);
  return {
    k: SIMULATION_SHARE_KIND,
    v: SIMULATION_SHARE_VERSION,
    d: String(dataVersion || simulation?.dataVersion || getDataVersion(treeData)),
    r: encodeStableRanks(ranks),
    t: compactStableTeam(team ?? simulation?.team)
  };
}

export function encodeSimulationShare(payload) {
  const ranks = typeof payload?.r === "string" ? payload.r : [];
  const normalized = {
    k: SIMULATION_SHARE_KIND,
    v: SIMULATION_SHARE_VERSION,
    d: String(payload?.d || "unknown"),
    r: ranks,
    t: payload?.t || { d: [], c: [] }
  };
  return encodePayload(normalized);
}

export function buildSimulationShareUrl({ payload, origin } = {}) {
  const encoded = encodeSimulationShare(payload);
  const base = origin || "";
  const path = buildSimulationSharePath({ share: encoded, shareKind: "state" });
  return `${base}${path}`;
}

export function buildSimulationShareCodeUrl({ code, origin } = {}) {
  const normalizedCode = String(code || "");
  const base = origin || "";
  const path = buildSimulationSharePath({ share: normalizedCode, shareKind: "code" });
  return `${base}${path}`;
}

function collectShareQueryParts(value) {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const queryParts = [];
  if (queryIndex >= 0) {
    queryParts.push(value.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : value.length));
  }
  if (hashIndex >= 0) queryParts.push(value.slice(hashIndex + 1));
  return queryParts.length > 0 ? queryParts : [value];
}

function findEncodedShareInQuery(queryPart, markers) {
  const query = queryPart.startsWith("#") ? queryPart.slice(1) : queryPart;
  for (const part of query.split("&")) {
    for (const marker of markers) {
      if (part.startsWith(marker.encoded)) return part.slice(marker.encoded.length);
      if (part.startsWith(marker.plain)) return part.slice(marker.plain.length);
    }
  }
  return null;
}

function extractEncodedShare(input, searchParam = SIMULATION_SHARE_SEARCH_PARAM) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (value.startsWith("{")) return value;
  const route = parseUrlState(value);
  if (route.kind === URL_ROUTE_KINDS.SIMULATION && route.share) return route.share;
  const markers = [...new Set([searchParam, SIMULATION_SHARE_SEARCH_PARAM, "sim"])]
    .map((name) => ({ encoded: `${encodeURIComponent(name)}=`, plain: `${name}=` }));
  for (const queryPart of collectShareQueryParts(value)) {
    const encodedShare = findEncodedShareInQuery(queryPart, markers);
    if (encodedShare !== null) return encodedShare;
  }
  return value;
}

export function decodeSimulationShare(input, options = {}) {
  if (typeof input === "string" && input.length > MAX_SIMULATION_SHARE_URL_LENGTH) {
    return markDecodedShareResult({ ok: false, warnings: ["share-too-large"] });
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    // Keep the decoder idempotent for application callers that already hold
    // a decoded result or the `{ payload, encoded, url }` object returned by
    // `serializeSimulationState`.
    // Only results produced by this decoder may bypass payload validation. A
    // plain object with an attacker-controlled `ok: true` must still be
    // treated as an untrusted payload.
    if (input[DECODED_SHARE_RESULT]) return input;
    return decodeSimulationSharePayload(input.payload?.k ? input.payload : input);
  }
  const encoded = extractEncodedShare(input, options.searchParam || SIMULATION_SHARE_SEARCH_PARAM);
  if (!encoded) return markDecodedShareResult({ ok: false, warnings: ["missing-share"] });
  if (encoded.length > MAX_SIMULATION_SHARE_ENCODED_LENGTH) {
    return markDecodedShareResult({ ok: false, warnings: ["share-too-large"] });
  }
  let payload;
  try {
    payload = encoded.startsWith("{") ? JSON.parse(encoded) : decodePayload(decodeURIComponent(encoded));
  } catch {
    return markDecodedShareResult({ ok: false, warnings: ["invalid-share"] });
  }
  return decodeSimulationSharePayload(payload);
}

function decodeSimulationSharePayload(payload) {
  if (payload?.k !== SIMULATION_SHARE_KIND) {
    return markDecodedShareResult({ ok: false, warnings: ["unknown-share-kind"], payload });
  }
  const version = Number(payload.v);
  if (version !== SIMULATION_SHARE_VERSION) {
    return markDecodedShareResult({ ok: false, warnings: ["unsupported-share-version"], payload });
  }
  const warnings = [];
  let ranks;
  let team;
  try {
    ranks = decodeStableRanks(payload.r);
    team = decodeStableTeam(payload.t || { d: [], c: [] });
  } catch {
    return markDecodedShareResult({ ok: false, warnings: ["invalid-share"] });
  }
  if (ranks.length > MAX_SIMULATION_SHARE_RANK_ENTRIES) {
    warnings.push("share-ranks-truncated");
  }
  if (Array.isArray(payload.t?.d) && payload.t.d.length > MAX_SIMULATION_TEAM_DICE) {
    warnings.push("share-team-dice-truncated");
  }
  if (Array.isArray(payload.t?.d) && payload.t.d.some((entry) => Array.isArray(entry?.[1]) && entry[1].length > MAX_SIMULATION_TEAM_RUNES_PER_DIE)) {
    warnings.push("share-team-runes-truncated");
  }
  if (Array.isArray(payload.t?.c) && payload.t.c.length > MAX_SIMULATION_TEAM_COMMON_NODES) {
    warnings.push("share-team-common-truncated");
  }
  return markDecodedShareResult({
    ok: true,
    version,
    dataVersion: String(payload.d || "unknown"),
    ranks,
    team,
    payload,
    warnings
  });
}

function normalizeShareRanks(ranks) {
  const normalized = {};
  for (const entry of Array.isArray(ranks) ? ranks.slice(0, MAX_SIMULATION_SHARE_RANK_ENTRIES) : []) {
    const id = asId(entry?.[0] ?? entry?.id);
    const rank = Number(entry?.[1] ?? entry?.rank);
    if (id && Number.isFinite(rank) && rank > 0) normalized[id] = Math.floor(rank);
  }
  return normalized;
}

export function hydrateSimulationShare(decoded, nodesOrMap, options = {}) {
  const nodesMap = getNodeMap(nodesOrMap);
  const warnings = [...(decoded?.warnings || [])];
  const ranks = {};
  const initialIds = [];
  nodesMap.forEach((node, id) => {
    if (isInitialSimulationNode(node)) {
      initialIds.push(id);
      ranks[id] = 1;
    }
  });
  const rawRanks = normalizeShareRanks(decoded?.ranks);
  const candidateRanks = { ...ranks };
  Object.entries(rawRanks).forEach(([id, rawRank]) => {
    if (nodesMap.has(id)) candidateRanks[id] = Math.min(getMaxRank(nodesMap.get(id)), rawRank);
  });
  Object.entries(rawRanks).forEach(([id, rawRank]) => {
    const node = nodesMap.get(id);
    if (!node) {
      warnings.push(`unknown-node:${id}`);
      return;
    }
    if (isSpecialUnlockNode(node, { ranks: candidateRanks }, nodesMap)) {
      warnings.push(`special-condition:${id}`);
      return;
    }
    const rank = Math.min(getMaxRank(node), rawRank);
    if (rank > 0) ranks[id] = rank;
  });

  // A share is user-controlled input. Keep only a prerequisite-closed set so
  // Invalid or adversarial links cannot make an impossible descendant appear
  // unlocked after a data refresh.
  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(ranks).forEach((id) => {
      const node = nodesMap.get(id);
      // The simulator intentionally starts with the five base dice plus the
      // three externally granted dice. Their canonical graph edges remain
      // available for topology display and must not remove those pre-unlocked
      // ranks when a share is hydrated.
      if (isInitialSimulationNode(node)) return;
      if (isSpecialUnlockNode(node, { ranks }, nodesMap)) {
        delete ranks[id];
        warnings.push(`special-condition:${id}`);
        changed = true;
        return;
      }
      const prerequisites = Array.isArray(node?.incoming) ? node.incoming.map(asId) : [];
      const missing = prerequisites.filter((prerequisite) => !ranks[prerequisite]);
      if (missing.length > 0) {
        delete ranks[id];
        warnings.push(`missing-prerequisite:${id}`);
        changed = true;
      }
    });
  }

  const normalizedTeam = normalizeTeam(decoded?.team);
  const dice = [];
  normalizedTeam.dice.forEach((entry) => {
    if (!nodesMap.has(entry.id) || nodesMap.get(entry.id)?.node_type !== "DICE") {
      warnings.push(`unknown-team-dice:${entry.id}`);
      return;
    }
    const runes = entry.runes.filter((rune) => {
      const runeNode = nodesMap.get(rune.id);
      if (runeNode?.node_type !== "DICE_RUNE") {
        warnings.push(`unknown-team-rune:${rune.id}`);
        return false;
      }
      return true;
    }).map((rune) => ({ id: rune.id, rank: Math.max(1, Math.min(getMaxRank(nodesMap.get(rune.id)), rune.rank || 1)) }));
    dice.push({ id: entry.id, runes });
  });
  const commonNodes = normalizedTeam.commonNodes.filter((entry) => {
    if (!nodesMap.has(entry.id)) {
      warnings.push(`unknown-team-common:${entry.id}`);
      return false;
    }
    const type = nodesMap.get(entry.id)?.node_type;
    if (type !== "PLAYER_PASSIVE" && type !== "PERK") {
      warnings.push(`invalid-team-common:${entry.id}`);
      return false;
    }
    return true;
  }).map((entry) => ({ id: entry.id, rank: Math.max(1, Math.min(getMaxRank(nodesMap.get(entry.id)), entry.rank || 1)) }));

  return {
    active: options.active !== false,
    ranks,
    initialIds,
    spent: { gold: 0, core: 0 },
    team: { dice, commonNodes },
    dataVersion: String(decoded?.dataVersion || options.dataVersion || "unknown"),
    warnings: [...new Set(warnings)]
  };
}

export function serializeSimulationState({ simulation, treeData, origin, dataVersion } = {}) {
  const payload = createSimulationSharePayload({ simulation, treeData, team: simulation?.team, dataVersion });
  return {
    payload,
    encoded: encodeSimulationShare(payload),
    url: buildSimulationShareUrl({ payload, origin })
  };
}
