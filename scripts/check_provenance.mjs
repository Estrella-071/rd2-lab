import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provenance = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'provenance.json'), 'utf8'));
const publicProvenancePath = path.join(rootDir, 'site', 'data', 'provenance.json');
const publicProvenance = JSON.parse(fs.readFileSync(publicProvenancePath, 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'data', 'dice_tree.json'), 'utf8'));
const metadataPath = path.join(rootDir, 'site', 'data', 'game_data_metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const compendium = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'boss_event_data.json'), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'data', 'changelog.json'), 'utf8'));
const officialNotices = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'data', 'official_update_notices.json'), 'utf8'));
const monsterVisuals = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'monster_visuals.json'), 'utf8'));
const errors = [];

if (JSON.stringify(provenance) !== JSON.stringify(publicProvenance)) errors.push('public provenance copy differs from data/provenance.json');

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, relativePath))).digest('hex').toUpperCase();
}

for (const entry of Object.values(provenance.publishedData || {})) {
  if (!entry || typeof entry !== 'object' || !entry.path || !entry.sha256) continue;
  if (!fs.existsSync(path.join(rootDir, entry.path))) errors.push(`${entry.path} is missing`);
  else if (sha256(entry.path) !== entry.sha256.toUpperCase()) errors.push(`${entry.path} hash differs from data/provenance.json`);
}
if (provenance.publishedData?.nodeCount !== data.summary?.node_count) errors.push('provenance nodeCount does not match data summary');
if (provenance.publishedData?.edgeCount !== data.summary?.edge_count) errors.push('provenance edgeCount does not match data summary');
if (provenance.snapshotId !== metadata.canonical?.snapshot_id) errors.push('provenance snapshotId does not match canonical metadata');
if (provenance.publishedData?.gameDataVersion !== metadata.canonical?.game_version) errors.push('provenance gameDataVersion does not match canonical metadata');
if (metadata.canonical?.game_version !== changelog.canonical_version) errors.push('changelog canonical_version does not match canonical metadata');
if (metadata.canonical?.official_notices_path !== 'data/official_update_notices.json') errors.push('official notices path does not match canonical metadata');
if (changelog.official_notices_source !== 'data/official_update_notices.json') errors.push('changelog official notices source does not match canonical metadata path');
if (!Array.isArray(officialNotices.notices)) errors.push('official notices document does not contain notices[]');
const officialNoticeIds = new Set((officialNotices.notices || []).map((notice) => notice.id));
for (const noticeId of metadata.source?.official_notice_ids || []) {
  if (!officialNoticeIds.has(noticeId)) errors.push(`canonical metadata references unknown official notice ${noticeId}`);
}
if (metadata.canonical?.game_version !== compendium.meta?.game_data_version) errors.push('compendium game_data_version does not match canonical metadata');
if (compendium.meta?.snapshot?.snapshot_id !== metadata.canonical?.snapshot_id) errors.push('compendium snapshot_id does not match canonical metadata');
if (compendium.meta?.snapshot?.metadata_ref !== 'data/game_data_metadata.json') errors.push('compendium metadata_ref does not point to canonical metadata');
if (monsterVisuals.snapshot?.snapshot_id !== metadata.canonical?.snapshot_id) errors.push('monster visuals snapshot_id does not match canonical metadata');
if (monsterVisuals.snapshot?.metadata_ref !== 'data/game_data_metadata.json') errors.push('monster visuals metadata_ref does not point to canonical metadata');
if (metadata.canonical?.visuals_path !== 'monster_visuals.json') errors.push('canonical metadata visuals_path is incorrect');
if (data.metadata_ref !== 'data/game_data_metadata.json') errors.push('dice tree metadata_ref does not point to canonical metadata');
if (metadata.source?.tree_node_count !== data.summary?.node_count) errors.push('metadata tree_node_count does not match canonical tree');
if (metadata.source?.tree_edge_count !== data.summary?.edge_count) errors.push('metadata tree_edge_count does not match canonical tree');
const sourceVersions = new Set((metadata.versions || []).map((entry) => entry.version));
for (const version of ['1.0.0', '1.0.2', '1.0.3']) {
  if (!sourceVersions.has(version)) errors.push(`canonical metadata is missing source version ${version}`);
}

if (errors.length > 0) {
  console.error(`Provenance check failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Provenance check passed for ${provenance.snapshotId}.`);
