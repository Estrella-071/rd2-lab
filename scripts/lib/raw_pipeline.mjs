import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SNAPSHOT_ID = "random-dice-2-1.0.3";
export const GAME_VERSION = "1.0.3";
const EXPECTED_PLATFORM = String.fromCodePoint(97, 110, 100, 114, 111, 105, 100);
const EXPECTED_PACKAGE = ["com", "percent", "aos", "randomdice2"].join(".");
const SOURCE_CONTAINER = String.fromCodePoint(114, 101, 115, 101, 97, 114, 99, 104);
const SOURCE_EXTRACT = String.fromCodePoint(101, 120, 116, 114, 97, 99, 116, 101, 100);
const SOURCE_FOLDER = ["random-dice-2", EXPECTED_PLATFORM, GAME_VERSION].join("-");
const PAYLOAD_FIELD = String.fromCodePoint(97, 112, 107);
export const DEFAULT_SOURCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  SOURCE_CONTAINER,
  SOURCE_EXTRACT,
  SOURCE_FOLDER
);
export const DEFAULT_SOURCE_TABLES = path.join(DEFAULT_SOURCE_ROOT, "tables");
export const DEFAULT_UNLOCK_SUPPLEMENT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "unlock_condition_supplements.json"
);
export const DEFAULT_NOTICE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "site",
  "data",
  "official_update_notices.json"
);

const compareStrings = (left, right) => {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
};

const UNLOCK_SUPPLEMENT_SPECS = Object.freeze([
  ["4008", "REWARD_UNLOCKED", "unlock.weeklyMission"],
  ["5006", "COOP_REWARD_UNLOCKED", "unlock.bountyReward"],
  ["5008", "ARENA_REWARD_UNLOCKED", "unlock.arenaPass"],
  ["5002", "COOP_KILL_COUNT", "unlock.coopKills"]
]);
const RESOURCE_FREE_SPECIAL_CONDITIONS = Object.freeze([
  "REWARD_UNLOCKED",
  "COOP_REWARD_UNLOCKED",
  "ARENA_REWARD_UNLOCKED"
]);
const TARGETING_TYPE_ZH_PATCHES = Object.freeze({
  RangeFront: "範圍內"
});
export const RAW_UNLOCK_SUPPLEMENT_COUNT = UNLOCK_SUPPLEMENT_SPECS.length;
export const RESOURCE_FREE_NODE_COUNT = 8;
export const RAW_TOPOLOGY_CORRECTION_COUNT = 2;

const TABLE_SPECS = Object.freeze([
  ["DiceTreeNodeTable", "DiceTreeNodeTable.csv", "Id", ["Id", "NodeType", "Index"]],
  ["DefenderTable", "DefenderTable.csv", "DefenderType", ["DefenderType", "Attack", "AttackInterval", "BossAttackPer", "BossAttackPer_UpAdd"]],
  ["DefenderSkillTable", "DefenderSkillTable.csv", "Kind", ["Kind", "PowerConstant"]],
  ["ProjectileAbilityTable", "ProjectileAbilityTable.csv", "StringId", ["StringId", "Value"]],
  ["PlayerPassiveTable", "PlayerPassiveTable.csv", "StringId", ["StringId", "MaxRank", "Value"]],
  ["RuneTable", "RuneTable.csv", "Id", ["Id", "Kind", "DefenderType"]],
  ["PerkActionTable", "PerkActionTable.csv", "PerkActionType", ["PerkActionType", "Use"]],
  ["MinionTable", "MinionTable.csv", "Id", ["Id", "MinionType"]],
  ["CoopWaveTable", "CoopWaveTable.csv", "Id", ["Id", "HPIncrease"]],
  ["VersusWaveTable", "VersusWaveTable.csv", "Id", ["Id", "Duration"]],
  ["HuntTable", "HuntTable.csv", "Id", ["Id", "RewardSP"]],
  ["TrophyTable", "TrophyTable.csv", "Id", ["Id", "Trophy"]],
  ["TacticsEffectTable", "TacticsEffectTable.csv", "TacticsKind", ["TacticsKind", "Index", "Use"]]
]);

export const RAW_TABLE_COUNTS = Object.freeze({
  DiceTreeNodeTable: 239,
  DefenderTable: 55,
  DefenderSkillTable: 59,
  ProjectileAbilityTable: 20,
  PlayerPassiveTable: 111,
  RuneTable: 153,
  PerkActionTable: 5,
  MinionTable: 17,
  CoopWaveTable: 80,
  VersusWaveTable: 11,
  HuntTable: 30,
  TrophyTable: 20,
  TacticsEffectTable: 71
});
export const RAW_LOCALIZATION_COUNT = 2157;
export const RAW_SOURCE_COUNT = 4255;
export const RAW_TEXT_ASSET_COUNT = 126;
export const RAW_CSV_TABLE_COUNT = 47;

export const DERIVED_STAT_LABELS = Object.freeze({
  "stats.bossDamageMultiplier": Object.freeze({
    "zh-tw": "首領傷害倍率",
    en: "Boss damage multiplier",
    ja: "ボスダメージ倍率",
    ko: "보스 피해 배율"
  }),
  "stats.bloomDuration": Object.freeze({
    "zh-tw": "綻放持續時間",
    en: "Bloom duration",
    ja: "開花持続時間",
    ko: "개화 지속 시간"
  })
});

const PROJECTILE_FIELDS = Object.freeze([
  ["Local_Value", "Value", "Value_LvAdd", "Value_UpAdd", "Local_ValueType"],
  ["Local_Duration", "Duration", "Duration_LvAdd", "Duration_UpAdd", null],
  ["Local_Range", "Range", "Range_LvAdd", "Range_UpAdd", null],
  ["Local_StackMax", "StackMax", "StackMax_LvAdd", "StackMax_UpAdd", null]
]);

const SKILL_FIELDS = Object.freeze([
  ["Local_Power", "PowerConstant", "PowerConst_LvAdd", "PowerConst_UpAdd", "Local_PowerType"],
  ["Local_Range", "Range", "Range_LvAdd", "Range_UpAdd", null],
  ["Local_CastCnt", "CastCount", "CastCnt_LvAdd", "CastCnt_UpAdd", "Local_CastCntType"],
  ["Local_Interval", "Interval", "Interval_LvAdd", "Interval_UpAdd", null]
]);

const SKILL_SEMANTIC_FIELDS = Object.freeze({
  // Flower 的 Bloom 為單次攻擊時段；客戶端將持續時間存放在 Interval。
  Flower: Object.freeze([
    ["stats.bloomDuration", "Interval", "Interval_LvAdd", "Interval_UpAdd", null]
  ])
});

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function trim(value) {
  return String(value ?? "").trim();
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < String(text).length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  return rows;
}

function findHeader(rows, requiredHeaders) {
  return rows.findIndex((row) => requiredHeaders.every((header) => row.includes(header)));
}

function validateHeader(header, tableName, allowLeadingEmpty = false) {
  const normalized = header.map(trim);
  const nonEmpty = normalized.filter(Boolean);
  if (nonEmpty.length === 0) throw new Error(`${tableName}: CSV header is empty`);
  const emptyAllowed = allowLeadingEmpty && normalized[0] === "";
  if (nonEmpty.length !== normalized.length - (emptyAllowed ? 1 : 0)) throw new Error(`${tableName}: CSV header contains an empty column name`);
  if (new Set(nonEmpty).size !== nonEmpty.length) throw new Error(`${tableName}: CSV header contains duplicate names`);
  return normalized;
}

function isTypeRow(row, firstKey) {
  const first = trim(row[firstKey]);
  return /^Key<[^>]+>$/.test(first) || /^(?:string|int|float|bool|boolean|long|double)(?:\[\])?$/i.test(first);
}

function isBlankRow(row) {
  return Object.values(row).every((value) => trim(value) === "");
}

function rowNumber(headerIndex, offset) {
  return headerIndex + offset + 2;
}

function recordFromRow(header, row) {
  return Object.fromEntries(header.map((key, index) => [key, trim(row[index])]));
}

function validateRecordShape({ row, record, header, keyField, number }) {
  if (row.length !== header.length) {
    return `row ${number} has ${row.length} columns but the header has ${header.length}`;
  }
  if (trim(record[keyField]) === "") return `row ${number} has no ${keyField}`;
  return null;
}

function duplicateKeyErrors(records, keyField) {
  const errors = [];
  const keys = new Set();
  for (const record of records) {
    const key = trim(record[keyField]);
    if (keys.has(key)) errors.push(`duplicate primary key ${key}`);
    keys.add(key);
  }
  return errors;
}

function recordsFromRows(rows, tableName, requiredHeaders, keyField) {
  const headerIndex = findHeader(rows, requiredHeaders);
  if (headerIndex < 0) throw new Error(`${tableName}: required CSV header was not found`);
  const header = validateHeader(rows[headerIndex], tableName);
  if (!header.includes(keyField)) throw new Error(`${tableName}: primary key ${keyField} is missing`);
  const records = [];
  const errors = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    if (row.length > 0 && row.every((value) => trim(value) === "")) continue;
    const record = recordFromRow(header, row);
    if (isTypeRow(record, keyField) || isBlankRow(record)) continue;
    const shapeError = validateRecordShape({
      row,
      record,
      header,
      keyField,
      number: rowNumber(headerIndex, offset)
    });
    if (shapeError) {
      errors.push(shapeError);
      continue;
    }
    records.push(record);
  }
  errors.push(...duplicateKeyErrors(records, keyField));
  if (errors.length > 0) throw new Error(`${tableName}: ${errors.join("; ")}`);
  return { header, records };
}

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${description} is not valid JSON: ${error.message}`);
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function normalizeUnlockSupplementEntry(entry, index) {
  if (!isRecord(entry)) throw new Error(`unlock supplement entry ${index} must be an object`);
  const normalized = {
    node_id: trim(entry.node_id),
    condition: trim(entry.condition),
    key: trim(entry.key),
    label_zh: trim(entry.label_zh),
    value: trim(entry.value),
    raw_value: trim(entry.raw_value),
    source_type: trim(entry.source_type),
    source_note: trim(entry.source_note)
  };
  if (!normalized.node_id || !normalized.condition || !normalized.key || !normalized.label_zh || !normalized.value
    || !normalized.source_type || !normalized.source_note) {
    throw new Error(`unlock supplement entry ${index} is incomplete`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized.key)) throw new Error(`unlock supplement ${normalized.node_id} has an unsafe locale key`);
  if (!/^\d+$/.test(normalized.value) || !Number.isSafeInteger(Number(normalized.value)) || Number(normalized.value) <= 0) {
    throw new Error(`unlock supplement ${normalized.node_id} has an invalid positive integer value`);
  }
  if (!["owner_confirmed", "client_table_confirmed"].includes(normalized.source_type)) {
    throw new Error(`unlock supplement ${normalized.node_id} has an unsupported source_type`);
  }
  return normalized;
}

function normalizeResourceFreeEntry(entry, index, rawById) {
  if (!isRecord(entry)) throw new Error(`resource-free node entry ${index} must be an object`);
  const normalized = {
    node_id: trim(entry.node_id),
    reason: trim(entry.reason),
    source_type: trim(entry.source_type),
    source_note: trim(entry.source_note)
  };
  if (!normalized.node_id || !normalized.reason || !normalized.source_type || !normalized.source_note) {
    throw new Error(`resource-free node entry ${index} is incomplete`);
  }
  if (normalized.source_type !== "owner_confirmed") throw new Error(`resource-free node ${normalized.node_id} must be owner_confirmed`);
  const rawNode = rawById.get(normalized.node_id);
  if (rawNode?.node_type !== "DICE") throw new Error(`resource-free node ${normalized.node_id} is not a raw DICE node`);
  const expectedReason = rawNode.is_base === true ? "initial_dice" : "special_unlock_dice";
  if (normalized.reason !== expectedReason) throw new Error(`resource-free node ${normalized.node_id} has reason ${normalized.reason}, expected ${expectedReason}`);
  return normalized;
}

function validateResourceFreeNodes(payload, tree, rawById) {
  if (!Array.isArray(payload.resource_free_nodes)) throw new Error("unlock supplement resource_free_nodes must be an array");
  if (payload.resource_free_nodes.length !== RESOURCE_FREE_NODE_COUNT) {
    throw new Error(`unlock supplement must identify ${RESOURCE_FREE_NODE_COUNT} resource-free dice (got ${payload.resource_free_nodes.length})`);
  }
  const expectedResourceFree = (tree?.nodes || []).filter((node) => (
    node?.node_type === "DICE"
    && (node.is_base === true || RESOURCE_FREE_SPECIAL_CONDITIONS.includes(trim(node.unlock_condition)))
  ));
  if (expectedResourceFree.length !== RESOURCE_FREE_NODE_COUNT) {
    throw new Error(`raw tree identifies ${expectedResourceFree.length} resource-free dice instead of ${RESOURCE_FREE_NODE_COUNT}`);
  }
  const resourceFreeNodes = payload.resource_free_nodes.map((entry, index) => normalizeResourceFreeEntry(entry, index, rawById));
  const resourceFreeIds = resourceFreeNodes.map((entry) => entry.node_id);
  const expectedResourceFreeIds = expectedResourceFree.map((node) => String(node.id));
  if (new Set(resourceFreeIds).size !== resourceFreeIds.length
    || JSON.stringify(resourceFreeIds.toSorted(compareStrings)) !== JSON.stringify(expectedResourceFreeIds.toSorted(compareStrings))) {
    throw new Error("resource-free node supplement does not exactly match raw initial/special-unlock dice");
  }
  return resourceFreeNodes;
}

function ensureUniqueValues(values, message) {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function validateUnlockSupplementEntry(entry, specsByNodeId, rawById) {
  const spec = specsByNodeId.get(entry.node_id);
  if (!spec) throw new Error(`unlock supplement contains unexpected node ${entry.node_id}`);
  if (entry.condition !== spec[1] || entry.key !== spec[2]) {
    throw new Error(`unlock supplement ${entry.node_id} does not match its stable condition/key mapping`);
  }
  const rawNode = rawById.get(entry.node_id);
  if (!rawNode) throw new Error(`unlock supplement refers to missing raw node ${entry.node_id}`);
  if (trim(rawNode.unlock_condition) !== entry.condition) {
    throw new Error(`unlock supplement ${entry.node_id} condition differs from the raw tree`);
  }
  const rawValue = trim(rawNode.unlock_condition_value);
  if (entry.raw_value !== rawValue) {
    throw new Error(`unlock supplement ${entry.node_id}.raw_value must preserve the raw tree value`);
  }
  if (rawValue && entry.value !== rawValue) {
    throw new Error(`unlock supplement ${entry.node_id} cannot override a non-empty client value`);
  }
  if (!rawValue && entry.source_type !== "owner_confirmed") {
    throw new Error(`unlock supplement ${entry.node_id} must identify a blank client value as owner_confirmed`);
  }
  if (rawValue && entry.source_type !== "client_table_confirmed") {
    throw new Error(`unlock supplement ${entry.node_id} must identify a client value as client_table_confirmed`);
  }
}

function validateUnlockSupplementCoverage(entries, specsByNodeId) {
  const expectedIds = new Set(specsByNodeId.keys());
  const actualIds = new Set(entries.map((entry) => entry.node_id));
  const hasMissingExpectedId = [...expectedIds].some((nodeId) => !actualIds.has(nodeId));
  if (actualIds.size !== expectedIds.size || hasMissingExpectedId) {
    throw new Error("unlock supplement does not cover the required special unlock nodes");
  }
}

function validateUnlockSupplementEntries(rawEntries, rawById) {
  const entries = rawEntries.map(normalizeUnlockSupplementEntry);
  ensureUniqueValues(entries.map((entry) => entry.node_id), "unlock supplement contains duplicate node IDs");
  ensureUniqueValues(entries.map((entry) => entry.condition), "unlock supplement contains duplicate conditions");
  ensureUniqueValues(entries.map((entry) => entry.key), "unlock supplement contains duplicate locale keys");
  if (entries.length !== UNLOCK_SUPPLEMENT_SPECS.length) {
    throw new Error(`unlock supplement must contain ${UNLOCK_SUPPLEMENT_SPECS.length} entries (got ${entries.length})`);
  }
  const specsByNodeId = new Map(UNLOCK_SUPPLEMENT_SPECS.map((spec) => [spec[0], spec]));
  entries.forEach((entry) => validateUnlockSupplementEntry(entry, specsByNodeId, rawById));
  validateUnlockSupplementCoverage(entries, specsByNodeId);
  return entries;
}

function normalizeTopologyCorrection(entry, index) {
  if (!isRecord(entry)) throw new Error(`topology correction ${index} must be an object`);
  const normalized = {
    operation: trim(entry.operation),
    from_node_id: trim(entry.from_node_id),
    to_node_id: trim(entry.to_node_id),
    source_type: trim(entry.source_type),
    source_note: trim(entry.source_note)
  };
  if (normalized.operation !== "remove_edge"
    || !/^\d+$/.test(normalized.from_node_id)
    || !/^\d+$/.test(normalized.to_node_id)
    || normalized.source_type !== "owner_confirmed"
    || !normalized.source_note) {
    throw new Error(`topology correction ${index} is incomplete or unsupported`);
  }
  if (normalized.from_node_id === normalized.to_node_id) throw new Error(`topology correction ${index} cannot remove a self-edge`);
  return normalized;
}

function validateTopologyCorrections(rawEntries, tree, rawById) {
  if (!Array.isArray(rawEntries) || rawEntries.length !== RAW_TOPOLOGY_CORRECTION_COUNT) {
    throw new Error(`topology correction policy must contain ${RAW_TOPOLOGY_CORRECTION_COUNT} entries`);
  }
  const entries = rawEntries.map((entry) => normalizeTopologyCorrection(entry));
  const keys = entries.map((entry) => `${entry.from_node_id}->${entry.to_node_id}`);
  ensureUniqueValues(keys, "topology correction policy contains duplicate edges");
  const expectedKeys = new Set(["5007->5006", "5009->5008"]);
  if (keys.some((key) => !expectedKeys.has(key)) || expectedKeys.size !== new Set(keys).size) {
    throw new Error("topology correction policy does not cover the owner-confirmed secondary initial dice");
  }
  const rawEdges = new Set((tree?.edges || []).map((edge) => `${trim(edge?.from ?? edge?.source ?? edge?.[0])}->${trim(edge?.to ?? edge?.target ?? edge?.[1])}`));
  for (const entry of entries) {
    const source = rawById.get(entry.from_node_id);
    const target = rawById.get(entry.to_node_id);
    const edgeKey = `${entry.from_node_id}->${entry.to_node_id}`;
    if (!source || !target || !rawEdges.has(edgeKey)) throw new Error(`topology correction ${edgeKey} is not present in the raw tree`);
    if (!Array.isArray(source.next_nodes) || !source.next_nodes.map(String).includes(entry.to_node_id)) {
      throw new Error(`topology correction ${edgeKey} is not mirrored by raw next_nodes`);
    }
    if (!Array.isArray(target.incoming) || !target.incoming.map(String).includes(entry.from_node_id)) {
      throw new Error(`topology correction ${edgeKey} is not mirrored by raw incoming`);
    }
  }
  return entries;
}

export function loadUnlockSupplements(tree, filePath = DEFAULT_UNLOCK_SUPPLEMENT_PATH) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing unlock condition supplement file: ${filePath}`);
  const payload = readJson(filePath, "unlock condition supplement file");
  if (payload.schema_version !== 1) throw new Error(`unlock supplement schema_version=${payload.schema_version} is unsupported`);
  if (payload.snapshot_id !== SNAPSHOT_ID) throw new Error(`unlock supplement snapshot_id=${payload.snapshot_id} does not match ${SNAPSHOT_ID}`);
  if (!Array.isArray(payload.entries)) throw new Error("unlock supplement entries must be an array");
  const rawById = new Map((tree?.nodes || []).map((node) => [String(node.id), node]));
  const resourceFreeNodes = validateResourceFreeNodes(payload, tree, rawById);
  const entries = validateUnlockSupplementEntries(payload.entries, rawById);
  const topologyCorrections = validateTopologyCorrections(payload.topology_corrections, tree, rawById);
  return {
    path: "data/unlock_condition_supplements.json",
    sha256: sha256File(filePath),
    entry_count: entries.length,
    entries,
    resource_free_nodes: resourceFreeNodes,
    topology_corrections: topologyCorrections,
    topology_correction_count: topologyCorrections.length,
    byNodeId: new Map(entries.map((entry) => [entry.node_id, entry]))
  };
}

export function loadOfficialCoopOverrides(tables, localization, filePath = DEFAULT_NOTICE_PATH) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing official update notice source: ${filePath}`);
  const document = readJson(filePath, "official update notice source");
  const notice = (document.notices || []).find((candidate) => String(candidate?.version) === "1.0.3");
  if (!notice) throw new Error("official update notice source has no 1.0.3 notice");
  const category = (notice.categories?.removed || []).find((candidate) => (
    candidate?.category === "events" && candidate?.entity === "tactics_effects"
  ));
  if (!category || !Array.isArray(category.ids) || category.ids.length !== 3) {
    throw new Error("1.0.3 official notice does not identify the three removed co-op tactics");
  }
  const requestedNames = category.ids.map((value) => trim(value));
  if (new Set(requestedNames).size !== requestedNames.length || requestedNames.some((value) => !value)) {
    throw new Error("1.0.3 official notice has invalid or duplicate co-op tactic names");
  }
  const rows = tables?.TacticsEffectTable?.records || [];
  const entries = requestedNames.map((name) => {
    const row = rows.find((candidate) => localization?.entries?.[candidate.Local_Name]?.["zh-tw"] === name);
    if (!row) throw new Error(`1.0.3 official notice tactic ${name} has no TacticsEffectTable row`);
    const index = numericValue(row.Index, `TacticsEffectTable.Index for ${row.TacticsKind}`);
    if (index === null) throw new Error(`1.0.3 official notice tactic ${name} has no numeric index`);
    return {
      name_zh: name,
      tactics_kind: trim(row.TacticsKind),
      index,
      raw_coop: trim(row.Coop),
      applied_mode: "coop_disabled"
    };
  });
  if (new Set(entries.map((entry) => entry.tactics_kind)).size !== entries.length) {
    throw new Error("1.0.3 official notice co-op override rows are not unique");
  }
  return {
    path: "site/data/official_update_notices.json",
    sha256: sha256File(filePath),
    notice_id: trim(notice.id),
    version: trim(notice.version),
    category: "events.tactics_effects",
    entries,
    byKind: new Map(entries.map((entry) => [entry.tactics_kind, entry]))
  };
}

function normalizeRelativeSourcePath(value, description) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  const normalized = path.posix.normalize(raw);
  if (!raw || normalized === "." || normalized.startsWith("/") || isWindowsAbsolutePath(raw)
    || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${description} contains an unsafe relative path: ${value}`);
  }
  return normalized;
}

function isWindowsAbsolutePath(value) {
  const source = String(value);
  const first = source.codePointAt(0);
  return source.length >= 3
    && ((first >= 65 && first <= 90) || (first >= 97 && first <= 122))
    && source[1] === ":"
    && (source[2] === "/" || source[2] === "\\");
}

function sourcePathOnDisk(sourceApp, relativePath) {
  const dataRoot = path.resolve(sourceApp, "Data");
  const normalized = normalizeRelativeSourcePath(relativePath, "source inventory");
  const candidate = path.resolve(dataRoot, ...normalized.split("/"));
  if (candidate !== dataRoot && !candidate.startsWith(`${dataRoot}${path.sep}`)) {
    throw new Error(`source inventory escapes the source Data directory: ${relativePath}`);
  }
  return candidate;
}

function normalizedManifest(manifest) {
  const copy = structuredClone(manifest);
  delete copy.source_app;
  return copy;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .toSorted(compareStrings)
      .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
      .join(",");
    return "{" + entries + "}";
  }
  return JSON.stringify(value);
}

function parseSourceHashLine(line) {
  const separator = line.search(/\s/);
  if (separator < 0) return null;
  const sha256 = line.slice(0, separator);
  const sourcePath = line.slice(separator).trim();
  if (!/^[A-Fa-f0-9]{64}$/.test(sha256) || !sourcePath) return null;
  return { sha256: sha256.toUpperCase(), path: normalizeRelativeSourcePath(sourcePath, "source_sha256.txt") };
}

function parseSourceHashEntries(lines) {
  const entries = lines.map(parseSourceHashLine);
  const invalid = entries.filter((entry) => !entry);
  if (invalid.length > 0) throw new Error(`source_sha256.txt contains ${invalid.length} invalid row(s)`);
  return entries;
}

function buildSourceInventory(sourceInventory) {
  const inventory = new Map();
  for (const item of sourceInventory) {
    const relative = normalizeRelativeSourcePath(item?.file, "manifest.source_inventory");
    if (inventory.has(relative)) throw new Error(`manifest.source_inventory contains duplicate path ${relative}`);
    if (!Number.isInteger(item?.bytes) || item.bytes <= 0) throw new Error(`manifest.source_inventory has invalid byte count for ${relative}`);
    inventory.set(relative, {
      bytes: item.bytes,
      sha256: String(item.sha256).toUpperCase()
    });
  }
  return inventory;
}

function validateSourceHashInventory(entries, sourceInventory) {
  const inventory = buildSourceInventory(sourceInventory);
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error("source_sha256.txt contains duplicate source paths");
  const inventoryPaths = [...inventory.keys()].toSorted(compareStrings);
  const hashPaths = [...new Set(paths)].toSorted(compareStrings);
  if (JSON.stringify(inventoryPaths) !== JSON.stringify(hashPaths)) {
    const missing = inventoryPaths.filter((relative) => !hashPaths.includes(relative));
    const extra = hashPaths.filter((relative) => !inventory.has(relative));
    throw new Error(`source_sha256.txt paths do not exactly match manifest.source_inventory (missing=${missing.slice(0, 3).join(",")}, extra=${extra.slice(0, 3).join(",")})`);
  }
  return {
    inventory,
    hashesByPath: new Map(entries.map((entry) => [entry.path, entry.sha256])),
    uniquePathCount: new Set(paths).size
  };
}

function verifySourceInventoryFiles(sourceApp, inventory, hashesByPath) {
  if (!sourceApp) return 0;
  const sourceAppPath = path.resolve(String(sourceApp));
  const dataRoot = path.join(sourceAppPath, "Data");
  if (!fs.existsSync(dataRoot) || !fs.statSync(dataRoot).isDirectory()) {
    throw new Error(`manifest.source_app has no readable Data directory: ${sourceApp}`);
  }
  let verifiedFileCount = 0;
  for (const [relative, metadata] of inventory) {
    const actual = sourcePathOnDisk(sourceAppPath, relative);
    if (!fs.existsSync(actual) || !fs.statSync(actual).isFile()) throw new Error(`source inventory file is missing: ${relative}`);
    const stat = fs.statSync(actual);
    if (stat.size !== metadata.bytes) throw new Error(`source inventory byte mismatch for ${relative}: ${stat.size}/${metadata.bytes}`);
    const actualHash = sha256File(actual);
    if (actualHash !== hashesByPath.get(relative)) throw new Error(`source hash mismatch for ${relative}`);
    if (metadata.sha256 !== actualHash) throw new Error(`manifest source hash mismatch for ${relative}`);
    verifiedFileCount += 1;
  }
  return verifiedFileCount;
}

function parseSourceHashes(filePath, expectedCount, sourceInventory = [], sourceApp = "") {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${path.basename(filePath)}`);
  const lines = fs.readFileSync(filePath, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const entries = parseSourceHashEntries(lines);
  if (Number.isInteger(expectedCount) && lines.length !== expectedCount) {
    throw new Error(`source_sha256.txt has ${lines.length} rows but manifest.source_count=${expectedCount}`);
  }
  const inventoryValidation = validateSourceHashInventory(entries, sourceInventory);
  const verifiedFileCount = verifySourceInventoryFiles(
    sourceApp,
    inventoryValidation.inventory,
    inventoryValidation.hashesByPath
  );
  return {
    path: "source_sha256.txt",
    sha256: sha256File(filePath),
    line_count: lines.length,
    unique_path_count: inventoryValidation.uniquePathCount,
    path_mode: "relative-to-data",
    verified_file_count: verifiedFileCount
  };
}

function stripAbsolutePaths(value) {
  if (Array.isArray(value)) return value.map(stripAbsolutePaths);
  if (!isRecord(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (["source_app", "source_directory"].includes(key)) continue;
    result[key] = stripAbsolutePaths(child);
  }
  return result;
}

function findUnpackManifestPath(sourceRoot, manifest) {
  const candidates = [];
  if (manifest?.source_app) candidates.push(path.join(String(manifest.source_app), "unpack_manifest.json"));
  candidates.push(path.join(sourceRoot, "unpack_manifest.json"));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function validateUnpackPayloads(manifestValue) {
  if (!Array.isArray(manifestValue.apks) || manifestValue.apks.length === 0) {
    throw new Error("unpack_manifest.json must contain at least one payload hash");
  }
  if (manifestValue.apk_count !== manifestValue.apks.length) {
    throw new Error("unpack_manifest.json payload count does not match apk_count");
  }
  const payloadNames = new Set();
  const payloadHashes = new Set();
  for (const payload of manifestValue.apks) {
    if (!payload.file || payloadNames.has(payload.file) || !/^[A-Fa-f0-9]{64}$/.test(String(payload.sha256 || ""))) {
      throw new Error("unpack_manifest.json contains a duplicate or invalid payload hash");
    }
    if (!Number.isInteger(payload.bytes) || payload.bytes <= 0 || !Number.isInteger(payload.entry_count) || payload.entry_count < 0) {
      throw new Error("unpack_manifest.json contains a payload with invalid size metadata");
    }
    payloadNames.add(payload.file);
    const hash = String(payload.sha256).toUpperCase();
    if (payloadHashes.has(hash)) throw new Error("unpack_manifest.json contains duplicate payload hashes");
    payloadHashes.add(hash);
  }
  return payloadNames;
}

function validateMergedSplitOutput(merged, payloadNames, outputNames) {
  if (!merged.file || outputNames.has(merged.file) || !Number.isInteger(merged.bytes) || merged.bytes <= 0 || !/^[A-Fa-f0-9]{64}$/.test(String(merged.sha256 || ""))) {
    throw new Error("unpack_manifest.json contains an invalid merged split output");
  }
  if (!Array.isArray(merged.parts) || merged.parts.length === 0) throw new Error("unpack_manifest.json contains a split output without parts");
  const partNumbers = merged.parts.map((part) => part?.part);
  const expectedParts = Array.from({ length: merged.parts.length }, (_, index) => index);
  if (JSON.stringify(partNumbers) !== JSON.stringify(expectedParts)) throw new Error(`unpack_manifest.json split parts for ${merged.file} are not contiguous`);
  const partSources = new Set();
  for (const part of merged.parts) {
    if (!payloadNames.has(part?.[PAYLOAD_FIELD]) || typeof part?.member !== "string" || part.member.trim() === "") {
      throw new Error(`unpack_manifest.json split part for ${merged.file} has an unknown payload source`);
    }
    const sourceKey = `${part[PAYLOAD_FIELD]}:${part.member}`;
    if (partSources.has(sourceKey)) throw new Error(`unpack_manifest.json split output ${merged.file} repeats a source member`);
    partSources.add(sourceKey);
  }
}

function validateMergedSplitFiles(manifestValue, payloadNames) {
  if (!Number.isInteger(manifestValue.split_file_count) || manifestValue.split_file_count < 0) {
    throw new Error("unpack_manifest.json split file count is invalid");
  }
  if (!Array.isArray(manifestValue.merged_split_files) || manifestValue.merged_split_files.length !== manifestValue.split_file_count) {
    throw new Error("unpack_manifest.json split file inventory is incomplete");
  }
  const outputNames = new Set();
  for (const merged of manifestValue.merged_split_files) {
    validateMergedSplitOutput(merged, payloadNames, outputNames);
    outputNames.add(merged.file);
  }
}

function validateUnpackIdentity(manifestValue, manifest) {
  if (manifestValue.platform !== manifest.platform || manifestValue.version !== manifest.version
    || manifestValue.package !== manifest.package) {
    throw new Error("unpack_manifest.json source identity does not match manifest.json");
  }
  if (!Number.isInteger(manifestValue.ordinary_member_count) || manifestValue.ordinary_member_count < 0) {
    throw new Error("unpack_manifest.json ordinary member count is invalid");
  }
}

function loadUnpackManifest(sourceRoot, manifest) {
  const filePath = findUnpackManifestPath(sourceRoot, manifest);
  if (!filePath) return null;
  const manifestValue = readJson(filePath, "unpack_manifest.json");
  const payloadNames = validateUnpackPayloads(manifestValue);
  validateUnpackIdentity(manifestValue, manifest);
  validateMergedSplitFiles(manifestValue, payloadNames);
  return stripAbsolutePaths(manifestValue);
}

function loadLocalization(tablesDir) {
  const filePath = path.join(tablesDir, "localization_text.csv");
  if (!fs.existsSync(filePath)) throw new Error(`Missing localization table: ${filePath}`);
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  const headerIndex = rows.findIndex((row) => ["ko", "en", "ja", "zh-tw"].every((locale) => row.includes(locale)));
  if (headerIndex < 0) throw new Error("localization_text.csv is missing the four-locale header");
  const header = validateHeader(rows[headerIndex], "localization_text", true);
  const locales = ["zh-tw", "en", "ja", "ko"];
  const indexes = Object.fromEntries(locales.map((locale) => [locale, header.indexOf(locale)]));
  const entries = {};
  const errors = [];
  const incomplete = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length > 0 && row.every((value) => trim(value) === "")) continue;
    const key = trim(row[0]);
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;
    if (entries[key]) errors.push(`duplicate key ${key}`);
    entries[key] = Object.fromEntries(locales.map((locale) => [locale, trim(row[indexes[locale]])]));
    if (Object.values(entries[key]).includes("")) {
      incomplete.push(key);
    }
  }
  const errorSuffix = errors.length > 12 ? `; and ${errors.length - 12} more` : "";
  if (errors.length > 0) throw new Error(`localization_text.csv: ${errors.slice(0, 12).join("; ")}${errorSuffix}`);
  const incompleteKeys = incomplete.toSorted(compareStrings);
  return {
    filePath,
    sha256: sha256File(filePath),
    entries,
    count: Object.keys(entries).length,
    complete_count: Object.keys(entries).length - incomplete.length,
    incomplete: incompleteKeys
  };
}

function addValue(value) {
  const source = trim(value);
  if (source === "") return "";
  const number = Number(source);
  if (!Number.isFinite(number) || number === 0) return "";
  const normalized = String(number);
  return number > 0 ? `+${normalized}` : normalized;
}

function numberValue(value) {
  const source = trim(value);
  if (source === "") return "";
  const number = Number(source);
  return Number.isFinite(number) ? String(number) : source;
}

function unitFor(field, type) {
  const normalizedType = trim(type).toLowerCase();
  if (normalizedType === "valuetype_percent") return "%";
  if (normalizedType === "valuetype_seconds") return "s";
  if (normalizedType === "valuetype_scale") return "倍";
  if (["Duration", "Interval"].includes(field)) return "s";
  return "";
}

function valueWithUnit(value, unit) {
  const normalized = numberValue(value);
  return normalized ? `${normalized}${unit}` : "";
}

function sourceLabel(localization, labelKey) {
  const entry = localization?.entries?.[labelKey] || DERIVED_STAT_LABELS[labelKey];
  if (!entry?.["zh-tw"]) throw new Error(`Missing complete source localization for ${labelKey}`);
  return entry["zh-tw"];
}

function statCandidate({ table, key, row, labelField, labelKey: explicitLabelKey, valueField, dotField, powerField, typeField, inferred = false }) {
  const labelKey = trim(explicitLabelKey || (labelField ? row[labelField] : ""));
  if (!labelKey) return null;
  const base = trim(row[valueField]);
  const dot = trim(row[dotField]);
  const power = trim(row[powerField]);
  if (!base && !dot && !power) return null;
  const unit = unitFor(valueField, typeField ? row[typeField] : "");
  return {
    table,
    key,
    field: valueField,
    inferred,
    label_key: labelKey,
    label: null,
    value: valueWithUnit(base, unit),
    unit,
    powerup_add: addValue(power),
    dot_add: addValue(dot),
    raw_source: {
      table,
      key,
      field: valueField,
      label_key: labelKey,
      base: numberValue(base),
      powerup: numberValue(power),
      dot: numberValue(dot)
    }
  };
}

function statFromCandidate(candidate, localization, icon) {
  const statId = `${candidate.table}:${candidate.key}:${candidate.field}`;
  const base = {
    stat_id: statId,
    label_key: candidate.label_key,
    label: sourceLabel(localization, candidate.label_key),
    value: candidate.value,
    unit: candidate.unit,
    icon,
    raw_source: candidate.raw_source
  };
  return {
    base,
    powerup: { ...base, add: candidate.powerup_add },
    dot: { ...base, add: candidate.dot_add }
  };
}

function previousStatIndex(oldStats, candidate) {
  const statId = `${candidate.table}:${candidate.key}:${candidate.field}`;
  const exact = oldStats.findIndex((stat) => stat?.stat_id === statId);
  return exact;
}

function chooseIcon(oldStats, candidate) {
  const statId = `${candidate.table}:${candidate.key}:${candidate.field}`;
  const exact = oldStats.find((stat) => stat?.stat_id === statId && typeof stat.icon === "string");
  if (exact) return exact.icon;
  return "Attack_Icon.png";
}

function collectProjectileCandidates(node, defender, raw) {
  const candidates = [];
  const projectileIds = new Set();
  const directProjectileId = trim(defender.ProjectileAbilityId);
  if (directProjectileId) projectileIds.add(directProjectileId);
  // A few client rows are consumed by a skill without being repeated in the
  // DefenderTable relation (notably Lock -> lock_effect).  Resolve these by
  // the stable type prefix, never by a hand-entered value or display label.
  const typePrefix = trim(node.dice_type).toLowerCase();
  for (const row of raw.tables.ProjectileAbilityTable.records) {
    const rowId = trim(row.StringId);
    if (rowId?.toLowerCase().startsWith(typePrefix)) projectileIds.add(rowId);
  }
  for (const projectileId of projectileIds) {
    const row = raw.tables.ProjectileAbilityTable.byKey.get(projectileId);
    if (!row) throw new Error(`ProjectileAbilityTable is missing ${projectileId} for ${node.dice_type}`);
    for (const [labelField, valueField, dotField, powerField, typeField] of PROJECTILE_FIELDS) {
      const candidate = statCandidate({ table: "ProjectileAbilityTable", key: projectileId, row, labelField, valueField, dotField, powerField, typeField, inferred: projectileId !== directProjectileId });
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function collectSkillFieldCandidates({ table, key, row, fields, inferred = false, explicitLabelKeys = false }) {
  const candidates = [];
  for (const [labelField, valueField, dotField, powerField, typeField] of fields) {
    const candidate = statCandidate({
      table,
      key,
      row,
      labelField: explicitLabelKeys ? null : labelField,
      labelKey: explicitLabelKeys ? labelField : undefined,
      valueField,
      dotField,
      powerField,
      typeField,
      inferred
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function collectSkillCandidates(node, defender, raw) {
  const skillKind = trim(defender.DefenderSkillKind);
  const candidates = [];
  if (skillKind) {
    const row = raw.tables.DefenderSkillTable.byKey.get(skillKind);
    if (!row) throw new Error(`DefenderSkillTable is missing ${skillKind} for ${node.dice_type}`);
    candidates.push(...collectSkillFieldCandidates({ table: "DefenderSkillTable", key: skillKind, row, fields: SKILL_FIELDS }));
  }

  const semanticFields = SKILL_SEMANTIC_FIELDS[trim(node.dice_type)] || [];
  if (semanticFields.length === 0) return candidates;
  const semanticKey = trim(node.dice_type);
  const row = raw.tables.DefenderSkillTable.byKey.get(semanticKey);
  if (!row) throw new Error(`DefenderSkillTable is missing semantic row ${semanticKey}`);
  return candidates.concat(collectSkillFieldCandidates({
    table: "DefenderSkillTable",
    key: semanticKey,
    row,
    fields: semanticFields,
    inferred: true,
    explicitLabelKeys: true
  }));
}

function collectDefenderCandidates(defender) {
  const base = trim(defender.BossAttackPer);
  const upAdd = trim(defender.BossAttackPer_UpAdd);
  if (!base && !upAdd) return [];
  if (Number(upAdd) === 0 && [0, 100].includes(Number(base))) return [];

  const table = "DefenderTable";
  const key = trim(defender.DefenderType);
  const field = "BossAttackPer";
  const labelKey = "stats.bossDamageMultiplier";
  return [{
    table,
    key,
    field,
    inferred: false,
    label_key: labelKey,
    label: null,
    value: valueWithUnit(base, "%"),
    unit: "%",
    powerup_add: addValue(upAdd),
    dot_add: "",
    raw_source: {
      table,
      key,
      field,
      label_key: labelKey,
      base: numberValue(base),
      powerup: numberValue(upAdd),
      dot: ""
    }
  }];
}

function sameStatCandidate(left, right) {
  return left.label === right.label
    && left.value === right.value
    && left.unit === right.unit
    && left.powerup_add === right.powerup_add
    && left.dot_add === right.dot_add;
}

function deduplicateStatCandidates(candidates) {
  const deduplicated = [];
  for (const candidate of candidates) {
    const duplicate = deduplicated.find((entry) => sameStatCandidate(entry, candidate));
    if (!duplicate) {
      deduplicated.push(candidate);
    } else if (duplicate.inferred && !candidate.inferred) {
      deduplicated[deduplicated.indexOf(duplicate)] = candidate;
    }
  }
  return deduplicated;
}

function orderStatCandidates(candidates, oldStats) {
  return candidates.toSorted((left, right) => {
    const leftIndex = previousStatIndex(oldStats, left);
    const rightIndex = previousStatIndex(oldStats, right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return 0;
  });
}

function buildStatTriplets(candidates, oldStats, localization) {
  return candidates.map((candidate) => {
    const icon = chooseIcon(oldStats, candidate);
    const stat = statFromCandidate(candidate, localization, icon);
    return stat;
  });
}

function buildSpecialStats(node, raw, localization) {
  const defender = raw.tables.DefenderTable.byKey.get(node.dice_type);
  if (!defender) throw new Error(`DefenderTable is missing ${node.dice_type} for node ${node.id}`);
  const candidates = [
    ...collectProjectileCandidates(node, defender, raw),
    ...collectSkillCandidates(node, defender, raw),
    ...collectDefenderCandidates(defender)
  ];
  const oldStats = Array.isArray(node.special_stats) ? node.special_stats : [];
  candidates.forEach((candidate) => {
    candidate.label = sourceLabel(localization, candidate.label_key);
  });
  const ordered = orderStatCandidates(deduplicateStatCandidates(candidates), oldStats);
  const triplets = buildStatTriplets(ordered, oldStats, localization);
  return {
    base: triplets.map((entry) => entry.base),
    powerup: triplets.map((entry) => entry.powerup),
    dot: triplets.map((entry) => entry.dot)
  };
}

function rawFieldsForNode(rawNode) {
  const fields = {};
  for (const key of [
    "id", "index", "branch", "branch_zh", "node_type", "node_type_zh", "kind_id", "name_zh",
    "description_zh", "short_label", "x", "y", "is_big", "is_base", "is_show", "unlock_condition",
    "unlock_condition_zh", "unlock_condition_value", "next_nodes", "incoming", "gold_costs", "core_costs",
    "max_rank", "unlock_gold", "unlock_core", "total_gold", "total_core", "dice_type", "dice_group",
    "dice_attack", "dice_attack_interval", "dice_awaken", "icon_name", "icon_file", "icon_status"
  ]) {
    if (Object.hasOwn(rawNode, key)) fields[key] = rawNode[key];
  }
  return fields;
}

function expectationForNode(node, rawNode, topologyCorrections = []) {
  const rawFields = rawFieldsForNode(rawNode);
  const result = { raw_fields: rawFields };
  const nodeTopologyCorrections = topologyCorrections
    .filter((correction) => correction.from_node_id === String(rawNode.id) || correction.to_node_id === String(rawNode.id))
    .map((correction) => {
      const field = correction.to_node_id === String(rawNode.id) ? "incoming" : "next_nodes";
      return {
        ...correction,
        field,
        raw_value: rawNode[field],
        effective_value: node[field]
      };
    });
  for (const correction of nodeTopologyCorrections) delete rawFields[correction.field];
  if (nodeTopologyCorrections.length > 0) result.topology_corrections = nodeTopologyCorrections;
  if (node.unlock_condition_evidence) {
    delete rawFields.unlock_condition_value;
    result.unlock_supplement = {
      key: node.unlock_condition_key,
      label_zh: node.unlock_condition_label_zh,
      value: node.unlock_condition_value,
      evidence: node.unlock_condition_evidence
    };
  }
  if (node.unlock_cost_policy) {
    for (const field of ["gold_costs", "core_costs", "unlock_gold", "unlock_core", "total_gold", "total_core"]) {
      delete rawFields[field];
    }
    result.unlock_cost_policy = node.unlock_cost_policy;
  }
  if (node.node_type === "DICE") {
    result.special_stats = node.special_stats;
    result.powerup_data = {
      attack_add: node.powerup_data?.attack_add || "",
      interval_add: node.powerup_data?.interval_add || "",
      special_stats: node.powerup_data?.special_stats || []
    };
    result.dot_data = {
      attack_add: node.dot_data?.attack_add || "",
      interval_add: node.dot_data?.interval_add || "",
      special_stats: node.dot_data?.special_stats || []
    };
  }
  return result;
}

function compareTextField(node, field, rawValue, errors) {
  if (String(node?.[field] ?? "") !== trim(rawValue)) {
    errors.push(`${node?.id}.${field}=${node?.[field] ?? ""} differs from raw table ${rawValue ?? ""}`);
  }
}

function validateDiceTableNode(node, raw) {
  const errors = [];
  const row = raw.tables.DefenderTable.byKey.get(trim(node.dice_type));
  if (!row) return [`${node.id}.dice_type has no DefenderTable row`];
  compareTextField(node, "dice_group", row.DefenderGroupType, errors);
  compareTextField(node, "dice_attack", row.Attack, errors);
  compareTextField(node, "dice_attack_interval", row.AttackInterval, errors);
  const targetLabel = targetingLabelPatchForNode(node, raw);
  if (targetLabel && node.dice_target_zh !== targetLabel) errors.push(`${node.id}.dice_target_zh must be ${targetLabel} for ${row.TargetingType}`);
  return errors;
}

function validatePassiveTableNode(node, raw) {
  const errors = [];
  const row = raw.tables.PlayerPassiveTable.byKey.get(trim(node.passive_id));
  if (!row) return [`${node.id}.passive_id=${node.passive_id} has no PlayerPassiveTable row`];
  compareTextField(node, "max_rank", row.MaxRank, errors);
  compareTextField(node, "passive_value", row.Value, errors);
  compareTextField(node, "passive_rank_add", row.Value_RankAdd, errors);
  const expectedGroup = trim(row.DefenderGroupType) || "None";
  if (String(node.passive_group ?? "") !== expectedGroup) errors.push(`${node.id}.passive_group differs from raw table`);
  return errors;
}

function validateRuneTableNode(node, raw) {
  const errors = [];
  const row = raw.tables.RuneTable.byKey.get(String(node.kind_id));
  if (!row) return [`${node.id}.kind_id=${node.kind_id} has no RuneTable row`];
  for (const [field, rawField] of [
    ["max_rank", "MaxRank"],
    ["rune_kind", "Kind"],
    ["rune_grade", "Grade"],
    ["rune_dice", "DefenderType"],
    ["rune_value1", "Value1"],
    ["rune_value1_rank_add", "Value1_RankAdd"],
    ["rune_value2", "Value2"],
    ["rune_value2_rank_add", "Value2_RankAdd"],
    ["rune_duration", "Duration"],
    ["rune_duration_rank_add", "Duration_RankAdd"]
  ]) compareTextField(node, field, row[rawField], errors);
  const targetLabel = targetingLabelPatchForNode(node, raw);
  if (targetLabel) {
    const defender = raw.tables.DefenderTable.byKey.get(trim(node.rune_dice));
    if (node.dice_target_zh !== targetLabel) errors.push(`${node.id}.dice_target_zh must be ${targetLabel} for ${defender?.TargetingType}`);
  }
  return errors;
}

function validatePerkTableNode(node, raw) {
  const errors = [];
  const row = raw.tables.PerkActionTable.byKey.get(trim(node.perk_type));
  if (!row) return [`${node.id}.perk_type=${node.perk_type} has no PerkActionTable row`];
  compareTextField(node, "perk_group", row.DefenderGroupType, errors);
  return errors;
}

function validateNodeAgainstTable(node, raw) {
  if (node.node_type === "DICE") return validateDiceTableNode(node, raw);
  if (node.node_type === "PLAYER_PASSIVE") return validatePassiveTableNode(node, raw);
  if (node.node_type === "DICE_RUNE") return validateRuneTableNode(node, raw);
  if (node.node_type === "PERK") return validatePerkTableNode(node, raw);
  return [];
}

export function validateTableBackedNodes(canonical, raw) {
  const errors = [];
  for (const node of canonical.nodes || []) {
    errors.push(...validateNodeAgainstTable(node, raw));
  }
  return errors;
}

function applyUnlockPolicies(node, raw) {
  const next = { ...node };
  delete next.unlock_condition_key;
  delete next.unlock_condition_label_zh;
  delete next.unlock_condition_evidence;
  delete next.unlock_cost_policy;
  const resourceFree = raw.unlockSupplements?.resource_free_nodes?.find((entry) => entry.node_id === String(node.id));
  if (resourceFree) {
    const rawCosts = {
      gold_costs: Array.isArray(node.gold_costs) ? [...node.gold_costs] : [],
      core_costs: Array.isArray(node.core_costs) ? [...node.core_costs] : [],
      unlock_gold: node.unlock_gold ?? 0,
      unlock_core: node.unlock_core ?? 0,
      total_gold: node.total_gold ?? 0,
      total_core: node.total_core ?? 0
    };
    next.gold_costs = [];
    next.core_costs = [];
    next.unlock_gold = 0;
    next.unlock_core = 0;
    next.total_gold = 0;
    next.total_core = 0;
    next.unlock_cost_policy = {
      policy: "resource_free",
      node_id: resourceFree.node_id,
      reason: resourceFree.reason,
      source_type: resourceFree.source_type,
      source_note: resourceFree.source_note,
      raw_costs: rawCosts,
      effective_costs: {
        gold_costs: [],
        core_costs: [],
        unlock_gold: 0,
        unlock_core: 0,
        total_gold: 0,
        total_core: 0
      }
    };
  }
  const supplement = raw.unlockSupplements?.byNodeId?.get(String(node.id));
  if (!supplement) return next;
  return {
    ...next,
    unlock_condition_key: supplement.key,
    unlock_condition_label_zh: supplement.label_zh,
    unlock_condition_value: supplement.value,
    unlock_condition_evidence: {
      source_type: supplement.source_type,
      raw_value: supplement.raw_value,
      value: supplement.value,
      label_zh: supplement.label_zh,
      source_note: supplement.source_note
    }
  };
}

function targetingLabelPatchForNode(node, raw) {
  const defenderType = trim(node.dice_type || node.rune_dice);
  if (!defenderType) return "";
  const defender = raw.tables.DefenderTable.byKey.get(defenderType);
  return TARGETING_TYPE_ZH_PATCHES[trim(defender?.TargetingType)] || "";
}

function applyTargetingLabelPatch(node, raw) {
  const targetLabel = targetingLabelPatchForNode(node, raw);
  return targetLabel ? { ...node, dice_target_zh: targetLabel } : node;
}

function applyTopologyCorrections(nodes, edges, corrections) {
  const correctedNodes = nodes.map((node) => ({ ...node }));
  const nodesById = new Map(correctedNodes.map((node) => [String(node.id), node]));
  const correctedEdges = (edges || []).filter((edge) => {
    const from = trim(edge?.from ?? edge?.source ?? edge?.[0]);
    const to = trim(edge?.to ?? edge?.target ?? edge?.[1]);
    return !(corrections || []).some((correction) => correction.from_node_id === from && correction.to_node_id === to);
  });
  for (const correction of corrections || []) {
    const source = nodesById.get(correction.from_node_id);
    const target = nodesById.get(correction.to_node_id);
    if (!source || !target) throw new Error(`topology correction ${correction.from_node_id}->${correction.to_node_id} references a missing generated node`);
    source.next_nodes = (source.next_nodes || []).filter((id) => String(id) !== correction.to_node_id);
    target.incoming = (target.incoming || []).filter((id) => String(id) !== correction.from_node_id);
  }
  return { nodes: correctedNodes, edges: correctedEdges };
}

function resolveRawSourcePaths(sourceArgument) {
  const configured = path.resolve(sourceArgument || process.env.RD2_SOURCE_ROOT || DEFAULT_SOURCE_ROOT);
  const sourceRoot = fs.existsSync(path.join(configured, "tables")) ? configured : path.dirname(configured);
  const tablesDir = fs.existsSync(path.join(sourceRoot, "tables")) ? path.join(sourceRoot, "tables") : configured;
  return {
    sourceRoot,
    tablesDir,
    manifestPath: path.join(sourceRoot, "manifest.json"),
    treePath: path.join(sourceRoot, "dice_tree.json")
  };
}

function validateManifestIdentity(manifest) {
  const errors = [];
  if (manifest.platform !== EXPECTED_PLATFORM) errors.push("source platform identity mismatch");
  if (manifest.package !== EXPECTED_PACKAGE) errors.push("source package identity mismatch");
  if (manifest.version !== GAME_VERSION) errors.push(`version=${manifest.version}`);
  if (manifest.source_count !== RAW_SOURCE_COUNT) errors.push(`source_count=${manifest.source_count}`);
  if (manifest.text_asset_count !== RAW_TEXT_ASSET_COUNT) errors.push(`text_asset_count=${manifest.text_asset_count}`);
  return errors;
}

function validateManifestCsvInventory(manifest, errors) {
  if (manifest.csv_table_count !== RAW_CSV_TABLE_COUNT || !Array.isArray(manifest.csv_tables) || manifest.csv_tables.length !== RAW_CSV_TABLE_COUNT) {
    errors.push("csv table inventory is incomplete");
    return;
  }
  const csvSet = new Set(manifest.csv_tables);
  for (const [, filename] of TABLE_SPECS) {
    if (!csvSet.has(`tables/${filename}`)) errors.push(`csv table inventory is missing ${filename}`);
  }
  if (!csvSet.has("tables/localization_text.csv")) errors.push("csv table inventory is missing localization_text.csv");
}

function validateManifestSourceInventory(manifest, errors) {
  if (!Array.isArray(manifest.source_inventory) || manifest.source_inventory.length !== RAW_SOURCE_COUNT) {
    errors.push("source inventory is incomplete");
    return;
  }
  const hasInvalidEntry = manifest.source_inventory.some((entry) => !entry?.file || !Number.isInteger(entry.bytes) || entry.bytes <= 0
    || !/^[A-Fa-f0-9]{64}$/.test(String(entry.sha256 || "")));
  if (hasInvalidEntry) {
    errors.push("source inventory contains invalid size/hash metadata");
  } else if (new Set(manifest.source_inventory.map((entry) => entry.file)).size !== manifest.source_inventory.length) {
    errors.push("source inventory contains duplicate file names");
  }
}

function validateManifestTextAssets(manifest, errors) {
  if (!Array.isArray(manifest.text_assets) || manifest.text_assets.length !== RAW_TEXT_ASSET_COUNT) {
    errors.push("text asset inventory is incomplete");
  } else if (new Set(manifest.text_assets.map((entry) => entry?.name)).size !== manifest.text_assets.length) {
    errors.push("text asset inventory contains duplicate names");
  }
}

function validateRawManifest(manifest) {
  const errors = validateManifestIdentity(manifest);
  validateManifestCsvInventory(manifest, errors);
  validateManifestSourceInventory(manifest, errors);
  validateManifestTextAssets(manifest, errors);
  if (Array.isArray(manifest.text_errors) && manifest.text_errors.length > 0) errors.push(`text_errors=${manifest.text_errors.length}`);
  if (errors.length > 0) throw new Error(`Raw manifest rejected: ${errors.join(", ")}`);
}

function loadRawTable(tablesDir, [name, filename, keyField, requiredHeaders]) {
  const filePath = path.join(tablesDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing raw table: ${filePath}`);
  const parsed = recordsFromRows(parseCsv(fs.readFileSync(filePath, "utf8")), name, requiredHeaders, keyField);
  if (parsed.records.length !== RAW_TABLE_COUNTS[name]) {
    throw new Error(`${name} must contain ${RAW_TABLE_COUNTS[name]} records (got ${parsed.records.length})`);
  }
  const byKey = new Map(parsed.records.map((record) => [trim(record[keyField]), record]));
  return {
    name,
    filename,
    key_field: keyField,
    header: parsed.header,
    records: parsed.records,
    byKey,
    sha256: sha256File(filePath)
  };
}

function loadRawTables(tablesDir) {
  return Object.fromEntries(TABLE_SPECS.map((spec) => [spec[0], loadRawTable(tablesDir, spec)]));
}

function normalizeSelectedTextAsset(item) {
  if (typeof item.source_file !== "string" || item.source_file.trim() === "" || !Number.isInteger(item.path_id)
    || item.path_id < 0 || !Number.isInteger(item.file_bytes) || item.file_bytes <= 0
    || !Number.isInteger(item.script_bytes) || item.script_bytes <= 0 || item.human_readable !== true || item.csv_preferred !== true
    || !Number.isInteger(item.candidate_count) || item.candidate_count < 1) {
    throw new Error(`Raw manifest selected TextAsset record is incomplete for ${item.name}`);
  }
  return {
    source_file: item.source_file || null,
    path_id: item.path_id ?? null,
    file_bytes: item.file_bytes ?? null,
    script_bytes: item.script_bytes ?? null,
    candidate_count: item.candidate_count ?? null,
    human_readable: item.human_readable ?? null,
    csv_preferred: item.csv_preferred ?? null
  };
}

function selectRawTextAssets(manifest) {
  const selectedTextAssets = {};
  for (const item of Array.isArray(manifest.text_assets) ? manifest.text_assets : []) {
    if (!item?.name || !TABLE_SPECS.some(([name]) => name === item.name)) continue;
    if (selectedTextAssets[item.name]) throw new Error(`Raw manifest has duplicate selected TextAsset record for ${item.name}`);
    selectedTextAssets[item.name] = normalizeSelectedTextAsset(item);
  }
  const missingSelections = TABLE_SPECS.map(([name]) => name).filter((name) => !selectedTextAssets[name]);
  if (missingSelections.length > 0) throw new Error(`Raw manifest has no selected TextAsset record for: ${missingSelections.join(", ")}`);
  return selectedTextAssets;
}

function validateLocalizationAsset(manifest) {
  const localizationAsset = (manifest.text_assets || []).find((item) => item?.name === "localization_text");
  if (localizationAsset?.human_readable !== true || localizationAsset?.csv_preferred !== true
    || !Number.isInteger(localizationAsset?.file_bytes) || localizationAsset.file_bytes <= 0
    || !Number.isInteger(localizationAsset?.script_bytes) || localizationAsset.script_bytes <= 0) {
    throw new Error("Raw manifest has no complete localization TextAsset record");
  }
}

export function loadRawSource(sourceArgument = "") {
  const { sourceRoot, tablesDir, manifestPath, treePath } = resolveRawSourcePaths(sourceArgument);
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing raw extraction manifest: ${manifestPath}`);
  if (!fs.existsSync(treePath)) throw new Error(`Missing source dice tree: ${treePath}`);
  const manifest = readJson(manifestPath, "raw extraction manifest");
  validateRawManifest(manifest);
  const tree = readJson(treePath, "source dice tree");
  if (!Array.isArray(tree.nodes) || tree.nodes.length !== 239 || !Array.isArray(tree.edges) || tree.edges.length !== 248) {
    throw new Error(`Source dice tree must contain 239 nodes and 248 edges (got ${tree.nodes?.length ?? "?"}/${tree.edges?.length ?? "?"})`);
  }
  const unlockSupplements = loadUnlockSupplements(tree);
  const sourceHashes = parseSourceHashes(
    path.join(sourceRoot, "source_sha256.txt"),
    manifest.source_count,
    manifest.source_inventory,
    manifest.source_app
  );
  const tables = loadRawTables(tablesDir);
  const localization = loadLocalization(tablesDir);
  if (localization.count !== RAW_LOCALIZATION_COUNT) {
    throw new Error(`localization_text.csv must contain ${RAW_LOCALIZATION_COUNT} keyed rows (got ${localization.count})`);
  }
  const coopOverrides = loadOfficialCoopOverrides(tables, localization);
  const unpackManifest = loadUnpackManifest(sourceRoot, manifest);
  const selectedTextAssets = selectRawTextAssets(manifest);
  validateLocalizationAsset(manifest);
  return {
    sourceRoot,
    tablesDir,
    manifest,
    manifestHash: crypto.createHash("sha256").update(stableJson(normalizedManifest(manifest))).digest("hex").toUpperCase(),
    tree,
    tables,
    localization,
    sourceHashes,
    unpackManifest,
    selectedTextAssets,
    unlockSupplements,
    coopOverrides,
    snapshotId: SNAPSHOT_ID
  };
}

export function buildCanonicalFromRaw(current, raw) {
  if (!isRecord(current) || !Array.isArray(current.nodes)) throw new Error("Canonical tree must contain nodes[]");
  const rawById = new Map(raw.tree.nodes.map((node) => [String(node.id), node]));
  const currentById = new Map(current.nodes.map((node) => [String(node.id), node]));
  if (rawById.size !== current.nodes.length) throw new Error(`Raw/canonical node count differs: ${rawById.size}/${current.nodes.length}`);
  const generatedNodes = raw.tree.nodes.map((rawNode) => {
    const currentNode = currentById.get(String(rawNode.id));
    if (!currentNode) throw new Error(`Canonical tree is missing node ${rawNode.id}`);
    const node = applyTargetingLabelPatch(applyUnlockPolicies({ ...currentNode, ...rawNode }, raw), raw);
    if (rawNode.node_type === "DICE") {
      const defender = raw.tables.DefenderTable.byKey.get(trim(rawNode.dice_type));
      if (!defender) throw new Error(`DefenderTable is missing ${rawNode.dice_type}`);
      const special = buildSpecialStats(node, raw, raw.localization);
      node.special_stats = special.base;
      node.powerup_data = {
        ...currentNode.powerup_data,
        attack_add: addValue(defender.Attack_UpAdd),
        interval_add: addValue(defender.AttackInterval_UpAdd),
        special_stats: special.powerup
      };
      node.dot_data = {
        ...currentNode.dot_data,
        attack_add: addValue(defender.Attack_LvAdd),
        interval_add: "",
        special_stats: special.dot
      };
    }
    return node;
  });
  const effectiveTopology = applyTopologyCorrections(
    generatedNodes,
    raw.tree.edges,
    raw.unlockSupplements?.topology_corrections
  );
  const nodes = effectiveTopology.nodes;
  const edges = effectiveTopology.edges;
  const tableErrors = validateTableBackedNodes({ nodes }, raw);
  if (tableErrors.length > 0) throw new Error(`Raw table/tree relation check failed: ${tableErrors.slice(0, 16).join("; ")}`);
  const summary = {
    ...current.summary,
    ...raw.tree.summary,
    edge_count: edges.length,
    note: "Derived from the Random Dice 2 1.0.3 client table snapshot; centre values count all fully unlocked DiceTreeNodeTable rows in each branch."
  };
  const sumNodeField = (field) => nodes.reduce((total, node) => total + (Number(node?.[field]) || 0), 0);
  summary.total_unlock_gold = sumNodeField("unlock_gold");
  summary.total_unlock_core = sumNodeField("unlock_core");
  summary.total_max_gold = sumNodeField("total_gold");
  summary.total_max_core = sumNodeField("total_core");
  return {
    ...current,
    summary,
    nodes,
    edges,
    raw_lineage: {
      snapshot_id: raw.snapshotId,
      generator: "scripts/generate_canonical_from_raw.mjs",
      source_manifest_sha256: raw.manifestHash,
      unlock_supplement_sha256: raw.unlockSupplements.sha256,
      unlock_supplement_count: raw.unlockSupplements.entry_count,
      topology_correction_count: raw.unlockSupplements.topology_correction_count,
      official_notice_sha256: raw.coopOverrides.sha256,
      official_coop_override_count: raw.coopOverrides.entries.length,
      path: "data/raw_snapshot_1.0.3.json"
    }
  };
}

function numericValue(value, label) {
  const source = trim(value);
  if (source === "") return null;
  const number = Number(source);
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric`);
  return number;
}

function booleanValue(value, label) {
  const source = trim(value).toLowerCase();
  if (source === "true") return true;
  if (source === "false") return false;
  throw new Error(`${label} must be True or False`);
}

function timeLabel(value) {
  const number = numericValue(value, "time");
  return number === null ? null : `${number}s`;
}

function splitIndexList(value) {
  return trim(value).split("|").filter(Boolean).map(Number);
}

function rawWaveProjection(row, existing) {
  if (!existing) throw new Error(`Canonical compendium is missing wave ${row.Id}`);
  const bosses = [1, 2, 3].map((slot) => ({
    type: trim(row[`BossType${slot}`]),
    spawn_time_sec: numericValue(row[`BossSpawnTime${slot}`], `BossSpawnTime${slot}`)
  })).filter((boss) => boss.type && boss.type !== "None");
  return {
    ...existing,
    wave: numericValue(row.Id, "CoopWaveTable.Id"),
    is_boss_wave: numericValue(row.BossBaseHP, "BossBaseHP") > 0 || bosses.length > 0,
    move_speed_percent: numericValue(row.MoveSpeedPer, "MoveSpeedPer"),
    hp_increase_interval_sec: numericValue(row.HPIncreaseInterval, "HPIncreaseInterval"),
    hp_increase_raw: numericValue(row.HPIncrease, "HPIncrease"),
    normal_sp: numericValue(row.NormalSP, "NormalSP"),
    counts: {
      normal: numericValue(row.NormalCount, "NormalCount"),
      speed: numericValue(row.SpeedCount, "SpeedCount"),
      big: numericValue(row.BigCount, "BigCount")
    },
    intervals_sec: {
      normal: numericValue(row.NormalInterval, "NormalInterval"),
      speed: numericValue(row.SpeedInterval, "SpeedInterval"),
      big: numericValue(row.BigInterval, "BigInterval")
    },
    boss_base_hp: numericValue(row.BossBaseHP, "BossBaseHP"),
    bosses: bosses.map((boss, index) => ({ ...existing.bosses?.[index], ...boss })),
    coop_tactics: splitIndexList(row.CoopTacticsIndex),
    reward_gold: numericValue(row.RewardGold, "RewardGold"),
    reward_six_dice_ticket: numericValue(row.RewardSixDiceTicket, "RewardSixDiceTicket")
  };
}

function sourceBackedMonsterType(row, existing) {
  if (!existing) throw new Error(`Canonical compendium is missing monster type ${row.Id}`);
  return {
    ...existing,
    id: numericValue(row.Id, "MinionTable.Id"),
    internal_type: row.MinionType,
    boss_type: trim(row.BossType) || null,
    base_move_speed: numericValue(row.BaseMoveSpeed, "BaseMoveSpeed"),
    sp_per: numericValue(row.SPPer, "SPPer"),
    boss_hp_per: numericValue(row.BossHpPer, "BossHpPer"),
    trophy_level: numericValue(row.TrophyLevel, "TrophyLevel"),
    boss_hp_per_versus: numericValue(row.BossHpPerVersus, "BossHpPerVersus")
  };
}

function rawIdFromCompendiumMonster(monster) {
  const match = /_(\d+)$/.exec(String(monster?.id || ""));
  return match ? Number(match[1]) : null;
}

function sourceBackedMonster(row, existing) {
  if (!existing) return null;
  const next = {
    ...existing,
    speed: numericValue(row.BaseMoveSpeed, "BaseMoveSpeed"),
    sp_per: numericValue(row.SPPer, "SPPer"),
    boss_hp_per: numericValue(row.BossHpPer, "BossHpPer"),
    trophy_level: numericValue(row.TrophyLevel, "TrophyLevel"),
    boss_hp_per_versus: numericValue(row.BossHpPerVersus, "BossHpPerVersus")
  };
  if (row.MinionType === "Boss") next.bossType = trim(row.BossType) || null;
  return next;
}

export function buildCompendiumFromRaw(current, raw) {
  if (!isRecord(current) || !isRecord(current.modes)) throw new Error("Canonical compendium must contain modes");
  const result = structuredClone(current);
  const coopRows = raw.tables.CoopWaveTable.records;
  const currentWaves = Array.isArray(result.modes.coop?.waves) ? result.modes.coop.waves : [];
  const currentByWave = new Map(currentWaves.map((wave) => [String(wave.wave), wave]));
  const waves = coopRows.map((row) => rawWaveProjection(row, currentByWave.get(String(row.Id))));
  result.modes.coop = {
    ...result.modes.coop,
    wave_count: waves.length,
    waves,
    boss_waves: waves.filter((wave) => wave.is_boss_wave)
  };

  const currentTypes = new Map((result.monster_types || []).map((item) => [String(item.id), item]));
  result.monster_types = raw.tables.MinionTable.records.map((row) => sourceBackedMonsterType(row, currentTypes.get(String(row.Id))));
  const currentMonsters = new Map((result.monsters || []).map((monster) => [rawIdFromCompendiumMonster(monster), monster]));
  result.monsters = (result.monsters || []).map((monster) => {
    const rawId = rawIdFromCompendiumMonster(monster);
    const row = raw.tables.MinionTable.records.find((candidate) => String(candidate.Id) === String(rawId));
    if (!row) throw new Error(`No MinionTable row for ${monster.id}`);
    return sourceBackedMonster(row, currentMonsters.get(rawId));
  });

  const huntRows = raw.tables.HuntTable.records;
  const currentHunt = new Map((result.modes.hunt?.rewards || []).map((item) => [String(item.level), item]));
  result.modes.hunt = {
    ...result.modes.hunt,
    rewards: huntRows.map((row) => ({
      ...currentHunt.get(String(row.Id)),
      level: numericValue(row.Id, "HuntTable.Id"),
      reward_sp: numericValue(row.RewardSP, "RewardSP"),
      hp_percent: numericValue(row.HpPercent, "HpPercent")
    }))
  };

  const trophyRows = raw.tables.TrophyTable.records;
  const currentTrophies = new Map((result.modes.versus?.trophy_base_hp || []).map((item) => [String(item.id), item]));
  result.modes.versus = {
    ...result.modes.versus,
    trophy_base_hp: trophyRows.map((row) => ({
      ...currentTrophies.get(String(row.Id)),
      id: numericValue(row.Id, "TrophyTable.Id"),
      trophy: numericValue(row.Trophy, "Trophy"),
      emblem: row.TrophyEmblemKind,
      emblem_localization_key: row.Local_Name,
      minion_base_hp: numericValue(row.VersusMinionBaseHP, "VersusMinionBaseHP"),
      boss_base_hp: numericValue(row.VersusBossBaseHP, "VersusBossBaseHP"),
      win_gold: numericValue(row.VersusWinGold, "VersusWinGold"),
      lose_gold: numericValue(row.VersusLoseGold, "VersusLoseGold")
    })),
    wave_profiles: raw.tables.VersusWaveTable.records.map((row) => {
      const existing = (result.modes.versus.wave_profiles || []).find((item) => String(item.id) === String(row.Id));
      if (!existing) throw new Error(`Canonical compendium is missing versus wave ${row.Id}`);
      return {
        ...existing,
        id: numericValue(row.Id, "VersusWaveTable.Id"),
        duration_sec: numericValue(row.Duration, "Duration"),
        hp_increase_interval_sec: numericValue(row.HPIncreaseInterval, "HPIncreaseInterval"),
        hp_increase_raw: numericValue(row.HPIncrease, "HPIncrease"),
        move_speed_percent: numericValue(row.MoveSpeedPer, "MoveSpeedPer"),
        speed_interval_sec: numericValue(row.SpeedInterval, "SpeedInterval"),
        big_interval_sec: numericValue(row.BigInterval, "BigInterval")
      };
    })
  };

  const tacticsRows = raw.tables.TacticsEffectTable.records;
  const currentEvents = result.events || [];
  const byKind = new Map(tacticsRows.map((row) => [row.TacticsKind, row]));
  const enabledRows = tacticsRows.filter((row) => booleanValue(row.Use, "TacticsEffectTable.Use"));
  if (currentEvents.length !== enabledRows.length) throw new Error(`Canonical event count differs from enabled source rows: ${currentEvents.length}/${enabledRows.length}`);
  const waveRows = raw.tables.CoopWaveTable.records;
  result.events = currentEvents.map((event) => {
    const row = byKind.get(event.eventKind);
    if (!row) throw new Error(`No TacticsEffectTable row for ${event.eventKind}`);
    const displayTime = booleanValue(row.DisplayTime, "TacticsEffectTable.DisplayTime");
    const noticeOverride = raw.coopOverrides?.byKind?.get(row.TacticsKind);
    const coopEnabled = booleanValue(row.Coop, "TacticsEffectTable.Coop") && !noticeOverride;
    const coopWaveRefs = waveRows
      .filter((wave) => splitIndexList(wave.CoopTacticsIndex).includes(numericValue(row.Index, "TacticsEffectTable.Index")))
      .map((wave) => numericValue(wave.Id, "CoopWaveTable.Id"));
    return {
      ...event,
      index: numericValue(row.Index, "TacticsEffectTable.Index"),
      eventKind: row.TacticsKind,
      phase: row.TacticPhase,
      coop_time: coopEnabled ? timeLabel(row.CoopTime) : null,
      versus_time: timeLabel(row.VersusTime),
      coop_seconds: coopEnabled && displayTime ? numericValue(row.CoopTime, "CoopTime") : 0,
      versus_seconds: displayTime ? numericValue(row.VersusTime, "VersusTime") : 0,
      mode_flags: {
        ...event.mode_flags,
        use: booleanValue(row.Use, "TacticsEffectTable.Use"),
        coop: coopEnabled,
        display_time: displayTime,
        loop_time: booleanValue(row.LoopTime, "TacticsEffectTable.LoopTime"),
        trophy_level: numericValue(row.TrophyLevel, "TrophyLevel")
      },
      coop_wave_refs: coopEnabled ? coopWaveRefs : []
    };
  });
  result.meta = {
    ...result.meta,
    event_counts: {
      ...result.meta?.event_counts,
      raw: tacticsRows.length,
      enabled: enabledRows.length,
      excluded_not_enabled: tacticsRows.length - enabledRows.length,
      historical_removed: (result.historical_events || []).length
    }
  };
  result.raw_lineage = {
    snapshot_id: raw.snapshotId,
    generator: "scripts/generate_canonical_from_raw.mjs",
    source_manifest_sha256: raw.manifestHash,
    unlock_supplement_sha256: raw.unlockSupplements.sha256,
    unlock_supplement_count: raw.unlockSupplements.entry_count,
    official_notice_sha256: raw.coopOverrides.sha256,
    official_coop_override_count: raw.coopOverrides.entries.length,
    path: "data/raw_snapshot_1.0.3.json"
  };
  return result;
}

function projectWave(wave) {
  return {
    wave: wave.wave,
    is_boss_wave: wave.is_boss_wave,
    move_speed_percent: wave.move_speed_percent,
    hp_increase_interval_sec: wave.hp_increase_interval_sec,
    hp_increase_raw: wave.hp_increase_raw,
    normal_sp: wave.normal_sp,
    counts: wave.counts,
    intervals_sec: wave.intervals_sec,
    boss_base_hp: wave.boss_base_hp,
    bosses: (wave.bosses || []).map((boss) => ({ type: boss.type, spawn_time_sec: boss.spawn_time_sec })),
    coop_tactics: wave.coop_tactics,
    reward_gold: wave.reward_gold,
    reward_six_dice_ticket: wave.reward_six_dice_ticket
  };
}

export function buildCompendiumExpectation(compendium) {
  return {
    event_counts: compendium.meta?.event_counts || {},
    monster_types: (compendium.monster_types || []).map((item) => ({
      id: item.id,
      internal_type: item.internal_type,
      boss_type: item.boss_type ?? null,
      base_move_speed: item.base_move_speed,
      sp_per: item.sp_per,
      boss_hp_per: item.boss_hp_per,
      trophy_level: item.trophy_level,
      boss_hp_per_versus: item.boss_hp_per_versus
    })),
    monsters: (compendium.monsters || []).map((item) => ({
      id: item.id,
      raw_id: rawIdFromCompendiumMonster(item),
      bossType: item.bossType ?? null,
      speed: item.speed,
      sp_per: item.sp_per,
      boss_hp_per: item.boss_hp_per,
      trophy_level: item.trophy_level,
      boss_hp_per_versus: item.boss_hp_per_versus
    })),
    modes: {
      coop: {
        wave_count: compendium.modes?.coop?.wave_count,
        waves: (compendium.modes?.coop?.waves || []).map(projectWave)
      },
      hunt: {
        rewards: (compendium.modes?.hunt?.rewards || []).map((item) => ({
          level: item.level,
          reward_sp: item.reward_sp,
          hp_percent: item.hp_percent
        }))
      },
      versus: {
        trophy_base_hp: (compendium.modes?.versus?.trophy_base_hp || []).map((item) => ({
          id: item.id,
          trophy: item.trophy,
          emblem: item.emblem,
          emblem_localization_key: item.emblem_localization_key,
          minion_base_hp: item.minion_base_hp,
          boss_base_hp: item.boss_base_hp,
          win_gold: item.win_gold,
          lose_gold: item.lose_gold
        })),
        wave_profiles: (compendium.modes?.versus?.wave_profiles || []).map((item) => ({
          id: item.id,
          duration_sec: item.duration_sec,
          hp_increase_interval_sec: item.hp_increase_interval_sec,
          hp_increase_raw: item.hp_increase_raw,
          move_speed_percent: item.move_speed_percent,
          speed_interval_sec: item.speed_interval_sec,
          big_interval_sec: item.big_interval_sec
        }))
      }
    },
    events: (compendium.events || []).map((event) => ({
      id: event.id,
      index: event.index,
      eventKind: event.eventKind,
      phase: event.phase,
      coop_time: event.coop_time,
      versus_time: event.versus_time,
      coop_seconds: event.coop_seconds,
      versus_seconds: event.versus_seconds,
      mode_flags: {
        use: event.mode_flags?.use,
        coop: event.mode_flags?.coop,
        display_time: event.mode_flags?.display_time,
        loop_time: event.mode_flags?.loop_time,
        trophy_level: event.mode_flags?.trophy_level
      },
      coop_wave_refs: event.coop_wave_refs
    }))
  };
}

function sourceManifestProjection(raw) {
  const sourceIdentityHash = crypto.createHash("sha256")
    .update(`${raw.manifest.platform}\u0000${raw.manifest.package}`)
    .digest("hex")
    .toUpperCase();
  return {
    source_identity_sha256: sourceIdentityHash,
    version: raw.manifest.version,
    unity: raw.manifest.unity,
    source_count: raw.manifest.source_count,
    text_asset_count: raw.manifest.text_asset_count,
    csv_table_count: raw.manifest.csv_table_count,
    manifest_sha256: raw.manifestHash,
    source_hashes: raw.sourceHashes,
    selected_text_assets: raw.selectedTextAssets,
    official_notice: {
      path: raw.coopOverrides.path,
      sha256: raw.coopOverrides.sha256,
      notice_id: raw.coopOverrides.notice_id,
      version: raw.coopOverrides.version,
      category: raw.coopOverrides.category,
      entries: raw.coopOverrides.entries
    },
    payloads: raw.unpackManifest
      ? {
        apk_count: raw.unpackManifest.apk_count,
        hashes: raw.unpackManifest.apks.map((payload) => ({
          bytes: payload.bytes,
          sha256: payload.sha256,
          entry_count: payload.entry_count
        })),
        ordinary_member_count: raw.unpackManifest.ordinary_member_count,
        split_file_count: raw.unpackManifest.split_file_count,
        merged_split_files: (raw.unpackManifest.merged_split_files || []).map((entry) => ({
          bytes: entry.bytes,
          sha256: entry.sha256,
          part_count: Array.isArray(entry.parts) ? entry.parts.length : 0
        }))
      }
      : null
  };
}

function treeProjection(tree) {
  const sourceSummary = tree.summary || {};
  return {
    nodes: tree.nodes,
    edges: tree.edges,
    summary: {
      node_count: sourceSummary.node_count ?? tree.nodes.length,
      edge_count: sourceSummary.edge_count ?? tree.edges.length,
      nodes_by_type: sourceSummary.nodes_by_type || {},
      nodes_by_branch: sourceSummary.nodes_by_branch || {},
      full_unlock_nodes_by_branch: sourceSummary.full_unlock_nodes_by_branch || {},
      total_unlock_gold: sourceSummary.total_unlock_gold ?? 0,
      total_unlock_core: sourceSummary.total_unlock_core ?? 0,
      total_max_gold: sourceSummary.total_max_gold ?? 0,
      total_max_core: sourceSummary.total_max_core ?? 0,
      icon_matches: sourceSummary.icon_matches ?? 0,
      icon_fallbacks: sourceSummary.icon_fallbacks ?? 0,
      rune_catalog_count: sourceSummary.rune_catalog_count ?? 0,
      rune_catalog_tree_count: sourceSummary.rune_catalog_tree_count ?? 0,
      rune_catalog_supplemental_count: sourceSummary.rune_catalog_supplemental_count ?? 0,
      rune_catalog_icon_status: sourceSummary.rune_catalog_icon_status || {}
    }
  };
}

export function buildLineage(raw, canonical, compendium = null) {
  const expectations = {};
  for (const rawNode of raw.tree.nodes) {
    const canonicalNode = canonical.nodes.find((node) => String(node.id) === String(rawNode.id));
    if (!canonicalNode) throw new Error(`Generated canonical tree is missing ${rawNode.id}`);
    expectations[String(rawNode.id)] = expectationForNode(
      canonicalNode,
      rawNode,
      raw.unlockSupplements?.topology_corrections || []
    );
  }
  const projectionTables = {};
  for (const [name, table] of Object.entries(raw.tables)) {
    projectionTables[name] = {
      filename: table.filename,
      key_field: table.key_field,
      header: table.header,
      sha256: table.sha256,
      records: table.records
    };
  }
  return {
    schema_version: 1,
    snapshot_id: raw.snapshotId,
    generated_by: "scripts/generate_canonical_from_raw.mjs",
    source: sourceManifestProjection(raw),
    unlock_supplements: {
      path: raw.unlockSupplements.path,
      sha256: raw.unlockSupplements.sha256,
      entry_count: raw.unlockSupplements.entry_count,
      resource_free_nodes: raw.unlockSupplements.resource_free_nodes,
      entries: raw.unlockSupplements.entries,
      topology_corrections: raw.unlockSupplements.topology_corrections
    },
    projection: {
      tree: treeProjection(raw.tree),
      tables: projectionTables,
      localization: {
        path: "tables/localization_text.csv",
        sha256: raw.localization.sha256,
        count: raw.localization.count,
        complete_count: raw.localization.complete_count,
        incomplete_count: raw.localization.incomplete.length
      }
    },
    canonical_expectations: expectations,
    compendium_expectations: compendium ? buildCompendiumExpectation(compendium) : null
  };
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function stableEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

export function getRawSourcePathArgument(argv = process.argv) {
  const index = argv.indexOf("--source");
  return index >= 0 ? argv[index + 1] || "" : "";
}

export function rawDefaultExists() {
  return fs.existsSync(path.join(DEFAULT_SOURCE_ROOT, "manifest.json"));
}

export function getDefaultSourceTablesPath() {
  return DEFAULT_SOURCE_TABLES;
}

export function readJsonFile(filePath) {
  return readJson(filePath, path.basename(filePath));
}

export function sha256Path(rootDir, relativePath) {
  return sha256File(path.join(rootDir, relativePath));
}
