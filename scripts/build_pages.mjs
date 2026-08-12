import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNode3Icon } from '../src/domain/dice_icon.js';
import { minifyCssForStaging } from './lib/css_runtime.mjs';
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
  '_redirects',
  '_routes.json',
  'robots.txt',
  'sitemap.xml',
  'og-preview.png',
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
  'monster_posters.json',
];

const data = JSON.parse(fs.readFileSync(path.join(siteDir, 'data', 'dice_tree.json'), 'utf8'));
const treeSvgText = fs.readFileSync(path.join(siteDir, 'data', 'dice_tree.svg'), 'utf8');
const srcModulesText = collectSrcFiles(path.join(rootDir, 'src'))
  .map(file => fs.readFileSync(path.join(rootDir, file), 'utf8'))
  .join('\n');
const compendiumData = JSON.parse(fs.readFileSync(path.join(siteDir, 'boss_event_data.json'), 'utf8'));
const monsterPosters = JSON.parse(fs.readFileSync(path.join(siteDir, 'monster_posters.json'), 'utf8'));

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildSitemapXml() {
  const locales = ['zh-tw', 'en', 'ja', 'ko'];
  const routes = new Set();
  const addRoute = route => routes.add(route);
  addRoute('/');
  addRoute('/compendium/dice');
  addRoute('/compendium/monster');
  addRoute('/compendium/event');
  for (const node of data.nodes || []) {
    if (node?.id === undefined || node?.id === null) continue;
    const id = encodeURIComponent(String(node.id));
    addRoute(`/tree/node/${id}`);
    if ((node.node_type || node.type) === 'DICE') addRoute(`/compendium/dice/${id}`);
  }
  for (const monster of compendiumData.monsters || []) {
    if (monster?.id !== undefined && monster?.id !== null) addRoute(`/compendium/monster/${encodeURIComponent(String(monster.id))}`);
  }
  const events = [
    ...(compendiumData.events || []),
    ...(compendiumData.historical_events || [])
  ];
  for (const event of events) {
    const id = event?.id ?? event?.index;
    if (id !== undefined && id !== null) addRoute(`/compendium/event/${encodeURIComponent(String(id))}`);
  }
  const entries = [...routes].sort(compareText).flatMap((route) => locales.map((locale) => {
    const pathSuffix = route.startsWith('/') ? route : `/${route}`;
    const alternates = locales.map(alternateLocale => `<xhtml:link rel="alternate" hreflang="${alternateLocale === 'zh-tw' ? 'zh-Hant' : alternateLocale}" href="https://rd2-lab.pages.dev/${alternateLocale}${pathSuffix}" />`).join('');
    const pageUrl = `https://rd2-lab.pages.dev/${locale}${pathSuffix}`;
    return `<url><loc>${escapeXml(pageUrl)}</loc>${alternates}</url>`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>\n`;
}

fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), buildSitemapXml(), 'utf8');
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
for (const poster of Object.values(monsterPosters.monsters || {})) {
  if (typeof poster.poster === 'string' && poster.poster.startsWith('icons/')) {
    iconFiles.add(normalizePublicIconPath(poster.poster, 'monster poster'));
  }
}
iconFiles.add('icons/boss_ring.png');
iconFiles.add('icons/tex_boss_magic_back.png');
// Additional reviewed runtime icons used by the public compendium.
for (const filename of [
  'FirstPurchase_box1.png', 'Icon_AD.png', 'Icon_Boss_Alert.png', 'Icon_Time.png',
  'BigAdvance.png', 'BoardUpCtrLevel.png', 'DonateDestroyRandomAndBuffOpp.png',
  'EmptySlotOppSPGain.png', 'GambleDiceLevelBuff.png', 'InitialSP.png',
  'InterestSP.png', 'MarkedSameEyeSPBonus.png', 'MergeBonusSP.png',
  'MoreEmptySlotsOppAttackUp.png', 'OddOrEven.png', 'RandomReaperShotAndEyeDown.png',
  'SendSPOpponentOnZero.png', 'SpawnCostHalfRoyalOppDice.png', 'SpawnSPMinusPer.png',
  'UpgradeSPMinusPer.png', 'dice_bomb3.png', 'targetingtype_icon.png'
]) iconFiles.add(`icons/${filename}`);

const assetFiles = new Set();

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

for (const stylesheet of orderedStylesheets) {
  const stylesheetPath = path.join(stagingDir, stylesheet);
  const source = fs.readFileSync(stylesheetPath, 'utf8');
  fs.writeFileSync(stylesheetPath, minifyCssForStaging(source), 'utf8');
}

function calculateReleaseId(relativePaths) {
  const hash = createHash('sha256');
  for (const relativePath of [...new Set(relativePaths)].sort(compareText)) {
    hash.update(relativePath).update('\0');
    hash.update(fs.readFileSync(path.join(stagingDir, relativePath))).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function versionStagingRuntime(releaseId) {
  const versionQuery = `?v=${releaseId}`;
  const indexPath = path.join(stagingDir, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  for (const stylesheet of orderedStylesheets) {
    const pattern = new RegExp(`(href=["'])${escapeRegExp(stylesheet)}(["'])`, 'g');
    indexHtml = indexHtml.replace(pattern, `$1${stylesheet}${versionQuery}$2`);
  }
  indexHtml = indexHtml.replace(
    /(src=["'])src\/main\.js(["'])/,
    `$1src/main.js${versionQuery}$2`,
  );
  fs.writeFileSync(indexPath, indexHtml, 'utf8');

  const moduleImportPattern = /((?:from\s+|import\s*\()["'])(\.\.?\/[^"'?]+\.js)(["'])/g;
  for (const relativePath of files.filter(file => file.startsWith('src/') && file.endsWith('.js'))) {
    const modulePath = path.join(stagingDir, relativePath);
    const source = fs.readFileSync(modulePath, 'utf8');
    const versioned = source.replace(
      moduleImportPattern,
      (_match, prefix, importPath, closingQuote) => `${prefix}${importPath}${versionQuery}${closingQuote}`,
    );
    if (versioned !== source) fs.writeFileSync(modulePath, versioned, 'utf8');
  }
}

const releaseId = calculateReleaseId(files);
versionStagingRuntime(releaseId);
fs.writeFileSync(
  path.join(stagingDir, 'runtime-manifest.json'),
  `${JSON.stringify({ ...allowlist, files, releaseId }, null, 2)}\n`,
  'utf8',
);
console.log(`Pages staging built: ${files.length} files in ${path.relative(rootDir, stagingDir)}.`);
