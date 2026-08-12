#!/usr/bin/env node
/**
 * Stable-ID game data diff utility.
 *
 * The `contentChanges` and `structuralChanges` summaries remain available for
 * callers that consume human-readable groups. The structured `changes` array
 * records add, modify, remove, rename, and schema_change entries.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COLLECTION_TYPES = {
  nodes: "node",
  edges: "edge",
  monsters: "monster",
  events: "event",
  boss_events: "event",
  dice: "dice",
  bosses: "boss",
  minions: "minion"
};

const HANDLED_KEYS = new Set(Object.keys(COLLECTION_TYPES));
const NAME_KEYS = new Set(["id", "index", "name", "name_zh", "name_en", "label", "title"]);

function textId(value, fallback) {
  if (value === undefined || value === null || value === "") return String(fallback);
  return String(value);
}

function getEntityId(item, index, entityType) {
  if (!item || typeof item !== "object") return textId(undefined, index);
  if (item.id !== undefined) return textId(item.id, index);
  if (entityType === "edge" && (item.from !== undefined || item.to !== undefined)) {
    return `${item.from ?? "?"}->${item.to ?? "?"}`;
  }
  return textId(item.index ?? item.key ?? item.name_zh ?? item.name_en ?? item.name, index);
}

function getLabel(item, id) {
  return item?.name || item?.name_zh || item?.name_en || item?.label || id;
}

function fingerprint(item) {
  if (!item || typeof item !== "object") return JSON.stringify(item);
  const normalized = {};
  for (const [key, value] of Object.entries(item)) {
    if (NAME_KEYS.has(key)) continue;
    normalized[key] = value;
  }
  return JSON.stringify(normalized);
}

function resolveRepositoryJsonPath(inputPath) {
  const resolved = path.resolve(rootDir, inputPath);
  if (
    path.extname(resolved).toLowerCase() !== ".json"
    || !resolved.startsWith(`${rootDir}${path.sep}`)
  ) {
    throw new Error(`JSON input must stay inside the repository: ${inputPath}`);
  }
  return resolved;
}

function isLikelyRename(oldItem, newItem) {
  if (fingerprint(oldItem) !== fingerprint(newItem)) return false;
  const oldName = String(oldItem?.name_zh || oldItem?.name_en || oldItem?.name || oldItem?.label || "").trim().toLowerCase();
  const newName = String(newItem?.name_zh || newItem?.name_en || newItem?.name || newItem?.label || "").trim().toLowerCase();
  if (!oldName || !newName) return true;
  if (oldName === newName || oldName.includes(newName) || newName.includes(oldName)) return true;
  let distance = Math.abs(oldName.length - newName.length);
  const previous = [...new Array(newName.length + 1).keys()];
  for (let index = 1; index <= oldName.length; index += 1) {
    const current = [index];
    for (let column = 1; column <= newName.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (oldName[index - 1] === newName[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  distance = previous[newName.length];
  return distance <= Math.max(2, Math.floor(Math.max(oldName.length, newName.length) * 0.3));
}

function addChange(result, change, summaryMessage, structuralMessage = null) {
  result.changes.push({ ...change, message: summaryMessage });
  result.humanReadable.push(summaryMessage);
  if (change.kind === "schema_change") {
    result.isSchemaChange = true;
    result.structuralChanges.push(structuralMessage || summaryMessage);
  } else {
    result.contentChanges.push(summaryMessage);
  }
}

function compareObjectFields(oldItem, newItem, entityType, id, result) {
  const oldKeys = new Set(Object.keys(oldItem || {}));
  const newKeys = new Set(Object.keys(newItem || {}));
  const addedFields = [...newKeys].filter((key) => !oldKeys.has(key));
  const removedFields = [...oldKeys].filter((key) => !newKeys.has(key));
  if (addedFields.length || removedFields.length) {
    const title = `${entityType[0].toUpperCase()}${entityType.slice(1)} ${id} structure altered`;
    addChange(
      result,
      { kind: "schema_change", entity_type: entityType, id, fields_added: addedFields, fields_removed: removedFields, before: oldItem, after: newItem },
      title,
      title
    );
    return;
  }

  for (const key of newKeys) {
    if (JSON.stringify(oldItem[key]) === JSON.stringify(newItem[key])) continue;
    const title = `${entityType[0].toUpperCase()}${entityType.slice(1)} ${id} property '${key}' updated`;
    addChange(result, { kind: "modify", entity_type: entityType, id, field: key, before: oldItem[key], after: newItem[key] }, title);
  }
}

function mapEntities(list, entityType) {
  return new Map(list.map((item, index) => [getEntityId(item, index, entityType), item]));
}

function collectRenames(removed, added, entityType, result) {
  const consumedRemoved = new Set();
  const consumedAdded = new Set();
  for (const [oldId, oldItem] of removed) {
    const match = added.find(([newId, newItem]) => !consumedAdded.has(newId) && isLikelyRename(oldItem, newItem));
    if (!match) continue;
    const [newId, newItem] = match;
    consumedRemoved.add(oldId);
    consumedAdded.add(newId);
    addChange(result, { kind: "rename", entity_type: entityType, from_id: oldId, id: newId, before: oldItem, after: newItem }, `Renamed ${entityType} ${oldId} to ${newId}`);
  }
  return { consumedRemoved, consumedAdded };
}

function appendRemovedItems(removed, consumedRemoved, entityType, result) {
  for (const [id, oldItem] of removed) {
    if (consumedRemoved.has(id)) continue;
    const label = getLabel(oldItem, id);
    const labelSuffix = label && label !== id ? ` (${label})` : "";
    addChange(result, { kind: "remove", entity_type: entityType, id, before: oldItem, after: null }, `Removed ${entityType} ${id}${labelSuffix}`);
  }
}

function appendAddedItems(added, consumedAdded, entityType, result) {
  for (const [id, newItem] of added) {
    if (consumedAdded.has(id)) continue;
    const label = getLabel(newItem, id);
    const labelSuffix = label && label !== id ? ` (${label})` : "";
    addChange(result, { kind: "add", entity_type: entityType, id, before: null, after: newItem }, `Added ${entityType} ${id}${labelSuffix}`);
  }
}

function compareSharedItems(oldMap, newMap, entityType, result) {
  for (const [id, oldItem] of oldMap) {
    if (!newMap.has(id)) continue;
    const newItem = newMap.get(id);
    if (JSON.stringify(oldItem) === JSON.stringify(newItem)) continue;
    const areObjects = oldItem && newItem && typeof oldItem === "object" && typeof newItem === "object"
      && !Array.isArray(oldItem) && !Array.isArray(newItem);
    if (areObjects) {
      compareObjectFields(oldItem, newItem, entityType, id, result);
      continue;
    }
    const title = `${entityType[0].toUpperCase()}${entityType.slice(1)} ${id} updated`;
    addChange(result, { kind: "modify", entity_type: entityType, id, before: oldItem, after: newItem }, title);
  }
}

function compareCollection(oldList, newList, entityType, result) {
  const oldMap = mapEntities(oldList, entityType);
  const newMap = mapEntities(newList, entityType);
  const removed = [...oldMap.entries()].filter(([id]) => !newMap.has(id));
  const added = [...newMap.entries()].filter(([id]) => !oldMap.has(id));

  // Preserve rename detection when a producer changes an ID but keeps its payload.
  const { consumedRemoved, consumedAdded } = collectRenames(removed, added, entityType, result);
  appendRemovedItems(removed, consumedRemoved, entityType, result);
  appendAddedItems(added, consumedAdded, entityType, result);
  compareSharedItems(oldMap, newMap, entityType, result);
}

function compareRootObject(key, oldValue, newValue, result) {
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
  if (key === "schema_version") {
    addChange(result, { kind: "schema_change", path: key, before: oldValue, after: newValue, fields_added: [], fields_removed: [] }, `Root property '${key}' updated`, `Schema version changed: ${oldValue} -> ${newValue}`);
    return;
  }
  if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object" && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
    const oldKeys = new Set(Object.keys(oldValue));
    const newKeys = new Set(Object.keys(newValue));
    const addedFields = [...newKeys].filter((field) => !oldKeys.has(field));
    const removedFields = [...oldKeys].filter((field) => !newKeys.has(field));
    if (addedFields.length || removedFields.length) {
      addChange(result, { kind: "schema_change", path: key, fields_added: addedFields, fields_removed: removedFields, before: oldValue, after: newValue }, `Root object '${key}' structure altered`);
      return;
    }
    for (const field of newKeys) {
      if (JSON.stringify(oldValue[field]) === JSON.stringify(newValue[field])) continue;
      addChange(result, { kind: "modify", path: `${key}.${field}`, before: oldValue[field], after: newValue[field] }, `Root '${key}.${field}' updated`);
    }
    return;
  }
  addChange(result, { kind: "modify", path: key, before: oldValue, after: newValue }, `Root property '${key}' updated`);
}

export function diffGameData(oldData = {}, newData = {}) {
  const result = { isSchemaChange: false, contentChanges: [], structuralChanges: [], changes: [], humanReadable: [] };
  const oldKeys = new Set(Object.keys(oldData || {}));
  const newKeys = new Set(Object.keys(newData || {}));
  appendRootAdditions(oldKeys, newKeys, newData, result);
  appendRootRemovals(oldKeys, newKeys, oldData, result);
  compareCollections(oldData, newData, result);
  compareRootProperties(oldKeys, newKeys, oldData, newData, result);
  return result;
}

function appendRootAdditions(oldKeys, newKeys, newData, result) {
  for (const key of newKeys) {
    if (oldKeys.has(key)) continue;
    addChange(result, { kind: "schema_change", path: key, fields_added: [key], fields_removed: [], before: undefined, after: newData[key] }, `Added root property: ${key}`);
  }
}

function appendRootRemovals(oldKeys, newKeys, oldData, result) {
  for (const key of oldKeys) {
    if (newKeys.has(key)) continue;
    addChange(result, { kind: "schema_change", path: key, fields_added: [], fields_removed: [key], before: oldData[key], after: undefined }, `Removed root property: ${key}`);
  }
}

function compareCollections(oldData, newData, result) {
  for (const [key, entityType] of Object.entries(COLLECTION_TYPES)) {
    const oldList = Array.isArray(oldData?.[key]) ? oldData[key] : [];
    const newList = Array.isArray(newData?.[key]) ? newData[key] : [];
    if (!Array.isArray(oldData?.[key]) && !Array.isArray(newData?.[key])) continue;
    compareCollection(oldList, newList, entityType, result);
  }
}

function compareRootProperties(oldKeys, newKeys, oldData, newData, result) {
  for (const key of newKeys) {
    if (HANDLED_KEYS.has(key) || !oldKeys.has(key)) continue;
    compareRootObject(key, oldData[key], newData[key], result);
  }
}

if (process.argv[1]?.endsWith("diff_game_version.mjs")) {
  const fileA = process.argv[2];
  const fileB = process.argv[3];
  if (!fileA || !fileB) {
    console.log("Usage: node diff_game_version.mjs <old_json> <new_json>");
    process.exit(1);
  }
  const dataA = JSON.parse(fs.readFileSync(resolveRepositoryJsonPath(fileA), "utf8"));
  const dataB = JSON.parse(fs.readFileSync(resolveRepositoryJsonPath(fileB), "utf8"));
  const diff = diffGameData(dataA, dataB);
  console.log(diff.humanReadable.length ? diff.humanReadable.join("\n") : "No changes.");
  console.log(JSON.stringify(diff, null, 2));
}
