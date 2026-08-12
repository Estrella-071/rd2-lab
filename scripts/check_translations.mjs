import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const catalogPath = path.join(rootDir, "site", "data", "locales.json");
const indexPath = path.join(rootDir, "site", "index.html");
const treePath = path.join(rootDir, "site", "data", "dice_tree.json");
const expectedLocales = ["zh-tw", "en", "ja", "ko"];
const errors = [];
const compareStrings = (left, right) => {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
};

function countDelimitedMarkers(input, marker, closing) {
  let count = 0;
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf(closing ? `</${marker}` : `<${marker}`, cursor);
    if (start < 0) break;
    const boundaryIndex = start + (closing ? marker.length + 2 : marker.length + 1);
    const boundary = input[boundaryIndex];
    const validBoundary = closing
      ? boundary === undefined || boundary === ">" || /\s/.test(boundary)
      : boundary === undefined || boundary === ">" || boundary === "=" || /\s/.test(boundary);
    if (validBoundary) count += 1;
    cursor = boundaryIndex;
  }
  return count;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(rootDir, file)} is not valid JSON: ${error.message}`);
    return {};
  }
}

function entryValue(entry, locale) {
  return isRecord(entry) ? String(entry[locale] ?? "").trim() : String(entry ?? "").trim();
}

function tokens(value) {
  const input = String(value ?? "");
  const placeholders = [];
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf("{", cursor);
    if (start < 0) break;
    const close = input.indexOf("}", start + 1);
    if (close < 0) break;
    const token = input.slice(start + 1, close);
    if (token && !token.includes("{")) {
      placeholders.push(input.slice(start, close + 1));
      cursor = close + 1;
    } else {
      cursor = start + 1;
    }
  }
  placeholders.sort(compareStrings);
  return { placeholders };
}

function hasBalancedMarkers(value) {
  const input = String(value ?? "");
  for (const marker of ["tag", "color"]) {
    const open = countDelimitedMarkers(input, marker, false);
    const close = countDelimitedMarkers(input, marker, true);
    if (open !== close) return false;
  }
  return true;
}

function extractTranslationKeyRefs(html) {
  const keys = new Map();
  const record = (key, source) => {
    const value = String(key || "").trim();
    if (value) keys.set(value, source);
  };
  for (const match of html.matchAll(/\bdata-i18n(?:-html|-placeholder)?="([^"]+)"/g)) {
    record(match[1], "data-i18n");
  }
  for (const match of html.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
    for (const declaration of String(match[1]).split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 1) continue;
      record(declaration.slice(separator + 1), "data-i18n-attr");
    }
  }
  return keys;
}

function stripXmlText(value) {
  return String(value || "")
    .replaceAll(/<[^<>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function checkSvgText(svgPath) {
  if (!fs.existsSync(svgPath)) {
    errors.push("site/data/dice_tree.svg is missing");
    return;
  }
  const svg = fs.readFileSync(svgPath, "utf8");
  const requiredMarkers = [
    ".tree-center-stat-name",
    ".tree-center-stat-value",
    ".compendium-core-compact-title.normal-title",
    ".compendium-core-compact-title.simulation-title"
  ];
  for (const marker of requiredMarkers) {
    const classes = marker.split(".").filter(Boolean);
    const present = classes.every((className) => svg.includes(className));
    if (!present) errors.push(`site/data/dice_tree.svg is missing localization marker ${marker}`);
  }
  const allowedStaticText = new Set(["自然", "工學", "魔法", "秩序", "渾沌", "圖鑑", "骰子樹"]);
  const texts = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => stripXmlText(match[1]))
    .filter(Boolean);
  const unexpected = [...new Set(texts.filter((value) => /\p{Script=Han}/u.test(value) && !allowedStaticText.has(value)))];
  if (unexpected.length > 0) {
    errors.push(`site/data/dice_tree.svg contains unexpected non-localized text: ${unexpected.join(", ")}`);
  }
}

function checkFieldCoverage(kind, id, mapping, field, source) {
  const key = mapping?.[field];
  if (!key) return;
  const entry = source[key] || catalog.ui?.[key];
  if (!entry) return;
  for (const locale of expectedLocales) {
    if (!entryValue(entry, locale)) errors.push(`content.${kind}.${id}.${field} key ${key} is empty in ${locale}`);
  }
}

function checkSpecialStatCoverage(kind, id, mapping, source) {
  if (!Array.isArray(mapping?.specialStats)) return;
  mapping.specialStats.forEach((key, index) => {
    const entry = source[key] || catalog.ui?.[key];
    if (!entry) return;
    for (const locale of expectedLocales) {
      if (!entryValue(entry, locale)) errors.push(`content.${kind}.${id}.specialStats[${index}] key ${key} is empty in ${locale}`);
    }
  });
}

function checkContentCoverage(kind, entries, requiredFields, source) {
  for (const [id, mapping] of Object.entries(entries || {})) {
    for (const field of requiredFields) checkFieldCoverage(kind, id, mapping, field, source);
    checkSpecialStatCoverage(kind, id, mapping, source);
  }
}

function checkEntry(section, key, entry) {
  if (!isRecord(entry)) {
    errors.push(`${section}.${key} must be a locale object`);
    return;
  }
  for (const locale of expectedLocales) {
    if (!entryValue(entry, locale)) errors.push(`${section}.${key} is missing ${locale}`);
    if (!hasBalancedMarkers(entryValue(entry, locale))) errors.push(`${section}.${key} has unbalanced format markers in ${locale}`);
  }
  const base = tokens(entryValue(entry, "zh-tw"));
  for (const locale of expectedLocales.slice(1)) {
    const candidate = tokens(entryValue(entry, locale));
    if (JSON.stringify(candidate.placeholders) !== JSON.stringify(base.placeholders)) {
      errors.push(`${section}.${key} has mismatched placeholders in ${locale}`);
    }
  }
}

const catalog = readJson(catalogPath);
const treeData = readJson(treePath);
if (JSON.stringify(catalog.locales || []) !== JSON.stringify(expectedLocales)) {
  errors.push(`catalog locales must be exactly ${expectedLocales.join(", ")}`);
}
if (catalog.default_locale !== "zh-tw") errors.push("catalog default_locale must be zh-tw");

for (const [key, entry] of Object.entries(catalog.ui || {})) checkEntry("ui", key, entry);
for (const [key, entry] of Object.entries(catalog.source || {})) checkEntry("source", key, entry);

const localeCoverage = Object.fromEntries(expectedLocales.map((locale) => {
  const entries = [
    ...Object.values(catalog.ui || {}),
    ...Object.values(catalog.source || {})
  ];
  const total = entries.length;
  const complete = entries.filter((entry) => entryValue(entry, locale)).length;
  if (complete !== total) errors.push(`locale ${locale} coverage is ${complete}/${total}; every catalog entry must have a value`);
  const percent = total === 0 ? 100 : (complete / total) * 100;
  return [locale, { complete, total, percent }];
}));

const sourceKeys = new Set(Object.keys(catalog.source || {}));
const sourceFormatPatches = Array.isArray(catalog.source_format_patches) ? catalog.source_format_patches : null;
if (!sourceFormatPatches) {
  errors.push("catalog source_format_patches must be an array generated from source-format corrections");
} else {
  const uniqueFormatPatches = new Set(sourceFormatPatches);
  if (uniqueFormatPatches.size !== sourceFormatPatches.length) {
    errors.push("catalog source_format_patches must not contain duplicate keys");
  }
  for (const key of sourceFormatPatches) {
    if (typeof key !== "string" || !sourceKeys.has(key)) {
      errors.push(`catalog source_format_patches references unknown source key ${key}`);
    }
  }
}
const checkMapping = (kind, entries, requiredFields) => {
  for (const [id, mapping] of Object.entries(entries || {})) {
    if (!isRecord(mapping)) {
      errors.push(`content.${kind}.${id} must be an object`);
      continue;
    }
    for (const field of requiredFields) {
      const key = mapping[field];
      if (!key) {
        errors.push(`content.${kind}.${id} is missing ${field}`);
      } else if (!sourceKeys.has(key) && !Object.hasOwn(catalog.ui || {}, key)) {
        errors.push(`content.${kind}.${id}.${field} references unknown key ${key}`);
      }
    }
    if (Array.isArray(mapping.specialStats)) {
      mapping.specialStats.forEach((key, index) => {
        if (!sourceKeys.has(key) && !Object.hasOwn(catalog.ui || {}, key)) {
          errors.push(`content.${kind}.${id}.specialStats[${index}] references unknown key ${key}`);
        }
      });
    }
  }
};
checkMapping("nodes", catalog.content?.nodes, ["name", "description", "nodeType", "branch", "unlockCondition"]);
checkMapping("events", catalog.content?.events, ["name", "description"]);
checkMapping("monsters", catalog.content?.monsters, ["name", "description", "subType"]);
for (const [id, mapping] of Object.entries(catalog.content?.tags || {})) {
  checkMapping("tags", { [id]: mapping }, ["name", "description"]);
}
for (const [id, key] of Object.entries(catalog.content?.factions || {})) {
  if (!sourceKeys.has(key) && !Object.hasOwn(catalog.ui || {}, key)) errors.push(`content.factions.${id} references unknown key ${key}`);
}

for (const node of Array.isArray(treeData.nodes) ? treeData.nodes : []) {
  const id = String(node?.id ?? "");
  const mapping = catalog.content?.nodes?.[id];
  if (!mapping) continue;
  const generatedUnlockKey = String(node?.unlock_condition_key || "").trim();
  if (generatedUnlockKey) {
    if (mapping.unlockCondition !== generatedUnlockKey) {
      errors.push(`content.nodes.${id}.unlockCondition must reference generated key ${generatedUnlockKey}`);
    }
    if (String(mapping.unlockConditionValue ?? "") !== String(node?.unlock_condition_value ?? "").trim()) {
      errors.push(`content.nodes.${id}.unlockConditionValue must match generated canonical value`);
    }
  }
  const condition = String(node?.unlock_condition ?? node?.special_unlock ?? node?.unlock_condition_special ?? "").trim();
  const canonicalLabel = String(node?._canonical_unlock_condition_zh ?? node?.unlock_condition_zh ?? "").trim();
  const ordinaryPrerequisite = (!condition && (!canonicalLabel || canonicalLabel === "前置節點")) || canonicalLabel === "前置節點";
  if (!ordinaryPrerequisite && mapping.unlockCondition === "unlock.prerequisite") {
    errors.push(`content.nodes.${id} keeps unlock.prerequisite for a special unlock condition`);
  }
}

const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
const htmlKeyRefs = extractTranslationKeyRefs(html);
for (const [key, source] of htmlKeyRefs) {
  if (!Object.hasOwn(catalog.ui || {}, key) && !sourceKeys.has(key)) {
    errors.push(`site/index.html ${source} references unknown translation key ${key}`);
  }
}

const changelogIndex = html.indexOf('id="changelog-widget"');
const localeIndex = html.indexOf('id="locale-widget"');
if (changelogIndex < 0 || localeIndex < 0 || localeIndex <= changelogIndex) {
  errors.push("locale widget must be present after the changelog widget");
}

checkContentCoverage("nodes", catalog.content?.nodes, ["name", "description", "fullName", "awakening", "target", "nodeType", "branch", "unlockCondition"], catalog.source || {});
checkContentCoverage("events", catalog.content?.events, ["name", "description", "phase"], catalog.source || {});
checkContentCoverage("monsters", catalog.content?.monsters, ["name", "description", "subType"], catalog.source || {});
checkContentCoverage("tags", catalog.content?.tags, ["name", "description"], catalog.source || {});
checkSvgText(path.join(rootDir, "site", "data", "dice_tree.svg"));

const requiredSource = Array.isArray(catalog.required_source_keys) ? catalog.required_source_keys : [];
const sourceInventory = catalog.source_inventory || {};
const incompleteSourceKeys = new Set(Array.isArray(sourceInventory.incomplete_keys) ? sourceInventory.incomplete_keys : []);
const inventoryTotal = Number(sourceInventory.total);
const inventoryComplete = Number(sourceInventory.complete);
const inventoryIncomplete = Number(sourceInventory.incomplete);
if (!Number.isInteger(inventoryTotal) || !Number.isInteger(inventoryComplete) || !Number.isInteger(inventoryIncomplete)
  || inventoryComplete + inventoryIncomplete !== inventoryTotal
  || incompleteSourceKeys.size !== inventoryIncomplete) {
  errors.push("source_inventory counts and incomplete_keys are inconsistent");
}
for (const key of requiredSource) {
  if (!sourceKeys.has(key)) errors.push(`required runtime source key ${key} is missing from catalog`);
  if (incompleteSourceKeys.has(key)) errors.push(`required runtime source key ${key} is marked incomplete in source inventory`);
}

const nodeCount = Object.keys(catalog.content?.nodes || {}).length;
const tagCount = Object.keys(catalog.content?.tags || {}).length;
const eventCount = Object.keys(catalog.content?.events || {}).length;
const monsterCount = Object.keys(catalog.content?.monsters || {}).length;
if (errors.length > 0) {
  console.error(`Translation checks failed (${errors.length} issue(s)):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Translation checks passed: ${Object.keys(catalog.ui || {}).length} UI keys, ${requiredSource.length} runtime source keys, ${sourceKeys.size} catalog source keys.`);
const localeCoverageSummary = expectedLocales
  .map((locale) => `${locale} ${localeCoverage[locale].complete}/${localeCoverage[locale].total} (${localeCoverage[locale].percent.toFixed(1)}%)`)
  .join(", ");
console.log(`Locale coverage: ${localeCoverageSummary}.`);
console.log(`Localized entities: ${nodeCount} nodes, ${tagCount} tags, ${eventCount} events, ${monsterCount} monsters.`);
console.log(`Source inventory: ${sourceInventory.complete ?? "?"}/${sourceInventory.total ?? "?"} complete; ${sourceInventory.incomplete ?? "?"} rows require source follow-up and are outside the runtime entity set.`);
