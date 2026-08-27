#!/usr/bin/env node
/**
 * Build the public, structured data changelog from version-pair diffs and
 * structured official WebView notices.
 *
 * The input is deliberately data-only. The renderer can therefore stay
 * stable while 1.0.4, 1.1.0, or later snapshots add more pair entries/notices.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function displayItem(item = {}) {
  const normalizedItem = typeof item === "string" ? { detail: item } : item;
  let ids = [];
  if (Array.isArray(normalizedItem.ids)) ids = normalizedItem.ids;
  else if (normalizedItem.id) ids = [normalizedItem.id];
  const entity = normalizedItem.table || normalizedItem.entity || normalizedItem.category || "資料";
  const detail = normalizedItem.summary_zh || normalizedItem.detail || normalizedItem.note || "";
  return {
    ...normalizedItem,
    entity_type: normalizedItem.category || "data",
    entity,
    id: ids.join(", "),
    detail
  };
}

function displayList(items) {
  return Array.isArray(items) ? items.map(displayItem) : [];
}

function itemIds(item = {}) {
  if (Array.isArray(item.ids)) return item.ids.map(String);
  if (item.id === undefined || item.id === null || item.id === "") return [];
  return [String(item.id)];
}

function itemEntity(item = {}) {
  return String(item.table || item.entity || item.category || "data");
}

function sameCategoryAndEntity(left = {}, right = {}) {
  return String(left.category || left.entity_type || "data") === String(right.category || right.entity_type || "data")
    && itemEntity(left) === itemEntity(right);
}

function findNoticeMatch(items, candidate) {
  const candidateIds = itemIds(candidate);
  return items.find((item) => {
    if (!sameCategoryAndEntity(item, candidate)) return false;
    const itemIdsList = itemIds(item);
    if (candidateIds.length === 0 || itemIdsList.length === 0) return candidateIds.length === itemIdsList.length;
    return candidateIds.some((id) => itemIdsList.includes(id));
  });
}

function appendUnique(list, value) {
  if (!value) return list;
  if (!list.includes(value)) list.push(value);
  return list;
}

function noticeSource(notice = {}) {
  return {
    id: notice.id || null,
    locale: notice.locale || null,
    published_at: notice.published_at || null,
    effective_at: notice.effective_at || null,
    title_zh: notice.title_zh || null
  };
}

function appendNoticeNotes(entry, notice) {
  const summary = notice.summary_zh ? `官方公告：${notice.summary_zh}` : "";
  const publishedSuffix = notice.published_at ? `（發布 ${notice.published_at}）` : "";
  const sourceNote = `官方公告來源：${notice.id}${publishedSuffix}`;
  entry.notes ||= [];
  appendUnique(entry.notes, summary);
  appendUnique(entry.notes, sourceNote);
  appendUnique(entry.notes, notice.version_basis_zh);
  for (const note of Array.isArray(notice.notes) ? notice.notes : []) appendUnique(entry.notes, note);
}

function mergeNoticeCategories(entry, notice) {
  for (const [category, values] of Object.entries(notice.categories || {})) {
    if (!Array.isArray(values) || !Array.isArray(entry.categories?.[category])) continue;
    for (const value of values) {
      const normalized = displayItem({ ...value, source_notice_id: notice.id, evidence: "official_notice" });
      const match = findNoticeMatch(entry.categories[category], normalized);
      if (!match) {
        normalized.official_notice_ids = [notice.id];
        entry.categories[category].push(normalized);
        continue;
      }
      match.official_notice_ids = Array.from(new Set([...(match.official_notice_ids || []), notice.id]));
      match.official_summaries_zh ||= [];
      appendUnique(match.official_summaries_zh, normalized.detail);
    }
  }
}

function mergeOfficialNotice(entry, notice) {
  if (!entry || !notice?.id) return;
  entry.official_notices ||= [];
  const source = noticeSource(notice);
  if (!entry.official_notices.some((item) => item.id === source.id)) entry.official_notices.push(source);
  if (!entry.date && notice.effective_at) entry.date = notice.effective_at;
  appendNoticeNotes(entry, notice);
  mergeNoticeCategories(entry, notice);
}

function createNoticeEntry(notice) {
  return {
    version: notice.version,
    from_version: notice.from_version || null,
    date: notice.effective_at || null,
    categories: {
      added: [],
      modified: [],
      removed: [],
      schema_changes: [],
      important_values: []
    },
    notes: []
  };
}

export function buildChangelog(diffDocument) {
  const pairs = Array.isArray(diffDocument?.pairs) ? diffDocument.pairs : [];
  const entries = [];

  if (pairs.length > 0) {
    const firstVersion = pairs[0].from_version;
    entries.push({
      version: firstVersion,
      from_version: null,
      date: null,
      categories: {
        added: [],
        modified: [],
        removed: [],
        schema_changes: [],
        important_values: []
      },
      notes: ["此版本是版本差異基準；日期未由來源確認。"]
    });
  }

  for (const pair of pairs) {
    entries.push({
      version: pair.to_version,
      from_version: pair.from_version,
      date: pair.date ?? null,
      topology: pair.topology || null,
      categories: {
        added: displayList(pair.added),
        modified: displayList(pair.modified),
        removed: displayList(pair.removed),
        schema_changes: displayList(pair.schema_changes),
        important_values: displayList(pair.important_values)
      },
      notes: [pair.notes_zh, diffDocument.evidence_boundary_zh].filter(Boolean)
    });
  }

  for (const notice of Array.isArray(diffDocument?.official_notices) ? diffDocument.official_notices : []) {
    let entry = entries.find((candidate) => candidate.version === notice.version);
    if (!entry) {
      entry = createNoticeEntry(notice);
      entries.push(entry);
    }
    mergeOfficialNotice(entry, notice);
  }

  return {
    schema_version: 1,
    generated_by: "scripts/generate_changelog.mjs",
    official_notices_source: diffDocument?.official_notices_source || null,
    canonical_version: pairs.at(-1)?.to_version || null,
    entries
  };
}

if (process.argv[1]?.endsWith("generate_changelog.mjs")) {
  const explicitInput = readArg("--input", null);
  const noticesInput = path.resolve(rootDir, readArg("--notices", "data/official_update_notices.json"));
  const inputPaths = explicitInput
    ? explicitInput.split(/[;,]/).map((input) => path.resolve(rootDir, input.trim())).filter(Boolean)
    : fs.readdirSync(path.join(rootDir, "data"))
      .filter((name) => /^version_diff_.+\.json$/i.test(name))
      .sort((leftItem, rightItem) => leftItem.localeCompare(rightItem))
      .map((name) => path.join(rootDir, "data", name));
  if (inputPaths.length === 0) {
    throw new Error("No version_diff_*.json input documents found; pass --input <path>[,<path>].");
  }
  const output = path.resolve(rootDir, readArg("--output", "site/data/changelog.json"));
  const documents = inputPaths.map((input) => JSON.parse(fs.readFileSync(input, "utf8")));
  const seenPairs = new Set();
  const pairs = documents.flatMap((document) => document.pairs || []).filter((pair) => {
    const key = `${pair.from_version || ""}->${pair.to_version || ""}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });
  const evidence = [...new Set(documents.map((document) => document.evidence_boundary_zh).filter(Boolean))].join(" ");
  const noticeDocument = fs.existsSync(noticesInput)
    ? JSON.parse(fs.readFileSync(noticesInput, "utf8"))
    : { notices: [] };
  const diffDocument = {
    evidence_boundary_zh: evidence,
    official_notices_source: path.relative(rootDir, noticesInput).replaceAll("\\", "/"),
    official_notices: Array.isArray(noticeDocument.notices) ? noticeDocument.notices : [],
    pairs
  };
  const changelog = buildChangelog(diffDocument);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(changelog, null, 2)}\n`, "utf8");
  console.log(`Generated ${changelog.entries.length} changelog entries for ${changelog.canonical_version}.`);
}
