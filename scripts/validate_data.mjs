import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertSafeDiceTreeSvg } from '../src/infra/http_data_repository.js';
import { validateTreeRenderAssets } from './lib/validate_tree_render_assets.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(rootDir, 'site', 'data', 'dice_tree.json');
const schemaPath = path.join(rootDir, 'schema', 'dice-tree.schema.json');
const bossDataPath = path.join(rootDir, 'site', 'boss_event_data.json');
const bossSchemaPath = path.join(rootDir, 'schema', 'boss-event-data.schema.json');
const metadataPath = path.join(rootDir, 'site', 'data', 'game_data_metadata.json');
const changelogPath = path.join(rootDir, 'site', 'data', 'changelog.json');
const officialNoticesPath = path.join(rootDir, 'site', 'data', 'official_update_notices.json');
const officialNoticesSchemaPath = path.join(rootDir, 'schema', 'official-update-notices.schema.json');
const unlockSupplementsPath = path.join(rootDir, 'data', 'unlock_condition_supplements.json');
const unlockSupplementsSchemaPath = path.join(rootDir, 'schema', 'unlock-condition-supplements.schema.json');
const metadataSchemaPath = path.join(rootDir, 'schema', 'game-data-metadata.schema.json');
const visualsPath = path.join(rootDir, 'site', 'monster_visuals.json');
const visualsSchemaPath = path.join(rootDir, 'schema', 'monster-visuals.schema.json');
const provenancePath = path.join(rootDir, 'data', 'provenance.json');
const provenanceSchemaPath = path.join(rootDir, 'schema', 'provenance.schema.json');
const siteDir = path.join(rootDir, 'site');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const bossData = JSON.parse(fs.readFileSync(bossDataPath, 'utf8'));
const bossSchema = JSON.parse(fs.readFileSync(bossSchemaPath, 'utf8'));
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
const officialNotices = JSON.parse(fs.readFileSync(officialNoticesPath, 'utf8'));
const officialNoticesSchema = JSON.parse(fs.readFileSync(officialNoticesSchemaPath, 'utf8'));
const unlockSupplements = JSON.parse(fs.readFileSync(unlockSupplementsPath, 'utf8'));
const unlockSupplementsSchema = JSON.parse(fs.readFileSync(unlockSupplementsSchemaPath, 'utf8'));
const metadataSchema = JSON.parse(fs.readFileSync(metadataSchemaPath, 'utf8'));
const visuals = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));
const visualsSchema = JSON.parse(fs.readFileSync(visualsSchemaPath, 'utf8'));
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
const provenanceSchema = JSON.parse(fs.readFileSync(provenanceSchemaPath, 'utf8'));
const svgText = fs.readFileSync(path.join(siteDir, 'data', 'dice_tree.svg'), 'utf8');

const errors = [];
const nodes = Array.isArray(data.nodes) ? data.nodes : [];
const nodeIds = new Set(nodes.map(node => node.id));
const branchNames = new Set(['自然', '工學', '魔法', '秩序', '渾沌']);
const nodeTypes = new Set(['DICE', 'DICE_RUNE', 'PLAYER_PASSIVE', 'PERK']);
const publicIconNames = new Set(fs.readdirSync(path.join(siteDir, 'icons')));

function fail(message) {
  errors.push(message);
}

function validateSpecialStatIcons(value, context = 'data') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSpecialStatIcons(entry, `${context}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.special_stats)) {
    value.special_stats.forEach((stat, index) => {
      const icon = stat?.icon;
      if (icon === undefined) return;
      if (typeof icon !== 'string' || !/^[A-Za-z0-9_.-]+\.png$/.test(icon)) {
        fail(`${context}.special_stats[${index}].icon is not a safe PNG filename`);
      } else if (!publicIconNames.has(icon)) {
        fail(`${context}.special_stats[${index}].icon does not match an exact site/icons filename: ${icon}`);
      }
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'special_stats') validateSpecialStatIcons(child, `${context}.${key}`);
  }
}

if (!schema.$id || !schema.properties?.nodes) fail('schema/dice-tree.schema.json is incomplete');
else {
  const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validateSchema(data)) {
    for (const issue of validateSchema.errors || []) {
      errors.push(`schema${issue.instancePath || '/'} ${issue.message}`);
    }
  }
}

if (!bossSchema.properties?.events || !bossSchema.properties?.historical_events) fail('schema/boss-event-data.schema.json is incomplete');
else {
  const validateBossSchema = new Ajv2020({ allErrors: true, strict: true }).compile(bossSchema);
  if (!validateBossSchema(bossData)) {
    for (const issue of validateBossSchema.errors || []) {
      errors.push(`boss-schema${issue.instancePath || '/'} ${issue.message}`);
    }
  }
}

if (!officialNoticesSchema.$id || !officialNoticesSchema.properties?.notices) fail('schema/official-update-notices.schema.json is incomplete');
else {
  const validateOfficialNotices = new Ajv2020({ allErrors: true, strict: true }).compile(officialNoticesSchema);
  if (!validateOfficialNotices(officialNotices)) {
    for (const issue of validateOfficialNotices.errors || []) {
      errors.push(`official-notices${issue.instancePath || '/'} ${issue.message}`);
    }
  }
}

if (!unlockSupplementsSchema.$id || !unlockSupplementsSchema.properties?.entries) fail('schema/unlock-condition-supplements.schema.json is incomplete');
else {
  const validateUnlockSupplements = new Ajv2020({ allErrors: true, strict: true }).compile(unlockSupplementsSchema);
  if (!validateUnlockSupplements(unlockSupplements)) {
    for (const issue of validateUnlockSupplements.errors || []) {
      errors.push(`unlock-supplements${issue.instancePath || '/'} ${issue.message}`);
    }
  }
}

for (const [label, document, documentSchema] of [
  ['game-data-metadata', metadata, metadataSchema],
  ['monster-visuals', visuals, visualsSchema],
  ['provenance', provenance, provenanceSchema]
]) {
  if (!documentSchema.$id) {
    fail(`schema for ${label} is incomplete`);
    continue;
  }
  const validateDocument = new Ajv2020({ allErrors: true, strict: true }).compile(documentSchema);
  if (!validateDocument(document)) {
    for (const issue of validateDocument.errors || []) {
      errors.push(`${label}-schema${issue.instancePath || '/'} ${issue.message}`);
    }
  }
}

const canonicalVersion = metadata?.canonical?.game_version;
if (!/^(\d+)\.(\d+)\.(\d+)$/.test(String(canonicalVersion || ''))) fail('canonical metadata game_version must be semver-like');
if (metadata?.canonical?.snapshot_id !== metadata?.source?.snapshot_id) fail('canonical metadata source snapshot does not match canonical snapshot');
if (metadata?.canonical?.game_version !== changelog?.canonical_version) fail('changelog canonical_version must match canonical metadata');
if (metadata?.canonical?.game_version !== bossData?.meta?.game_data_version) fail('boss event game_data_version must match canonical metadata');
if (metadata?.canonical?.official_notices_path !== 'data/official_update_notices.json') fail('canonical metadata official_notices_path is incorrect');
if (metadata?.canonical?.provenance_path !== 'data/provenance.json') fail('canonical metadata provenance_path is incorrect');
const noticesByVersion = new Map((officialNotices.notices || []).map((notice) => [String(notice.version), notice]));
for (const notice of officialNotices.notices || []) {
  const entry = (changelog.entries || []).find((candidate) => candidate.version === notice.version);
  const metadataVersion = (metadata.versions || []).find((candidate) => candidate.version === notice.version);
  if (!entry) fail(`changelog is missing official notice version ${notice.version}`);
  if (!metadataVersion) fail(`canonical metadata is missing official notice version ${notice.version}`);
  const metadataDate = metadataVersion?.date;
  if (metadataVersion && metadataDate !== notice.effective_at) fail(`metadata date does not match official notice ${notice.id}`);
  if (entry && !(entry.official_notices || []).some((source) => source.id === notice.id)) fail(`changelog is missing official notice ${notice.id}`);
}
for (const entry of changelog.entries || []) {
  if (entry.version && entry.official_notices?.length && !noticesByVersion.has(String(entry.version))) {
    fail(`changelog entry ${entry.version} references an unknown official notice`);
  }
}
if (data.metadata_ref !== 'data/game_data_metadata.json') fail('dice tree metadata_ref must use the canonical metadata path');
const activeEventIds = new Set((bossData.events || []).map((event) => String(event.id)));
for (const event of bossData.historical_events || []) {
  if (activeEventIds.has(String(event.id))) fail(`historical event ${event.id} is still active`);
  if (event.status !== 'removed' || event.is_removed !== true) fail(`historical event ${event.id} must be marked removed`);
}
const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
for (const entry of unlockSupplements.resource_free_nodes || []) {
  const node = nodesById.get(String(entry.node_id));
  const costsAreEmpty = node
    && Array.isArray(node.gold_costs) && node.gold_costs.length === 0
    && Array.isArray(node.core_costs) && node.core_costs.length === 0
    && Number(node.unlock_gold) === 0 && Number(node.unlock_core) === 0
    && Number(node.total_gold) === 0 && Number(node.total_core) === 0;
  if (!costsAreEmpty) fail(`resource-free node ${entry.node_id} still exposes a resource cost`);
  if (node && node.unlock_cost_policy?.policy !== 'resource_free') fail(`resource-free node ${entry.node_id} has no generated cost policy`);
}
for (const entry of unlockSupplements.entries || []) {
  const node = nodesById.get(String(entry.node_id));
  if (!node || node.unlock_condition_key !== entry.key || String(node.unlock_condition_value || '') !== entry.value
    || node.unlock_condition_evidence?.source_type !== entry.source_type) {
    fail(`unlock supplement ${entry.node_id} is not reflected in canonical node data`);
  }
}
const removedCoopTactics = officialNotices.notices
  ?.find((notice) => String(notice.version) === '1.0.3')
  ?.categories?.removed
  ?.find((item) => item.category === 'events' && item.entity === 'tactics_effects')?.ids || [];
for (const tacticName of removedCoopTactics) {
  const event = (bossData.events || []).find((candidate) => candidate.name_zh === tacticName);
  if (!event) fail(`1.0.3 removed co-op tactic ${tacticName} is missing from the event catalogue`);
  else if (event.mode_flags?.coop !== false || event.coop_time !== null || event.coop_seconds !== 0 || (event.coop_wave_refs || []).length !== 0) {
    fail(`1.0.3 removed co-op tactic ${tacticName} still exposes co-op application data`);
  }
}
for (const [field, value] of [
  ['total_unlock_gold', nodes.reduce((total, node) => total + (Number(node.unlock_gold) || 0), 0)],
  ['total_unlock_core', nodes.reduce((total, node) => total + (Number(node.unlock_core) || 0), 0)],
  ['total_max_gold', nodes.reduce((total, node) => total + (Number(node.total_gold) || 0), 0)],
  ['total_max_core', nodes.reduce((total, node) => total + (Number(node.total_core) || 0), 0)]
]) {
  if (data.summary?.[field] !== value) fail(`summary.${field}=${data.summary?.[field]} but canonical nodes total ${value}`);
}
validateSpecialStatIcons(data.nodes, 'nodes');
if (!data.summary || !Array.isArray(data.nodes)) fail('root must contain summary and nodes');
try {
  assertSafeDiceTreeSvg(svgText, 'site/data/dice_tree.svg');
} catch (error) {
  fail(error.message);
}
if (/data:image\//i.test(svgText)) fail('dice tree SVG must use reviewed HTTP image assets');
for (const issue of validateTreeRenderAssets(rootDir, svgText)) fail(issue);
for (const match of svgText.matchAll(/(?:xlink:)?href="(icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png)"/g)) {
  const filename = match[1].slice('icons/'.length);
  if (!publicIconNames.has(filename)) {
    fail(`dice tree SVG references a missing public icon: ${match[1]}`);
  }
}
if (data.summary?.node_count !== nodes.length) fail(`summary.node_count=${data.summary?.node_count} but nodes=${nodes.length}`);

const typeCounts = Object.create(null);
const branchCounts = Object.create(null);
let edgeCount = 0;

for (const node of nodes) {
  if (!node || typeof node !== 'object') {
    fail('nodes contains a non-object entry');
    continue;
  }
  if (!node.id || typeof node.id !== 'string') fail('every node needs a string id');
  if (nodeIds.size !== nodes.length) fail('node ids must be unique');
  if (!Number.isInteger(node.branch) || node.branch < 1 || node.branch > 5) fail(`invalid branch for ${node.id}`);
  if (!branchNames.has(node.branch_zh)) fail(`invalid canonical branch_zh for ${node.id}: ${node.branch_zh}`);
  if (!nodeTypes.has(node.node_type)) fail(`invalid node_type for ${node.id}: ${node.node_type}`);
  if (!Array.isArray(node.incoming) || !Array.isArray(node.next_nodes)) fail(`edge arrays missing for ${node.id}`);

  typeCounts[node.node_type] = (typeCounts[node.node_type] || 0) + 1;
  branchCounts[String(node.branch)] = (branchCounts[String(node.branch)] || 0) + 1;
  edgeCount += node.next_nodes?.length || 0;

  const iconFile = node.icon_file;
  if (typeof iconFile !== 'string' || !iconFile.startsWith('icons/')) {
    fail(`icon_file must use the public icons/ path for ${node.id}: ${iconFile}`);
  } else {
    const iconPath = path.resolve(siteDir, iconFile);
    const iconsRoot = path.resolve(siteDir, 'icons') + path.sep;
    if (!iconPath.startsWith(iconsRoot)) fail(`icon_file escapes site/icons for ${node.id}: ${iconFile}`);
    else if (!fs.existsSync(iconPath)) fail(`icon_file does not exist for ${node.id}: ${iconFile}`);
  }

  for (const target of [...(node.incoming || []), ...(node.next_nodes || [])]) {
    if (!nodeIds.has(target)) fail(`edge ${node.id} -> ${target} references an unknown node`);
    if (target === node.id) fail(`node ${node.id} has a self-edge`);
  }
}

if (data.summary?.edge_count !== edgeCount) fail(`summary.edge_count=${data.summary?.edge_count} but next_nodes=${edgeCount}`);
for (const [key, expected] of Object.entries(data.summary?.nodes_by_type || {})) {
  if (typeCounts[key] !== expected) fail(`nodes_by_type.${key}=${expected} but counted ${typeCounts[key] || 0}`);
}
for (const [key, expected] of Object.entries(data.summary?.nodes_by_branch || {})) {
  if (branchCounts[key] !== expected) fail(`nodes_by_branch.${key}=${expected} but counted ${branchCounts[key] || 0}`);
}

if (errors.length > 0) {
  console.error(`Data validation failed (${errors.length} issue(s)):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(`Data validation passed: ${nodes.length} nodes, ${edgeCount} directed edges, ${Object.keys(typeCounts).length} node types.`);
