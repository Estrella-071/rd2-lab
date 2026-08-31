import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicPathReferences } from './public_path_contract.mjs';
import { assertMapRenderManifestShape } from '../src/infra/http_data_repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..');
const pagesDir = path.join(websiteDir, '.pages');

const errors = [];

// 1. Check index.html script tag
const indexHtml = fs.readFileSync(path.join(pagesDir, 'index.html'), 'utf8');
const hasModuleScript = /<script type="module" src="src\/main\.js\?v=[a-f0-9]{16}"><\/script>/.test(indexHtml);
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const hasVersionedStylesheets = [
  'styles.css',
  'styles-features.css',
  'styles-overlays.css',
].every(stylesheet => new RegExp(String.raw`href=["']${escapeRegExp(stylesheet)}\?v=[a-f0-9]{16}["']`).test(indexHtml));

if (!hasModuleScript) {
  errors.push('index.html missing a content-versioned main module script');
}
if (!hasVersionedStylesheets) {
  errors.push('index.html is missing content-versioned stylesheet links');
}

// 2. Canonical data files
const canonical = [
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

const seoAssets = ['robots.txt', 'sitemap.xml', 'og-preview.png', '_redirects'];
const renderManifestRelativePath = 'map-render-manifest.json';

for (const c of canonical) {
  if (!fs.existsSync(path.join(pagesDir, c))) {
    errors.push(`Missing canonical data: ${c}`);
  }
}
for (const asset of seoAssets) {
  if (!fs.existsSync(path.join(pagesDir, asset))) errors.push(`Missing SEO asset: ${asset}`);
}
if (!fs.existsSync(path.join(pagesDir, renderManifestRelativePath))) {
  errors.push(`Missing Canvas render manifest: ${renderManifestRelativePath}`);
}

// 3. ESM graph verification
const visited = new Set();
function checkEsmImports(fileRel) {
  if (visited.has(fileRel)) return;
  visited.add(fileRel);
  const fullPath = path.join(pagesDir, fileRel);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing ESM file: ${fileRel}`);
    return;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/from\s+['"]([^'"]+)['"]/);
    if (match) {
      const importPath = match[1].split(/[?#]/, 1)[0];
      if (importPath.startsWith('.')) {
        const resolvedRel = path.relative(pagesDir, path.resolve(path.dirname(fullPath), importPath)).replaceAll("\\", '/');
        checkEsmImports(resolvedRel);
      }
    }
  }
}
checkEsmImports('src/main.js');

// 4. Static monster poster assets
const monsterPosters = JSON.parse(fs.readFileSync(path.join(pagesDir, 'monster_posters.json'), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(pagesDir, 'data', 'game_data_metadata.json'), 'utf8'));
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(pagesDir, 'runtime-manifest.json'), 'utf8'));
if (!Array.isArray(runtimeManifest.files)) {
  errors.push('runtime-manifest.json must declare a files array');
}
if (!/^[a-f0-9]{16}$/.test(String(runtimeManifest.releaseId || ''))) {
  errors.push('runtime-manifest.json must declare a 16-character releaseId');
}
let renderManifest = null;
try {
  renderManifest = JSON.parse(fs.readFileSync(path.join(pagesDir, renderManifestRelativePath), 'utf8'));
  assertMapRenderManifestShape(renderManifest, renderManifestRelativePath);
} catch (error) {
  errors.push(`Canvas render manifest: ${error.message}`);
}
if (runtimeManifest.renderManifest !== renderManifestRelativePath) {
  errors.push(`runtime-manifest.json must point at ${renderManifestRelativePath}`);
}
const generatedFiles = Array.isArray(runtimeManifest.generatedFiles) ? runtimeManifest.generatedFiles : [];
const runtimeFiles = new Set(Array.isArray(runtimeManifest.files) ? runtimeManifest.files : []);
for (const relativePath of generatedFiles) {
  if (!runtimeFiles.has(relativePath)) errors.push(`Generated Canvas file is absent from runtime manifest: ${relativePath}`);
  if (!fs.existsSync(path.join(pagesDir, relativePath))) errors.push(`Missing generated Canvas file: ${relativePath}`);
}
if (renderManifest) {
  const generatedBytes = generatedFiles.reduce((sum, relativePath) => {
    const filePath = path.join(pagesDir, relativePath);
    return sum + (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
  }, 0);
  if (generatedBytes !== Number(renderManifest.budgets?.totalBytes)) {
    errors.push(`Canvas raster byte total mismatch: runtime ${generatedBytes}, manifest ${renderManifest.budgets?.totalBytes}`);
  }
  if (generatedBytes > Number(renderManifest.budgets?.maxTotalBytes)) {
    errors.push(`Canvas raster assets exceed the ${renderManifest.budgets?.maxTotalBytes}-byte limit`);
  }
}
const metadataPathContract = validatePublicPathReferences({
  metadata,
  publicRoot: pagesDir,
  allowedPaths: Array.isArray(runtimeManifest.files) ? runtimeManifest.files : [],
});
errors.push(...metadataPathContract.errors.map(error => `Metadata path contract: ${error}`));
let posterAssetCount = 0;
for (const [key, monster] of Object.entries(monsterPosters.monsters || {})) {
  if (typeof monster.poster === 'string') {
    posterAssetCount++;
    if (!fs.existsSync(path.join(pagesDir, monster.poster))) {
      errors.push(`Missing monster poster for ${key}: ${monster.poster}`);
    }
  }
}

console.log('=== Staging Integrity Check ===');
console.log(`- index.html has module script: ${hasModuleScript}`);
console.log(`- Canonical data files: ${canonical.length} verified`);
console.log(`- SEO assets: ${seoAssets.length} verified`);
console.log(`- Canvas render assets: ${generatedFiles.length} generated files verified`);
console.log(`- Metadata public paths: ${metadataPathContract.references.length} verified`);
console.log(`- ESM modules resolved: ${visited.size} files in graph`);
console.log(`- Monster poster assets checked: ${posterAssetCount} files`);
console.log(`- Total verification errors: ${errors.length}`);

if (errors.length > 0) {
  console.error('Errors found:\n- ' + errors.join('\n- '));
  process.exit(1);
} else {
  console.log('Staging integrity check passed with 0 errors and 0 missing files.');
}
