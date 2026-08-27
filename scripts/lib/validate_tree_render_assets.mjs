import fs from "node:fs";
import path from "node:path";
import { decodeRgba8 } from "./png_rgba.mjs";

function normalizePath(value) {
  return value.replaceAll("/", path.sep);
}

function exactSetDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort((leftItem, rightItem) => leftItem.localeCompare(rightItem));
}

function ruleDeclarations(cssText, selectorPattern) {
  return cssText.match(new RegExp(String.raw`${selectorPattern}\s*\{([^}]*)\}`))?.[1] ?? "";
}

function collectReferencedSymbolIds(svgText, errors) {
  const referencedSymbolIds = new Set();
  for (const match of svgText.matchAll(/<use class="node-icon"([^>]+)>/g)) {
    const symbolId = match[1].match(/\shref="#([^"]+)"/)?.[1];
    if (!symbolId) errors.push(`node-icon use is missing a local symbol href: ${match[0]}`);
    else referencedSymbolIds.add(symbolId);
  }
  return referencedSymbolIds;
}

function validateSymbolManifest(symbols, referencedSymbolIds, errors) {
  const manifestSymbolIds = new Set(Object.keys(symbols));
  for (const symbolId of exactSetDifference(referencedSymbolIds, manifestSymbolIds)) {
    errors.push(`tree shadow source manifest is missing ${symbolId}`);
  }
  for (const symbolId of exactSetDifference(manifestSymbolIds, referencedSymbolIds)) {
    errors.push(`tree shadow source manifest contains unused ${symbolId}`);
  }
}

function validateSourceRecord(rootDir, symbolId, source, errors) {
  if (
    !source ||
    !/^(?:site\/icons|assets\/tree-icon-sources)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(source.path) ||
    !["meet", "none"].includes(source.fit)
  ) {
    errors.push(`${symbolId} has an invalid source record`);
    return;
  }
  if (!fs.existsSync(path.join(rootDir, normalizePath(source.path)))) {
    errors.push(`${symbolId} source is missing: ${source.path}`);
  }
}

function validateReferencedSymbol(siteDir, symbols, symbolId, body, bakedFiles, errors) {
  const imageTag = body.match(/<image\b[^>]*\/>/)?.[0];
  const bakedPath = imageTag?.match(/\shref="(icons\/TreeShadow_[A-Za-z0-9_.-]+\.png)"/)?.[1];
  const xlinkPath = imageTag?.match(/\sxlink:href="(icons\/TreeShadow_[A-Za-z0-9_.-]+\.png)"/)?.[1];
  if (!bakedPath || xlinkPath !== bakedPath) {
    errors.push(`${symbolId} must reference one matching baked TreeShadow PNG`);
    return;
  }
  bakedFiles.add(bakedPath);
  if (!fs.existsSync(path.join(siteDir, normalizePath(bakedPath)))) {
    errors.push(`${symbolId} references missing ${bakedPath}`);
  }
  validateSourceRecord(path.dirname(siteDir), symbolId, symbols[symbolId], errors);
}

function collectBakedFiles(svgText, siteDir, symbols, referencedSymbolIds, errors) {
  const bakedFiles = new Set();
  for (const match of svgText.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)) {
    const [, symbolId, body] = match;
    if (referencedSymbolIds.has(symbolId)) {
      validateReferencedSymbol(siteDir, symbols, symbolId, body, bakedFiles, errors);
    }
  }
  return bakedFiles;
}

function validateBakedFileInventory(siteDir, bakedFiles, errors) {
  const onDiskBakedFiles = new Set(
    fs.readdirSync(path.join(siteDir, "icons"))
      .filter((name) => /^TreeShadow_[A-Za-z0-9_.-]+\.png$/.test(name))
      .map((name) => `icons/${name}`),
  );
  for (const bakedPath of exactSetDifference(bakedFiles, onDiskBakedFiles)) {
    errors.push(`baked tree icon is missing: ${bakedPath}`);
  }
  for (const bakedPath of exactSetDifference(onDiskBakedFiles, bakedFiles)) {
    errors.push(`baked tree icon is unused: ${bakedPath}`);
  }
}

function validateRuntimeFilters(svgText, stylesText, errors) {
  if (/data-shadow-source|id="node-icon-shadow"/.test(svgText)) {
    errors.push("public tree SVG exposes source metadata or the retired node-icon filter");
  }
  const hasFilter = [
    ruleDeclarations(svgText, String.raw`\.node-icon`),
    ruleDeclarations(svgText, String.raw`\.dice-shadow`),
    ruleDeclarations(stylesText, String.raw`\.map-scene \.dice-shadow`)
  ].some((declarations) => /\bfilter\s*:/.test(declarations));
  if (hasFilter) errors.push("tree node icons and dice shadows must remain filter-free at runtime");
}

function validateDiceShadow(siteDir, errors) {
  const diceShadowPath = path.join(siteDir, "icons", "TreeDiceShadow.png");
  try {
    const diceShadow = decodeRgba8(fs.readFileSync(diceShadowPath), "site/icons/TreeDiceShadow.png");
    if (diceShadow.width !== 262 || diceShadow.height !== 252) {
      errors.push(`TreeDiceShadow.png must remain 262x252; received ${diceShadow.width}x${diceShadow.height}`);
    }
    let visiblePixels = 0;
    let transparentPixels = 0;
    for (let offset = 0; offset < diceShadow.pixels.length; offset += 4) {
      if (diceShadow.pixels[offset] !== 0 || diceShadow.pixels[offset + 1] !== 0 || diceShadow.pixels[offset + 2] !== 0) {
        errors.push("TreeDiceShadow.png contains a non-black RGB pixel");
        break;
      }
      if (diceShadow.pixels[offset + 3] === 0) transparentPixels += 1;
      else visiblePixels += 1;
    }
    if (visiblePixels === 0 || transparentPixels === 0) errors.push("TreeDiceShadow.png must retain both visible and transparent pixels");
  } catch (error) {
    errors.push(error.message);
  }
}

function validateDiceShadowSymbol(svgText, errors) {
  if (!/<symbol id="sprite-189"[^>]*><image\b[^>]*href="icons\/TreeDiceShadow\.png"/.test(svgText)) {
    errors.push("dice shadow symbol must reference icons/TreeDiceShadow.png");
  }
}

export function validateTreeRenderAssets(rootDir, svgText) {
  const errors = [];
  const siteDir = path.join(rootDir, "site");
  const stylesText = fs.readFileSync(path.join(siteDir, "styles.css"), "utf8");
  const manifestPath = path.join(rootDir, "data", "tree-icon-shadow-sources.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const symbols = manifest?.symbols;
  if (manifest?.schemaVersion !== 1 || !symbols || Array.isArray(symbols) || typeof symbols !== "object") {
    return ["data/tree-icon-shadow-sources.json must contain schemaVersion 1 and a symbols object"];
  }
  const referencedSymbolIds = collectReferencedSymbolIds(svgText, errors);
  validateSymbolManifest(symbols, referencedSymbolIds, errors);
  const bakedFiles = collectBakedFiles(svgText, siteDir, symbols, referencedSymbolIds, errors);
  validateBakedFileInventory(siteDir, bakedFiles, errors);
  validateRuntimeFilters(svgText, stylesText, errors);
  validateDiceShadow(siteDir, errors);
  validateDiceShadowSymbol(svgText, errors);
  return errors;
}
