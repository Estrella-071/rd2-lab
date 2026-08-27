/**
 * Locale catalog and data-localisation helpers.
 *
 * The catalog is data, not a second set of view templates.  Runtime entities
 * carry stable translation keys and this module resolves those keys for the
 * active locale while preserving the original numeric and topology fields.
 */

export const SUPPORTED_LOCALES = Object.freeze(["zh-tw", "en", "ja", "ko"]);

export const LOCALE_META = Object.freeze({
  "zh-tw": Object.freeze({ label: "中文", intl: "zh-TW" }),
  en: Object.freeze({ label: "English", intl: "en" }),
  ja: Object.freeze({ label: "日本語", intl: "ja" }),
  ko: Object.freeze({ label: "한국어", intl: "ko" })
});

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLocale(value, fallback = "zh-tw") {
  const candidate = String(value || "").trim().toLowerCase().replaceAll("_", "-");
  if (SUPPORTED_LOCALES.includes(candidate)) return candidate;
  const base = candidate.split("-", 1)[0];
  if (base === "zh" || base === "cn" || base === "tw") return "zh-tw";
  if (SUPPORTED_LOCALES.includes(base)) return base;
  return SUPPORTED_LOCALES.includes(fallback) ? fallback : "zh-tw";
}

function getClientLanguageValues() {
  if (typeof navigator === "undefined") return [];
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  return [...languages, navigator.language];
}

/**
 * Resolve the first supported locale from the browser's preferred languages.
 * Chinese variants use the published Traditional Chinese catalog because it
 * is the only Chinese locale currently available in the site.
 *
 * @param {string|string[]|undefined} languageValues Optional language tags;
 *   omitted means the current browser's navigator values.
 * @returns {string|null} A supported locale, or null when no match exists.
 */
export function detectClientLocale(languageValues = undefined) {
  const candidates = languageValues === undefined
    ? getClientLanguageValues()
    : (Array.isArray(languageValues) ? languageValues : [languageValues]);
  for (const value of candidates) {
    const candidate = String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
    if (!candidate) continue;
    if (SUPPORTED_LOCALES.includes(candidate)) return candidate;
    const base = candidate.split("-", 1)[0];
    if (base === "zh" || base === "cn" || base === "tw") return "zh-tw";
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return null;
}

function interpolatePlaceholders(source, values) {
  let result = "";
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("{", cursor);
    if (start < 0) return result + source.slice(cursor);
    const close = source.indexOf("}", start + 1);
    if (close < 0) return result + source.slice(cursor);
    const token = source.slice(start + 1, close);
    if (!token || token.includes("{")) {
      result += source.slice(cursor, start + 1);
      cursor = start + 1;
      continue;
    }
    result += source.slice(cursor, start);
    if (Object.hasOwn(values, token)) result += String(values[token]);
    else if (isDigits(token) && Array.isArray(values)) result += String(values[Number(token)] ?? `{${token}}`);
    else result += `{${token}}`;
    cursor = close + 1;
  }
  return result;
}

export function interpolate(template, values = {}) {
  return interpolatePlaceholders(String(template ?? ""), values);
}

function cloneEntry(entry) {
  return isRecord(entry) ? { ...entry } : entry;
}

function getEntry(catalog, section, key) {
  const source = catalog?.[section];
  if (!isRecord(source)) return null;
  if (Object.hasOwn(source, key)) return source[key];
  const parts = String(key || "").split(".");
  let value = source;
  for (const part of parts) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return null;
    value = value[part];
  }
  return value;
}

function resolveEntry(entry, locale, fallbackLocale, fallback = "") {
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (!isRecord(entry)) return String(fallback ?? "");
  const value = entry[locale];
  if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  const fallbackValue = entry[fallbackLocale];
  if (fallbackValue !== undefined && fallbackValue !== null && String(fallbackValue).trim() !== "") {
    return String(fallbackValue);
  }
  return String(fallback ?? "");
}

function replaceField(target, field, value) {
  if (value === undefined || value === null) return;
  target[field] = value;
}

function stripMarkup(value) {
  return String(value ?? "").replaceAll(/<[^<>]*>/g, "").trim();
}

function isDigit(character) {
  if (!character) return false;
  const code = character.codePointAt(0);
  return code >= 48 && code <= 57;
}

function isDigits(value) {
  const source = String(value ?? "");
  if (!source) return false;
  for (const character of source) {
    if (!isDigit(character)) return false;
  }
  return true;
}

function readNumericToken(source, start) {
  let index = start;
  if (source[index] === "-" && !isDigit(source[index + 1])) return null;
  if (source[index] === "-") index += 1;
  const digitStart = index;
  while (isDigit(source[index])) index += 1;
  if (index === digitStart) return null;
  if (source[index] === "." && isDigit(source[index + 1])) {
    index += 1;
    while (isDigit(source[index])) index += 1;
  }
  return { value: source.slice(start, index), next: index };
}

function extractNumericTokens(value) {
  const source = String(value ?? "");
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const token = readNumericToken(source, index);
    if (!token) {
      index += 1;
      continue;
    }
    tokens.push(token.value);
    index = token.next;
  }
  return tokens;
}

function extractTemplateTokens(value) {
  const source = String(value ?? "");
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (source[index] === "{") {
      const close = source.indexOf("}", index + 1);
      if (close > index + 1) {
        const placeholder = source.slice(index + 1, close);
        if (isDigits(placeholder)) {
          tokens.push({ raw: source.slice(index, close + 1), placeholder });
          index = close + 1;
          continue;
        }
      }
    }
    const token = readNumericToken(source, index);
    if (!token) {
      index += 1;
      continue;
    }
    tokens.push({ raw: token.value, placeholder: undefined });
    index = token.next;
  }
  return tokens;
}

/**
 * Bind positional values in a source template to the corresponding values in
 * the runtime snapshot.  The client source uses placeholders such as {0} and
 * {4}; the published event snapshot already contains those values in its
 * resolved Chinese text.  Literal numbers are skipped while walking the
 * template so values such as "1 of 3" remain stable in every locale.
 */
function resolveTemplateValues(template, runtimeText) {
  const templateTokens = extractTemplateTokens(template);
  const runtimeValues = extractNumericTokens(runtimeText);
  const values = {};
  let runtimeIndex = 0;
  for (const token of templateTokens) {
    const raw = token.raw;
    const placeholder = token.placeholder;
    if (placeholder !== undefined) {
      values[placeholder] = runtimeValues[runtimeIndex] ?? "";
      runtimeIndex += 1;
      continue;
    }
    const literal = raw;
    if (runtimeValues[runtimeIndex] === literal) {
      runtimeIndex += 1;
    } else {
      const nextLiteral = runtimeValues.indexOf(literal, runtimeIndex);
      if (nextLiteral >= 0) runtimeIndex = nextLiteral + 1;
    }
  }
  return values;
}

function localizeSourceTemplate(service, key, runtimeText, fallback = "") {
  if (!key) return fallback;
  const sourceEntry = service.catalog?.source?.[key];
  const sourceTemplate = isRecord(sourceEntry) ? sourceEntry[service.defaultLocale] || sourceEntry["zh-tw"] || "" : "";
  const values = resolveTemplateValues(sourceTemplate, runtimeText);
  return service.source(key, values, fallback);
}

function resolveContentEntry(service, kind, id, field, fallback = "") {
  const mapping = service.catalog?.content?.[kind]?.[String(id)];
  if (!mapping) return { value: fallback, key: null };
  const key = mapping[field];
  if (!key) return { value: fallback, key: null };
  return { value: service.t(key, {}, fallback), key };
}

function resolveSpecialStatKey(stat) {
  // Stable raw label keys survive reordering and additions in the source
  // tables.  Positional mappings are intentionally rejected: an array reorder
  // must never relabel a numeric stat.
  return stat?.label_key || stat?.stat_key || "";
}

const NODE_LOCALIZATION_FIELDS = Object.freeze([
  ["name", "name_zh"],
  ["description", "description_zh"],
  ["fullName", "full_name"],
  ["awakening", "dice_awaken"],
  ["target", "dice_target_zh"],
  ["branch", "branch_zh"],
  ["nodeType", "node_type_zh"],
  ["unlockCondition", "unlock_condition_zh"]
]);

function nodeFieldFallback(node, outputField) {
  const values = {
    name_zh: node.name_zh || node.name || "",
    description_zh: node.description_zh || node.desc || "",
    full_name: node.full_name || node.name_zh || node.name || "",
    dice_awaken: node.dice_awaken || "",
    dice_target_zh: node.dice_target_zh || "",
    branch_zh: node.branch_zh || "",
    node_type_zh: node.node_type_zh || "",
    unlock_condition_zh: node.unlock_condition_label_zh || node.unlock_condition_zh || ""
  };
  return values[outputField] || "";
}

function applyLocalizedNodeField(service, localized, mapping, mappingField, outputField, fallback) {
  const key = mapping[mappingField];
  if (!key) return;
  const value = service.t(key, {}, fallback);
  localized[outputField] = value;
  if (outputField === "name_zh") localized.short_label = value;
  localized[`_${mappingField}Key`] = key;
}

function localizeSpecialStat(service, stat) {
  const key = resolveSpecialStatKey(stat);
  if (!key) return { ...stat };
  return { ...stat, label: service.t(key, {}, stat.label || ""), label_key: key };
}

function localizeNodeStatGroups(service, localized, statsMapping) {
  if (!Array.isArray(statsMapping)) return;
  if (Array.isArray(localized.special_stats)) {
    localized.special_stats = localized.special_stats.map((stat) => localizeSpecialStat(service, stat));
  }
  for (const field of ["powerup_data", "dot_data"]) {
    const stats = localized[field]?.special_stats;
    if (!Array.isArray(stats)) continue;
    localized[field] = {
      ...localized[field],
      special_stats: stats.map((stat) => localizeSpecialStat(service, stat))
    };
  }
}

function localizeNode(service, node) {
  const localized = {
    ...node,
    _canonical_name_zh: node._canonical_name_zh || node.name_zh || node.name || "",
    _canonical_description_zh: node._canonical_description_zh || node.description_zh || node.desc || "",
    _canonical_unlock_condition_zh: node._canonical_unlock_condition_zh || node.unlock_condition_zh || node.unlock_condition_label_zh || ""
  };
  const mapping = service.catalog?.content?.nodes?.[String(node.id)] || {};
  for (const [mappingField, outputField] of NODE_LOCALIZATION_FIELDS) {
    applyLocalizedNodeField(service, localized, mapping, mappingField, outputField, nodeFieldFallback(node, outputField));
  }
  if (mapping.unlockConditionValue !== undefined && mapping.unlockConditionValue !== null) {
    localized.unlock_condition_value = String(mapping.unlockConditionValue);
  }
  if (mapping.fullName) {
    localized.name_zh = service.t(mapping.fullName, {}, localized.name_zh || localized._canonical_name_zh);
    localized.short_label = localized.name_zh;
    localized._fullNameKey = mapping.fullName;
  }
  localizeNodeStatGroups(service, localized, mapping.specialStats);
  return localized;
}

function localizeTagDefinitions(service, definitions) {
  const localized = {};
  for (const [tagKey, definition] of Object.entries(definitions || {})) {
    const mapping = service.catalog?.content?.tags?.[tagKey] || {};
    const result = { ...definition };
    if (mapping.name) {
      result.name_zh = stripMarkup(service.t(mapping.name, {}, definition.name_zh || tagKey));
      result.name_key = mapping.name;
    }
    if (mapping.description) {
      result.desc_zh = service.t(mapping.description, {}, definition.desc_zh || "");
      result.desc_key = mapping.description;
    }
    localized[tagKey] = result;
  }
  return localized;
}

function localizeMonster(service, monster) {
  const localized = {
    ...monster,
    _canonical_name_zh: monster._canonical_name_zh || monster.name_zh || monster.name_en || "",
    _canonical_description_zh: monster._canonical_description_zh || monster.desc_zh || monster.desc_en || ""
  };
  const mapping = service.catalog?.content?.monsters?.[String(monster.id)] || {};
  if (mapping.name) {
    localized.name_zh = service.t(mapping.name, {}, monster.name_zh || monster.name_en || "");
    localized.name_key = mapping.name;
  }
  if (mapping.description) {
    localized.desc_zh = service.t(mapping.description, {}, monster.desc_zh || monster.desc_en || "");
    localized.desc_key = mapping.description;
  }
  if (mapping.subType) {
    localized.subType_zh = service.t(mapping.subType, {}, monster.subType_zh || monster.subType || "");
    localized.subtype_key = mapping.subType;
  }
  for (const [field, key] of Object.entries(mapping.fields || {})) {
    if (key) localized[field] = service.t(key, {}, monster[field] || "");
  }
  return localized;
}

function localizeEvent(service, event) {
  const localized = {
    ...event,
    _canonical_name_zh: event._canonical_name_zh || event.name_zh || event.name_en || event.eventKind || "",
    _canonical_description_zh: event._canonical_description_zh || event.desc_zh || event.desc_en || "",
    _canonical_mode_desc_coop_zh: event._canonical_mode_desc_coop_zh || event.mode_desc_coop_zh || event.desc_zh || "",
    _canonical_mode_desc_versus_zh: event._canonical_mode_desc_versus_zh || event.mode_desc_versus_zh || event.desc_zh || ""
  };
  const mapping = service.catalog?.content?.events?.[String(event.id)] || {};
  if (mapping.name) {
    const value = service.source(mapping.name, {}, event.name_zh || event.name_en || event.eventKind || "");
    localized.name_zh = value;
    localized.display_name_zh = value;
    localized.name_key = mapping.name;
  }
  if (mapping.description) {
    const value = localizeSourceTemplate(service, mapping.description, localized._canonical_description_zh, event.desc_zh || event.desc_en || "");
    localized.desc_zh = value;
    localized.mode_desc_coop_zh = localizeSourceTemplate(service, mapping.description, localized._canonical_mode_desc_coop_zh, value);
    localized.mode_desc_versus_zh = localizeSourceTemplate(service, mapping.description, localized._canonical_mode_desc_versus_zh, value);
    localized.desc_key = mapping.description;
  }
  if (mapping.phase) localized.phase_zh = service.t(mapping.phase, {}, event.phase_zh || event.phase || "");
  if (Array.isArray(localized.augment_choices) && Array.isArray(mapping.choices)) {
    localized.augment_choices = localized.augment_choices.map((choice, index) => {
      const choiceMapping = mapping.choices[index] || {};
      const result = { ...choice };
      if (choiceMapping.name) {
        result.name_zh = service.source(choiceMapping.name, {}, choice.name_zh || choice.name_en || choice.key || "");
        result.name_key = choiceMapping.name;
      }
      if (choiceMapping.description) {
        result.desc_zh = localizeSourceTemplate(service, choiceMapping.description, choice.desc_zh || choice.desc_en || "", choice.desc_zh || choice.desc_en || "");
        result.desc_key = choiceMapping.description;
      }
      return result;
    });
  }
  return localized;
}

export class LocalizationService {
  constructor(catalog = {}, { locale, storage, storageKey = "locale", clientLanguages } = {}) {
    this.catalog = isRecord(catalog) ? catalog : {};
    this.defaultLocale = normalizeLocale(this.catalog.default_locale || "zh-tw");
    this.storage = storage || null;
    this.storageKey = storageKey;
    const stored = this.storage?.get?.(storageKey);
    const detected = detectClientLocale(clientLanguages);
    // Explicit and persisted choices win.  Only a first visit follows the
    // browser preference; the published default remains the final fallback.
    this.locale = normalizeLocale(locale || stored || detected || this.defaultLocale, this.defaultLocale);
    this._listeners = new Set();
  }

  getLocale() {
    return this.locale;
  }

  getIntlLocale() {
    return LOCALE_META[this.locale]?.intl || "zh-TW";
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  setLocale(value, { persist = true } = {}) {
    const next = normalizeLocale(value, this.defaultLocale);
    if (next === this.locale) return false;
    const previous = this.locale;
    this.locale = next;
    if (persist) this.storage?.set?.(this.storageKey, next);
    for (const listener of this._listeners) {
      try { listener(next, previous); } catch (error) { console.error("Localization listener error:", error); }
    }
    return true;
  }

  t(key, values = {}, fallback = "") {
    const entry = getEntry(this.catalog, "ui", key) || getEntry(this.catalog, "source", key);
    return interpolate(resolveEntry(entry, this.locale, this.defaultLocale, fallback || key), values);
  }

  source(key, values = {}, fallback = "") {
    const entry = getEntry(this.catalog, "source", key);
    return interpolate(resolveEntry(entry, this.locale, this.defaultLocale, fallback || key), values);
  }

  entity(kind, id, field, fallback = "") {
    const result = resolveContentEntry(this, kind, id, field, fallback);
    return result.value;
  }

  localizeTreeData(treeData) {
    const source = treeData || {};
    const localized = {
      ...source,
      nodes: Array.isArray(source.nodes) ? source.nodes.map((node) => localizeNode(this, node)) : [],
      tag_definitions: localizeTagDefinitions(this, source.tag_definitions)
    };
    if (source.factions && isRecord(source.factions)) {
      localized.factions = Object.fromEntries(Object.entries(source.factions).map(([id, faction]) => {
        const key = this.catalog?.content?.factions?.[String(id)];
        return [id, key ? { ...faction, name: this.t(key, {}, faction.name || faction.name_zh || id), name_zh: this.t(key, {}, faction.name_zh || id) } : { ...faction }];
      }));
    }
    return localized;
  }

  localizeBossEvents(data) {
    const source = data || {};
    return {
      ...source,
      monsters: Array.isArray(source.monsters) ? source.monsters.map((monster) => localizeMonster(this, monster)) : [],
      events: Array.isArray(source.events) ? source.events.map((event) => localizeEvent(this, event)) : [],
      historical_events: Array.isArray(source.historical_events) ? source.historical_events.map((event) => localizeEvent(this, event)) : []
    };
  }

  localizeTreeAndEvents(treeData, bossEvents) {
    return {
      treeData: this.localizeTreeData(treeData),
      bossEvents: this.localizeBossEvents(bossEvents)
    };
  }
}
