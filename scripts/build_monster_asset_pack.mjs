import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(repoDir, 'site');
const demoSource = path.join(repoDir, 'scripts', 'monster_asset_demo', 'index.html');
const defaultOutput = path.resolve(repoDir, '..', 'rd2-lab-monster-assets.zip');

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

const outputPath = path.resolve(optionValue('--out') || defaultOutput);
const relativeOutput = path.relative(repoDir, outputPath);
if (relativeOutput && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)) {
  throw new Error(`Refusing to write the ZIP inside the repository: ${outputPath}`);
}
if (path.extname(outputPath).toLowerCase() !== '.zip') {
  throw new Error(`Output path must end in .zip: ${outputPath}`);
}

const sourceManifest = JSON.parse(fs.readFileSync(path.join(siteDir, 'monster_visuals.json'), 'utf8'));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd2-lab-monster-assets-'));
const packageDir = path.join(workDir, 'rd2-lab-monster-assets');

function safeRelative(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe asset path: ${relativePath}`);
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) throw new Error(`Unsafe asset path: ${relativePath}`);
  return normalized;
}

function copyAsset(relativeSource, relativeDestination) {
  const sourceName = safeRelative(relativeSource);
  const destinationName = safeRelative(relativeDestination);
  const source = path.resolve(siteDir, sourceName);
  const destination = path.resolve(packageDir, destinationName);
  if (!source.startsWith(`${path.resolve(siteDir)}${path.sep}`)) throw new Error(`Asset escaped site root: ${relativeSource}`);
  if (!destination.startsWith(`${path.resolve(packageDir)}${path.sep}`)) throw new Error(`Asset escaped package root: ${relativeDestination}`);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Missing asset: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeManifest(manifest) {
  const target = path.join(packageDir, 'manifest.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function copyFile(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Missing package file: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function dataUri(source, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(source).toString('base64')}`;
}

function getAssetMimeType(assetType) {
  if (assetType === 'skeleton') return 'application/octet-stream';
  if (assetType === 'atlas') return 'text/plain';
  return 'image/png';
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createArchive(sourceDirectory, destination) {
  if (process.platform === 'win32') {
    const powershellExecutable = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    if (!fs.existsSync(powershellExecutable)) {
      throw new Error(`System PowerShell was not found: ${powershellExecutable}`);
    }
    const powershell = [
      '$ErrorActionPreference = "Stop"',
      `Compress-Archive -LiteralPath ${quotePowerShell(sourceDirectory)} -DestinationPath ${quotePowerShell(destination)} -CompressionLevel Optimal -Force`,
    ].join('; ');
    return spawnSync(powershellExecutable, ['-NoProfile', '-NonInteractive', '-Command', powershell], {
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  const zipExecutable = '/usr/bin/zip';
  if (!fs.existsSync(zipExecutable)) {
    throw new Error(`System zip was not found: ${zipExecutable}`);
  }
  return spawnSync(zipExecutable, ['-qr', destination, path.basename(sourceDirectory)], {
    cwd: path.dirname(sourceDirectory),
    encoding: 'utf8',
  });
}

try {
  fs.mkdirSync(packageDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    assetType: 'spine-monster-library',
    snapshot: sourceManifest.snapshot,
    monsters: {},
  };
  const embeddedFiles = {};

  for (const [monsterId, definition] of Object.entries(sourceManifest.monsters || {})) {
    const sourceSpine = definition.spine;
    if (!sourceSpine) throw new Error(`Missing Spine definition for ${monsterId}`);
    const targetSpine = {};
    for (const key of ['skeleton', 'atlas', 'texture']) {
      const sourcePath = safeRelative(sourceSpine[key]);
      const targetPath = `spine/${path.basename(sourcePath)}`;
      copyAsset(sourcePath, targetPath);
      targetSpine[key] = targetPath.replaceAll(path.sep, '/');
      if (!embeddedFiles[targetSpine[key]]) {
        const mimeType = getAssetMimeType(key);
        embeddedFiles[targetSpine[key]] = dataUri(path.resolve(siteDir, sourcePath), mimeType);
      }
    }
    targetSpine.animation = sourceSpine.animation || null;
    manifest.monsters[monsterId] = { spine: targetSpine };
  }

  writeManifest(manifest);
  const demoTemplate = fs.readFileSync(demoSource, 'utf8');
  const runtimeTag = '<script src="vendor/spine-webgl.min.js"></script>';
  if (!demoTemplate.includes(runtimeTag)) throw new Error('Demo template is missing the runtime script tag.');
  const embeddedScript = `<script>window.__MONSTER_ASSET_PACK__ = ${JSON.stringify({ manifest, files: embeddedFiles })};</script>`;
  const demoHtml = demoTemplate.replace(runtimeTag, `${embeddedScript}\n  ${runtimeTag}`);
  copyFile(path.join(siteDir, 'vendor', 'spine-webgl.min.js'), path.join(packageDir, 'demo', 'vendor', 'spine-webgl.min.js'));
  const demoDestination = path.join(packageDir, 'demo', 'index.html');
  fs.mkdirSync(path.dirname(demoDestination), { recursive: true });
  fs.writeFileSync(demoDestination, demoHtml, 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const result = createArchive(packageDir, outputPath);
  if (result.status !== 0) {
    throw new Error(`Archive creation failed (${result.status}): ${result.stderr || result.stdout || 'zip command unavailable'}`);
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(packageDir);
  const bytes = files.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
  console.log(`Monster asset library created: ${outputPath}`);
  console.log(`Files: ${files.length}; uncompressed: ${bytes} bytes; ZIP: ${fs.statSync(outputPath).size} bytes.`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
