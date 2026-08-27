import fs from 'node:fs';
import path from 'node:path';

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function collectFiles(rootDir, prefix = '') {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(path.join(rootDir, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(rootDir, relativePath));
    else files.push(relativePath.replaceAll("\\", '/'));
  }
  return files;
}

function compareFileTrees(sourceRoot, runtimeRoot, relativeFiles, mismatches) {
  const sourceFiles = new Set(relativeFiles);
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const runtimePath = path.join(runtimeRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
      mismatches.push(`${relativePath} (missing from canonical source)`);
      continue;
    }
    if (!fs.existsSync(runtimePath)) {
      mismatches.push(`${relativePath} (missing from runtime)`);
      continue;
    }
    if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(runtimePath))) {
      mismatches.push(`${relativePath} (content differs)`);
    }
  }
}

/**
 * Return canonical source/runtime mismatches before a browser suite starts.
 * The Pages build copies both ESM modules and the allowlisted static runtime;
 * checking only src/ can otherwise exercise stale HTML, CSS, or data.
 */
export function findRuntimeFreshnessMismatches({ rootDir, runtimeDir }) {
  const mismatches = [];
  const sourceDir = path.join(rootDir, 'src');
  const runtimeSourceDir = path.join(runtimeDir, 'src');
  const sourceFiles = collectFiles(sourceDir);
  const runtimeFiles = collectFiles(runtimeSourceDir);
  const sourceFileSet = new Set(sourceFiles);

  compareFileTrees(sourceDir, runtimeSourceDir, sourceFiles, mismatches);
  for (const relativePath of runtimeFiles) {
    if (!sourceFileSet.has(relativePath)) mismatches.push(`${relativePath} (extra in runtime)`);
  }

  const canonicalSiteDir = path.resolve(path.join(rootDir, 'site'));
  const resolvedRuntimeDir = path.resolve(runtimeDir);
  if (resolvedRuntimeDir === canonicalSiteDir) return mismatches;

  const allowlistPath = path.join(canonicalSiteDir, 'runtime-allowlist.json');
  if (!fs.existsSync(allowlistPath)) {
    mismatches.push('site/runtime-allowlist.json (missing from canonical source)');
    return mismatches;
  }

  let allowlist;
  try {
    allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  } catch (error) {
    mismatches.push(`site/runtime-allowlist.json (invalid JSON: ${error.message})`);
    return mismatches;
  }

  const runtimeFilesFromAllowlist = [...new Set([
    ...(allowlist.staticFiles || []),
    ...(allowlist.assetFiles || []),
    ...(allowlist.iconFiles || []),
  ])].sort(compareText);
  const expectedRuntimeFiles = new Set([
    ...runtimeFilesFromAllowlist,
    ...sourceFiles.map(relativePath => `src/${relativePath}`),
    'runtime-manifest.json',
  ]);
  // A fresh artifact must contain exactly the reviewed allowlist, mirrored
  // source modules, and its generated manifest; overlay leftovers are release
  // inputs too and must fail the browser gate instead of being served.
  for (const relativePath of collectFiles(resolvedRuntimeDir)) {
    if (!expectedRuntimeFiles.has(relativePath)) {
      mismatches.push(`${relativePath} (unexpected runtime file)`);
    }
  }
  // `site/src` is an ignored build output and is absent from a clean checkout.
  // The source/module comparison above already verifies those files against
  // the tracked `src/` tree, so the site comparison covers static files only.
  const canonicalStaticFiles = runtimeFilesFromAllowlist.filter((relativePath) => !relativePath.startsWith('src/'));
  compareFileTrees(canonicalSiteDir, resolvedRuntimeDir, canonicalStaticFiles, mismatches);

  const manifestPath = path.join(resolvedRuntimeDir, 'runtime-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    mismatches.push('runtime-manifest.json (missing from runtime)');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifestFiles = [...new Set(manifest.files || [])].sort(compareText);
      if (JSON.stringify(manifestFiles) !== JSON.stringify(runtimeFilesFromAllowlist)) {
        mismatches.push('runtime-manifest.json (file list differs from canonical allowlist)');
      }
    } catch (error) {
      mismatches.push(`runtime-manifest.json (invalid JSON: ${error.message})`);
    }
  }

  return mismatches;
}

export function assertRuntimeFreshness({ rootDir, runtimeDir }) {
  const mismatches = findRuntimeFreshnessMismatches({ rootDir, runtimeDir });
  if (mismatches.length > 0) {
    const mismatchSuffix = mismatches.length > 8 ? ` (+${mismatches.length - 8} more)` : "";
    throw new Error(`[RUNTIME SYNC] E2E runtime is stale: ${mismatches.slice(0, 8).join(', ')}${mismatchSuffix}. Run npm run build:pages before retrying.`);
  }
}
