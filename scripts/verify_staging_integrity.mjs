import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicPathReferences } from './public_path_contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..');
const pagesDir = path.join(websiteDir, '.pages');

const errors = [];

// 1. Check index.html script tag
const indexHtml = fs.readFileSync(path.join(pagesDir, 'index.html'), 'utf8');
const hasModuleScript = indexHtml.includes('<script type="module" src="src/main.js"></script>');

if (!hasModuleScript) {
  errors.push('index.html missing <script type="module" src="src/main.js"></script>');
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
  'monster_visuals.json',
];

for (const c of canonical) {
  if (!fs.existsSync(path.join(pagesDir, c))) {
    errors.push(`Missing canonical data: ${c}`);
  }
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
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const resolvedRel = path.relative(pagesDir, path.resolve(path.dirname(fullPath), importPath)).replaceAll("\\", '/');
        checkEsmImports(resolvedRel);
      }
    }
  }
}
checkEsmImports('src/main.js');

// 4. Spine assets
const monsterVisuals = JSON.parse(fs.readFileSync(path.join(pagesDir, 'monster_visuals.json'), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(pagesDir, 'data', 'game_data_metadata.json'), 'utf8'));
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(pagesDir, 'runtime-manifest.json'), 'utf8'));
if (!Array.isArray(runtimeManifest.files)) {
  errors.push('runtime-manifest.json must declare a files array');
}
const metadataPathContract = validatePublicPathReferences({
  metadata,
  publicRoot: pagesDir,
  allowedPaths: Array.isArray(runtimeManifest.files) ? runtimeManifest.files : [],
});
errors.push(...metadataPathContract.errors.map(error => `Metadata path contract: ${error}`));
let spineAssetCount = 0;
for (const [key, monster] of Object.entries(monsterVisuals.monsters || {})) {
  if (monster.spine) {
    for (const relPath of Object.values(monster.spine)) {
      if (typeof relPath === 'string' && (relPath.endsWith('.skel') || relPath.endsWith('.atlas') || relPath.endsWith('.png'))) {
        spineAssetCount++;
        if (!fs.existsSync(path.join(pagesDir, relPath))) {
          errors.push(`Missing Spine asset for ${key}: ${relPath}`);
        }
      }
    }
  }
}

console.log('=== Staging Integrity Check ===');
console.log(`- index.html has module script: ${hasModuleScript}`);
console.log(`- Canonical data files: ${canonical.length} verified`);
console.log(`- Metadata public paths: ${metadataPathContract.references.length} verified`);
console.log(`- ESM modules resolved: ${visited.size} files in graph`);
console.log(`- Spine assets checked: ${spineAssetCount} files`);
console.log(`- Total verification errors: ${errors.length}`);

if (errors.length > 0) {
  console.error('Errors found:\n- ' + errors.join('\n- '));
  process.exit(1);
} else {
  console.log('Staging integrity check passed with 0 errors and 0 missing files.');
}
