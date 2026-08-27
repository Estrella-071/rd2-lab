import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RAW_CSV_TABLE_COUNT,
  RAW_LOCALIZATION_COUNT,
  RAW_SOURCE_COUNT,
  RAW_TABLE_COUNTS,
  RAW_TEXT_ASSET_COUNT,
  RAW_UNLOCK_SUPPLEMENT_COUNT,
  RESOURCE_FREE_NODE_COUNT,
  buildCompendiumExpectation,
  buildCompendiumFromRaw,
  buildCanonicalFromRaw,
  buildLineage,
  getRawSourcePathArgument,
  loadRawSource,
  rawDefaultExists,
  readJsonFile,
  stableEqual
} from "./lib/raw_pipeline.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = path.join(rootDir, "site", "data", "dice_tree.json");
const compendiumPath = path.join(rootDir, "site", "boss_event_data.json");
const lineagePath = path.join(rootDir, "data", "raw_snapshot_1.0.3.json");
const errors = [];

function fail(message) {
  errors.push(message);
}

function hasAbsolutePath(value, location = "root") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => hasAbsolutePath(child, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/"))) {
      fail(`${location} contains an absolute path`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) hasAbsolutePath(child, `${location}.${key}`);
}

function compareExpected(current, expected) {
  const currentNodes = new Map((current.nodes || []).map((node) => [String(node.id), node]));
  const expectedNodes = expected.nodes || [];
  if (currentNodes.size !== expectedNodes.length) fail(`canonical node count differs from raw: ${currentNodes.size}/${expectedNodes.length}`);
  for (const expectedNode of expectedNodes) {
    const id = String(expectedNode.id);
    const actual = currentNodes.get(id);
    if (!actual) {
      fail(`canonical is missing raw node ${id}`);
      continue;
    }
    for (const [field, value] of Object.entries(expectedNode)) {
      if (!stableEqual(actual[field], value)) fail(`nodes.${id}.${field} differs from raw-generated output`);
    }
  }
  if (!stableEqual(current.edges, expected.edges)) fail("canonical edges differ from raw-generated output");
  if (!stableEqual(current.summary, expected.summary)) fail("canonical summary differs from raw-generated output");
  if (!stableEqual(current.raw_lineage, expected.raw_lineage)) fail("canonical raw_lineage differs from generated lineage");
}

function compareCompendiumExpected(current, expected) {
  if (!stableEqual(buildCompendiumExpectation(current), buildCompendiumExpectation(expected))) {
    fail("compendium raw-backed values differ from raw-generated output");
  }
  if (!stableEqual(current.raw_lineage, expected.raw_lineage)) fail("compendium raw_lineage differs from generated lineage");
}

function frozenUnlockValue(actual) {
  if (!actual.unlock_condition_key) return null;
  return {
    key: actual.unlock_condition_key,
    label_zh: actual.unlock_condition_label_zh,
    value: actual.unlock_condition_value,
    evidence: actual.unlock_condition_evidence
  };
}

function compareFrozenPowerupData(actual, id, key, expected) {
  if (!expected[key]) return;
  const value = {
    attack_add: actual[key]?.attack_add || "",
    interval_add: actual[key]?.interval_add || "",
    special_stats: actual[key]?.special_stats || []
  };
  if (!stableEqual(value, expected[key])) fail(`nodes.${id}.${key} differs from frozen raw source`);
}

function compareFrozenNode(actual, id, expected) {
  for (const [field, value] of Object.entries(expected.raw_fields || {})) {
    if (!stableEqual(actual[field], value)) fail(`nodes.${id}.${field} differs from frozen raw source`);
  }
  if (expected.unlock_supplement && !stableEqual(frozenUnlockValue(actual), expected.unlock_supplement)) {
    fail(`nodes.${id}.unlock_supplement differs from frozen owner/client evidence`);
  }
  if (expected.unlock_cost_policy && !stableEqual(actual.unlock_cost_policy, expected.unlock_cost_policy)) {
    fail(`nodes.${id}.unlock_cost_policy differs from frozen owner evidence`);
  }
  if (expected.special_stats && !stableEqual(actual.special_stats, expected.special_stats)) {
    fail(`nodes.${id}.special_stats differs from frozen raw source`);
  }
  for (const key of ["powerup_data", "dot_data"]) compareFrozenPowerupData(actual, id, key, expected);
}

function compareFrozenExpectation(current, lineage) {
  const expectationEntries = lineage.canonical_expectations;
  if (!expectationEntries || typeof expectationEntries !== "object") {
    fail("raw lineage has no canonical_expectations object");
    return;
  }
  const currentNodes = new Map((current.nodes || []).map((node) => [String(node.id), node]));
  const ids = Object.keys(expectationEntries);
  if (ids.length !== 239) fail(`raw lineage canonical_expectations has ${ids.length} nodes instead of 239`);
  for (const id of ids) {
    const actual = currentNodes.get(String(id));
    if (!actual) {
      fail(`canonical is missing frozen raw node ${id}`);
      continue;
    }
    compareFrozenNode(actual, id, expectationEntries[id]);
  }
  const sourceHash = lineage.source?.manifest_sha256;
  if (sourceHash && current.raw_lineage?.source_manifest_sha256 !== sourceHash) {
    fail("canonical raw_lineage does not bind to the frozen source manifest hash");
  }
}

function compareFrozenCompendiumExpectation(current, lineage) {
  const expected = lineage.compendium_expectations;
  if (!expected || typeof expected !== "object") {
    fail("raw lineage has no compendium_expectations object");
    return;
  }
  if (!stableEqual(buildCompendiumExpectation(current), expected)) {
    fail("compendium raw-backed values differ from frozen raw source");
  }
  const sourceHash = lineage.source?.manifest_sha256;
  if (sourceHash && current.raw_lineage?.source_manifest_sha256 !== sourceHash) {
    fail("compendium raw_lineage does not bind to the frozen source manifest hash");
  }
}

function validateBasicLineage(lineage) {
  if (lineage.schema_version !== 1) fail(`raw lineage schema_version=${lineage.schema_version} is unsupported`);
  if (lineage.snapshot_id !== "random-dice-2-1.0.3") fail(`raw lineage snapshot_id=${lineage.snapshot_id} is not 1.0.3`);
}

function validateUnlockSupplementShape(lineage) {
  const unlockSupplements = lineage.unlock_supplements;
  if (unlockSupplements?.entry_count !== RAW_UNLOCK_SUPPLEMENT_COUNT
    || !Array.isArray(unlockSupplements?.entries) || unlockSupplements?.entries?.length !== RAW_UNLOCK_SUPPLEMENT_COUNT
    || !/^[A-Fa-f0-9]{64}$/.test(String(unlockSupplements?.sha256 || ""))) {
    fail("raw lineage unlock-condition supplement inventory is incomplete");
  }
  if (!Array.isArray(unlockSupplements?.resource_free_nodes)
    || unlockSupplements.resource_free_nodes.length !== RESOURCE_FREE_NODE_COUNT) {
    fail("raw lineage resource-free dice inventory is incomplete");
  }
  const rawTreeNodes = lineage.projection?.tree?.nodes || [];
  const expectedResourceFreeIds = rawTreeNodes
    .filter((node) => node?.node_type === "DICE"
      && (node.is_base === true || ["REWARD_UNLOCKED", "COOP_REWARD_UNLOCKED", "ARENA_REWARD_UNLOCKED"].includes(String(node.unlock_condition || ""))))
    .map((node) => String(node.id))
    .toSorted();
  const actualResourceFreeIds = (unlockSupplements?.resource_free_nodes || [])
    .map((entry) => String(entry?.node_id || ""))
    .toSorted();
  if (JSON.stringify(expectedResourceFreeIds) !== JSON.stringify(actualResourceFreeIds)) {
    fail("raw lineage resource-free dice do not match raw initial/special-unlock nodes");
  }
  const rawNodesById = new Map(rawTreeNodes.map((node) => [String(node.id), node]));
  for (const entry of unlockSupplements?.entries || []) {
    const rawNode = rawNodesById.get(String(entry?.node_id));
    if (!rawNode || String(entry.raw_value ?? "") !== String(rawNode.unlock_condition_value ?? "")
      || !/^\d+$/.test(String(entry.value || "")) || !entry.key || !entry.condition) {
      fail(`raw lineage unlock supplement ${entry?.node_id || "?"} does not preserve raw/effective identity`);
    }
  }
}

function validateSourceShape(lineage) {
  if (!lineage.source || !/^[A-Fa-f0-9]{64}$/.test(String(lineage.source.source_identity_sha256 || ""))) {
    fail("raw lineage source identity digest is invalid");
  }
  if (lineage.source.version !== "1.0.3") fail(`raw lineage source version=${lineage.source.version}`);
  if (lineage.source.source_count !== RAW_SOURCE_COUNT || lineage.source.text_asset_count !== RAW_TEXT_ASSET_COUNT || lineage.source.csv_table_count !== RAW_CSV_TABLE_COUNT) {
    fail("raw lineage source inventory counts are not the expected snapshot");
  }
  if (!Number.isInteger(lineage.source.source_count) || lineage.source.source_count <= 0) fail("raw lineage source_count is invalid");
  if (!lineage.source.manifest_sha256 || !/^[A-Fa-f0-9]{64}$/.test(lineage.source.manifest_sha256)) fail("raw lineage manifest SHA-256 is invalid");
  if (lineage.source.source_hashes?.line_count !== RAW_SOURCE_COUNT
    || lineage.source.source_hashes?.unique_path_count !== RAW_SOURCE_COUNT
    || lineage.source.source_hashes?.path_mode !== "relative-to-data"
    || lineage.source.source_hashes?.verified_file_count !== RAW_SOURCE_COUNT) {
    fail("raw lineage source hash inventory is incomplete");
  }
  const selected = lineage.source.selected_text_assets;
  if (!selected || Object.keys(selected).length !== Object.keys(RAW_TABLE_COUNTS).length) fail("raw lineage selected source inventory is incomplete");
  for (const name of Object.keys(RAW_TABLE_COUNTS)) {
    const entry = selected?.[name];
    if (!entry || !Number.isInteger(entry.file_bytes) || entry.file_bytes <= 0 || !Number.isInteger(entry.script_bytes)
      || entry.script_bytes <= 0 || entry.human_readable !== true || entry.csv_preferred !== true) {
      fail(`raw lineage selected source record ${name} is incomplete`);
    }
  }
  const payloads = lineage.source.payloads;
  if (payloads?.apk_count !== 3 || !Array.isArray(payloads?.hashes) || payloads.hashes.length !== 3
    || payloads?.split_file_count !== 6 || !Array.isArray(payloads?.merged_split_files) || payloads?.merged_split_files?.length !== 6) {
    fail("raw lineage payload inventory is incomplete");
  }
  for (const payload of payloads?.hashes || []) {
    if (!Number.isInteger(payload.bytes) || payload.bytes <= 0 || !Number.isInteger(payload.entry_count) || payload.entry_count < 0
      || !/^[A-Fa-f0-9]{64}$/.test(String(payload.sha256 || ""))) fail("raw lineage payload hash metadata is invalid");
  }
}

function validateNoticeShape(lineage) {
  const officialNotice = lineage.source?.official_notice;
  if (officialNotice?.version !== "1.0.3"
    || officialNotice?.category !== "events.tactics_effects"
    || !/^[A-Fa-f0-9]{64}$/.test(String(officialNotice?.sha256 || ""))
    || !Array.isArray(officialNotice?.entries) || officialNotice?.entries?.length !== 3) {
    fail("raw lineage official 1.0.3 co-op tactic override evidence is incomplete");
  }
  if ((officialNotice?.entries || []).some((entry) => entry?.applied_mode !== "coop_disabled" || !entry?.tactics_kind)) {
    fail("raw lineage official co-op tactic override contains an invalid mapping");
  }
}

function validateProjectionShape(lineage) {
  const tableEntries = lineage.projection?.tables;
  if (!tableEntries || typeof tableEntries !== "object" || Object.keys(tableEntries).length !== Object.keys(RAW_TABLE_COUNTS).length) fail("raw lineage projection is missing selected raw tables");
  for (const [name, table] of Object.entries(tableEntries || {})) {
    if (!Array.isArray(table.records) || table.records.length !== RAW_TABLE_COUNTS[name]) fail(`raw lineage table ${name} has an unexpected record count`);
    if (!/^[A-Fa-f0-9]{64}$/.test(String(table.sha256 || ""))) fail(`raw lineage table ${name} has no valid SHA-256`);
  }
  if (!lineage.projection?.tree || lineage.projection.tree.nodes?.length !== 239 || lineage.projection.tree.edges?.length !== 248) {
    fail("raw lineage tree projection is not 239 nodes / 248 edges");
  }
  const localization = lineage.projection?.localization;
  if (!localization || !/^[A-Fa-f0-9]{64}$/.test(String(localization.sha256 || ""))
    || localization.count !== RAW_LOCALIZATION_COUNT
    || !Number.isInteger(localization.complete_count) || localization.complete_count <= 0) {
    fail("raw lineage localization inventory is incomplete");
  }
}

function validateCompendiumShape(lineage) {
  const compendium = lineage.compendium_expectations;
  if (!compendium || compendium.monster_types?.length !== 17 || compendium.monsters?.length !== 15
    || compendium.modes?.coop?.waves?.length !== 80 || compendium.modes?.hunt?.rewards?.length !== 30
    || compendium.modes?.versus?.trophy_base_hp?.length !== 20 || compendium.modes?.versus?.wave_profiles?.length !== 11
    || compendium.events?.length !== 55) {
    fail("raw lineage compendium expectations have incomplete coverage");
  }
}

function validateLineageShape(lineage) {
  validateBasicLineage(lineage);
  validateUnlockSupplementShape(lineage);
  validateSourceShape(lineage);
  validateNoticeShape(lineage);
  validateProjectionShape(lineage);
  validateCompendiumShape(lineage);
  hasAbsolutePath(lineage);
}

function main() {
  const lineage = readJsonFile(lineagePath);
  const current = readJsonFile(canonicalPath);
  const currentCompendium = readJsonFile(compendiumPath);
  validateLineageShape(lineage);
  const sourceArgument = getRawSourcePathArgument();
  const canReadRaw = Boolean(sourceArgument) || rawDefaultExists();
  if (canReadRaw) {
    const raw = loadRawSource(sourceArgument);
    const expected = buildCanonicalFromRaw(current, raw);
    const expectedCompendium = buildCompendiumFromRaw(currentCompendium, raw);
    compareExpected(current, expected);
    compareCompendiumExpected(currentCompendium, expectedCompendium);
    const freshLineage = buildLineage(raw, expected, expectedCompendium);
    if (!stableEqual(lineage, freshLineage)) fail("frozen raw lineage differs from the current local source; regenerate canonical data from raw");
  } else {
    compareFrozenExpectation(current, lineage);
    compareFrozenCompendiumExpectation(currentCompendium, lineage);
  }
  if (errors.length > 0) {
    console.error(`Raw canonical check failed (${errors.length} issue(s)):\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const mode = canReadRaw ? "local raw source" : "frozen raw lineage projection (raw files unavailable)";
  console.log(`Raw canonical check passed against ${mode}: 239 nodes, 248 edges, and deterministic labeled special-stat mappings.`);
}

try {
  main();
} catch (error) {
  console.error(`Raw canonical check failed: ${error.message}`);
  process.exitCode = 1;
}
