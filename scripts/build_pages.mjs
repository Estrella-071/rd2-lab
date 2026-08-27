import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNode3Icon } from '../src/domain/dice_icon.js';
import { normalizePublicIconPath } from './runtime_asset_paths.mjs';
import { orderedStylesheets } from './stylesheet_contract.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(rootDir, 'site');
const stagingDir = path.join(rootDir, '.pages');
const allowlistPath = path.join(siteDir, 'runtime-allowlist.json');
const writeAllowlist = process.argv.includes('--write-allowlist');

// 1. Synchronize src/ -> site/src/
function syncDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const sourceEntries = fs.readdirSync(src, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map(entry => entry.name));
  for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
    if (!sourceNames.has(entry.name)) {
      fs.rmSync(path.join(dest, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of sourceEntries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(destPath) && !fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { force: true });
      }
      syncDir(srcPath, destPath);
    } else {
      if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
syncDir(path.join(rootDir, 'src'), path.join(siteDir, 'src'));

// 2. Collect all src modules
function collectSrcFiles(dir, base = '') {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...collectSrcFiles(fullPath, relPath));
    } else if (entry.name.endsWith('.js')) {
      result.push(`src/${relPath}`.replaceAll("\\", '/'));
    }
  }
  return result;
}
function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
const srcFiles = collectSrcFiles(path.join(rootDir, 'src'));

const staticFiles = [
  'index.html',
  '_headers',
  '_routes.json',
  ...srcFiles.sort(compareText),
  ...orderedStylesheets,
  'favicon.svg',
  'favicon.png',
  'logo.png',
  'data/dice_tree.json',
  'data/dice_tree.svg',
  'data/game_data_metadata.json',
  'data/changelog.json',
  'data/locales.json',
  'data/official_update_notices.json',
  'data/provenance.json',
  'boss_event_data.json',
  'monster_visuals.json',
  'vendor/spine-webgl.min.js',
  'vendor/SPINE-RUNTIMES-LICENSE.txt',
];

const data = JSON.parse(fs.readFileSync(path.join(siteDir, 'data', 'dice_tree.json'), 'utf8'));
const treeSvgText = fs.readFileSync(path.join(siteDir, 'data', 'dice_tree.svg'), 'utf8');
const srcModulesText = collectSrcFiles(path.join(rootDir, 'src'))
  .map(file => fs.readFileSync(path.join(rootDir, file), 'utf8'))
  .join('\n');
const compendiumData = JSON.parse(fs.readFileSync(path.join(siteDir, 'boss_event_data.json'), 'utf8'));
const monsterVisuals = JSON.parse(fs.readFileSync(path.join(siteDir, 'monster_visuals.json'), 'utf8'));
const iconFiles = new Set();
if (/data:image\//i.test(treeSvgText)) {
  throw new Error('site/data/dice_tree.svg must reference reviewed HTTP assets instead of embedded data URLs.');
}
for (const match of treeSvgText.matchAll(/(?:xlink:)?href="(icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png)"/g)) {
  iconFiles.add(normalizePublicIconPath(match[1], 'dice-tree SVG sprite'));
}
for (const node of data.nodes || []) {
  if (typeof node.icon_file === 'string') {
    iconFiles.add(normalizePublicIconPath(node.icon_file, `dice-tree node ${node.id || 'unknown'}`));
  }
  const diceIcon = resolveNode3Icon(node);
  if (diceIcon) {
    iconFiles.add(normalizePublicIconPath(`icons/${diceIcon}`, `dice-tree node ${node.id || 'unknown'} resolved icon`));
  }
}
const collectSpecialStatIcons = value => {
  if (Array.isArray(value)) {
    value.forEach(collectSpecialStatIcons);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.special_stats)) {
    for (const stat of value.special_stats) {
      if (typeof stat?.icon !== 'string') continue;
      iconFiles.add(normalizePublicIconPath(`icons/${stat.icon}`, 'dice-tree special stat'));
    }
  }
  Object.values(value).forEach(collectSpecialStatIcons);
};
collectSpecialStatIcons(data.nodes);
for (const match of srcModulesText.matchAll(/icons\/([A-Za-z0-9_.-]+\.png)/g)) iconFiles.add(`icons/${match[1]}`);
iconFiles.add('icons/NodeAttackIcon.png');
iconFiles.add('icons/icon_menu_tree.png');
iconFiles.add('icons/LobbyIcon_Stat.png');
for (const monster of compendiumData.monsters || []) {
  if (typeof monster.icon === 'string') {
    iconFiles.add(normalizePublicIconPath(`icons/${monster.icon}`, `monster ${monster.id || monster.name_zh || 'unknown'}`));
  }
}
for (const event of compendiumData.events || []) {
  if (typeof event.icon === 'string') {
    iconFiles.add(normalizePublicIconPath(`icons/${event.icon}`, `event ${event.id || event.name_zh || 'unknown'}`));
  }
  if (Array.isArray(event.augment_choices)) {
    for (const choice of event.augment_choices) {
      if (typeof choice.icon === 'string') {
        iconFiles.add(normalizePublicIconPath(`icons/${choice.icon}`, `event ${event.id || event.name_zh || 'unknown'} augment choice`));
      }
    }
  }
}
for (const visual of Object.values(monsterVisuals.monsters || {})) {
  if (typeof visual.poster === 'string' && visual.poster.startsWith('icons/')) {
    iconFiles.add(normalizePublicIconPath(visual.poster, 'monster visual poster'));
  }
}
iconFiles.add('icons/boss_ring.png');
iconFiles.add('icons/tex_boss_magic_back.png');
// Additional reviewed runtime icons used by the public compendium.
for (const filename of [
  'Boss_Bubble.png', 'Boss_Hacking.png', 'Boss_Joker.png', 'Boss_Meteor.png',
  'Boss_Quick.png', 'Boss_Royal.png', 'Boss_Slime1.png', 'Boss_Snake.png',
  'Boss_Theif.png', 'FirstPurchase_box1.png', 'Icon_AD.png', 'Icon_Boss_Alert.png',
  'Icon_Time.png', 'Monster_Assassin.png', 'Monster_Bubble.png', 'Monster_Hacking.png',
  'Monster_Joker.png', 'Monster_Quick.png', 'Monster_Recovery.png',
  'Monster_Royal.png', 'Monster_Slime.png', 'Monster_Snake.png',
  'Monster_Thief.png', 'box.png', 'tex_boss_flower.png',
  'BigAdvance.png', 'BoardUpCtrLevel.png', 'DonateDestroyRandomAndBuffOpp.png',
  'EmptySlotOppSPGain.png', 'GambleDiceLevelBuff.png', 'InitialSP.png',
  'InterestSP.png', 'MarkedSameEyeSPBonus.png', 'MergeBonusSP.png',
  'MoreEmptySlotsOppAttackUp.png', 'OddOrEven.png', 'RandomReaperShotAndEyeDown.png',
  'SendSPOpponentOnZero.png', 'SpawnCostHalfRoyalOppDice.png', 'SpawnSPMinusPer.png',
  'UpgradeSPMinusPer.png', 'dice_bomb3.png'
]) iconFiles.add(`icons/${filename}`);

const assetFiles = new Set();
for (const visual of Object.values(monsterVisuals.monsters || {})) {
  for (const relativePath of Object.values(visual.spine || {})) {
    if (typeof relativePath !== 'string' || !relativePath.includes('/')) continue;
    if (!/^[A-Za-z0-9_./-]+$/.test(relativePath) || relativePath.startsWith('/') || relativePath.includes('..')) {
      throw new Error(`Unsafe monster asset path: ${relativePath}`);
    }
    assetFiles.add(relativePath);
  }
}
// Keep the original Slime1 skeleton beside the complete Slime3 route as a
// reviewed source variant; it is useful when comparing the boss's split form.
for (const relativePath of [
  'monsters/spine/Boss_Slime1.atlas',
  'monsters/spine/Boss_Slime1.png',
  'monsters/spine/Boss_Slime1.skel',
]) assetFiles.add(relativePath);

const expectedAllowlist = {
  version: 1,
  sourceOfTruth: 'site/data/dice_tree.json and site/data/dice_tree.svg',
  staticFiles,
  assetFiles: [...assetFiles].sort(compareText),
  iconFiles: [...iconFiles].sort(compareText),
};

if (!fs.existsSync(allowlistPath) || writeAllowlist) {
  fs.writeFileSync(allowlistPath, `${JSON.stringify(expectedAllowlist, null, 2)}\n`, 'utf8');
} else {
  const actualAllowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  if (JSON.stringify(actualAllowlist) !== JSON.stringify(expectedAllowlist)) {
    console.error('site/runtime-allowlist.json is stale. Run: node scripts/build_pages.mjs --write-allowlist');
    process.exit(1);
  }
}

const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
const files = [...allowlist.staticFiles, ...(allowlist.assetFiles || []), ...allowlist.iconFiles];
const missing = files.filter(relativePath => {
  const resolved = path.resolve(siteDir, relativePath);
  if (!resolved.startsWith(`${siteDir}${path.sep}`) || !fs.existsSync(resolved)) return true;
  const directoryEntries = fs.readdirSync(path.dirname(resolved));
  return !fs.statSync(resolved).isFile() || !directoryEntries.includes(path.basename(resolved));
});
if (missing.length > 0) {
  console.error(`Runtime allowlist references missing files:\n- ${missing.join('\n- ')}`);
  process.exit(1);
}

try {
  fs.rmSync(stagingDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
} catch {
  if (fs.existsSync(stagingDir)) {
    for (const entry of fs.readdirSync(stagingDir)) {
      try {
        fs.rmSync(path.join(stagingDir, entry), { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
      } catch {}
    }
  }
}
for (const relativePath of files) {
  const source = path.resolve(siteDir, relativePath);
  const destination = path.join(stagingDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
fs.writeFileSync(path.join(stagingDir, 'runtime-manifest.json'), `${JSON.stringify({ ...allowlist, files }, null, 2)}\n`, 'utf8');
console.log(`Pages staging built: ${files.length} files in ${path.relative(rootDir, stagingDir)}.`);
