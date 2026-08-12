import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCompendiumFromRaw,
  buildCanonicalFromRaw,
  buildLineage,
  getRawSourcePathArgument,
  loadRawSource,
  readJsonFile,
  stableEqual,
  writeJson
} from "./lib/raw_pipeline.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = path.join(rootDir, "site", "data", "dice_tree.json");
const svgPath = path.join(rootDir, "site", "data", "dice_tree.svg");
const metadataPath = path.join(rootDir, "site", "data", "game_data_metadata.json");
const compendiumPath = path.join(rootDir, "site", "boss_event_data.json");
const lineagePath = path.join(rootDir, "data", "raw_snapshot_1.0.3.json");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function applyTopologyCorrectionsToSvg(corrections) {
  if (!fs.existsSync(svgPath)) throw new Error("site/data/dice_tree.svg is missing");
  let svg = fs.readFileSync(svgPath, "utf8");
  const positions = new Map();
  for (const match of svg.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*>/g)) {
    const translate = match[0].match(/\btransform="translate\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)"/);
    if (translate) positions.set(match[1], { x: Number(translate[1]), y: Number(translate[2]) });
  }
  for (const correction of corrections || []) {
    const from = positions.get(correction.from_node_id);
    const to = positions.get(correction.to_node_id);
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) {
      throw new Error(`topology correction ${correction.from_node_id}->${correction.to_node_id} has no valid SVG node positions`);
    }
    const pathMarkup = `<path class="edge" d="M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}"/>`;
    const pathLine = `${pathMarkup}\n`;
    const occurrences = svg.split(pathLine).length - 1;
    if (occurrences > 1) throw new Error(`SVG contains duplicate edge paths for ${correction.from_node_id}->${correction.to_node_id}`);
    if (occurrences === 1) svg = svg.replace(pathLine, "");
    else if (svg.includes(pathMarkup)) svg = svg.replace(pathMarkup, "");
  }
  fs.writeFileSync(svgPath, svg, "utf8");
}

function buildExpectedMetadata(current, canonical, raw) {
  return {
    ...current,
    source: {
      ...current.source,
      tree_node_count: canonical.summary.node_count,
      tree_edge_count: canonical.summary.edge_count,
      raw_tree_edge_count: raw.tree.edges.length,
      topology_correction_count: raw.unlockSupplements.topology_correction_count
    }
  };
}

function updateProvenance() {
  const canonicalHash = sha256File(canonicalPath);
  const svgHash = sha256File(svgPath);
  const compendiumHash = sha256File(compendiumPath);
  for (const filePath of [path.join(rootDir, "data", "provenance.json"), path.join(rootDir, "site", "data", "provenance.json")]) {
    const provenance = readJsonFile(filePath);
    if (!provenance.publishedData?.json) throw new Error(`${path.relative(rootDir, filePath)} has no publishedData.json entry`);
    provenance.publishedData.json.sha256 = canonicalHash;
    if (!provenance.publishedData?.svg) throw new Error(`${path.relative(rootDir, filePath)} has no publishedData.svg entry`);
    provenance.publishedData.svg.sha256 = svgHash;
    if (!provenance.publishedData?.compendium) throw new Error(`${path.relative(rootDir, filePath)} has no publishedData.compendium entry`);
    provenance.publishedData.compendium.sha256 = compendiumHash;
    if (!provenance.publishedData?.metadata) throw new Error(`${path.relative(rootDir, filePath)} has no publishedData.metadata entry`);
    provenance.publishedData.metadata.sha256 = sha256File(metadataPath);
    provenance.publishedData.nodeCount = JSON.parse(fs.readFileSync(canonicalPath, "utf8")).summary.node_count;
    provenance.publishedData.edgeCount = JSON.parse(fs.readFileSync(canonicalPath, "utf8")).summary.edge_count;
    writeJson(filePath, provenance);
  }
  return { canonicalHash, compendiumHash };
}

function summarizeDifferences(current, expected) {
  const differences = [];
  if (current.summary?.node_count !== expected.summary?.node_count) differences.push("summary.node_count");
  if (current.summary?.edge_count !== expected.summary?.edge_count) differences.push("summary.edge_count");
  const currentNodes = new Map((current.nodes || []).map((node) => [String(node.id), node]));
  for (const expectedNode of expected.nodes || []) {
    const currentNode = currentNodes.get(String(expectedNode.id));
    if (!currentNode) {
      differences.push(`nodes.${expectedNode.id} (missing)`);
      continue;
    }
    if (!stableEqual(currentNode, expectedNode)) {
      differences.push(`nodes.${expectedNode.id}`);
      if (differences.length >= 12) break;
    }
  }
  if (!stableEqual(current.raw_lineage, expected.raw_lineage)) differences.push("raw_lineage");
  return differences;
}

function summarizeCompendiumDifferences(current, expected) {
  if (stableEqual(current, expected)) return [];
  const differences = [];
  for (const [key, value] of Object.entries(expected.meta?.event_counts || {})) {
    if (current.meta?.event_counts?.[key] !== value) differences.push(`meta.event_counts.${key}`);
  }
  if (!stableEqual(current.modes?.coop?.waves, expected.modes?.coop?.waves)) differences.push("modes.coop.waves");
  if (!stableEqual(current.modes?.hunt?.rewards, expected.modes?.hunt?.rewards)) differences.push("modes.hunt.rewards");
  if (!stableEqual(current.modes?.versus, expected.modes?.versus)) differences.push("modes.versus");
  if (!stableEqual(current.events, expected.events)) differences.push("events");
  if (!stableEqual(current.monster_types, expected.monster_types)) differences.push("monster_types");
  if (!stableEqual(current.monsters, expected.monsters)) differences.push("monsters");
  if (!stableEqual(current.raw_lineage, expected.raw_lineage)) differences.push("raw_lineage");
  return differences;
}

function summarizeMetadataDifferences(current, expected) {
  return ["tree_node_count", "tree_edge_count", "raw_tree_edge_count", "topology_correction_count"]
    .filter((field) => current.source?.[field] !== expected.source?.[field])
    .map((field) => `source.${field}`);
}

function main() {
  const sourceArgument = getRawSourcePathArgument();
  const raw = loadRawSource(sourceArgument);
  const current = readJsonFile(canonicalPath);
  const currentMetadata = readJsonFile(metadataPath);
  const currentCompendium = readJsonFile(compendiumPath);
  const expected = buildCanonicalFromRaw(current, raw);
  const expectedMetadata = buildExpectedMetadata(currentMetadata, expected, raw);
  const expectedCompendium = buildCompendiumFromRaw(currentCompendium, raw);
  const differences = summarizeDifferences(current, expected);
  const metadataDifferences = summarizeMetadataDifferences(currentMetadata, expectedMetadata);
  const compendiumDifferences = summarizeCompendiumDifferences(currentCompendium, expectedCompendium);
  if (hasFlag("--check") || !hasFlag("--write")) {
    if (differences.length > 0 || metadataDifferences.length > 0 || compendiumDifferences.length > 0) {
      const allDifferences = [
        ...differences.map((entry) => `tree.${entry}`),
        ...metadataDifferences.map((entry) => `metadata.${entry}`),
        ...compendiumDifferences.map((entry) => `compendium.${entry}`)
      ];
      console.error(`Canonical raw check failed (${allDifferences.length} difference(s)):\n- ${allDifferences.join("\n- ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Canonical raw check passed: ${expected.nodes.length} nodes and ${expected.nodes.filter((node) => node.node_type === "DICE").length} dice are reproducible from ${raw.snapshotId}.`);
    return;
  }

  writeJson(canonicalPath, expected);
  applyTopologyCorrectionsToSvg(raw.unlockSupplements?.topology_corrections);
  writeJson(metadataPath, expectedMetadata);
  writeJson(compendiumPath, expectedCompendium);
  const lineage = buildLineage(raw, expected, expectedCompendium);
  writeJson(lineagePath, lineage);
  const { canonicalHash, compendiumHash } = updateProvenance();
  const dice = expected.nodes.filter((node) => node.node_type === "DICE");
  const statCount = dice.reduce((total, node) => total + (node.special_stats?.length || 0), 0);
  console.log(`Canonical data generated from raw ${raw.snapshotId}: ${expected.nodes.length} nodes, ${expected.edges.length} edges, ${dice.length} dice, ${statCount} labeled special stats.`);
  console.log(`Compendium regenerated from raw: ${expectedCompendium.monster_types.length} monster types, ${expectedCompendium.modes.coop.waves.length} co-op waves, ${expectedCompendium.modes.versus.wave_profiles.length} versus waves, ${expectedCompendium.events.length} active events.`);
  console.log(`Raw lineage written to ${path.relative(rootDir, lineagePath)}; canonical SHA-256 ${canonicalHash}; compendium SHA-256 ${compendiumHash}.`);
}

try {
  main();
} catch (error) {
  console.error(`Canonical raw generation failed: ${error.message}`);
  process.exitCode = 1;
}
