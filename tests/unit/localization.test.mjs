import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  LocalizationService,
  SUPPORTED_LOCALES,
  detectClientLocale,
  normalizeLocale,
  interpolate
} from "../../src/domain/localization.js";
import { getFactionLevelProgressLabel, getUnlockConditionLabel } from "../../src/domain/simulation_plan.js";
import { applyLocalizationDocument } from "../../src/ui/locale_view.js";

const root = path.resolve(".");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const catalog = readJson("site/data/locales.json");

function createFakeElement(attributes = {}) {
  const values = { ...attributes };
  const classes = new Set();
  const dataset = Object.fromEntries(Object.entries(attributes)
    .filter(([name]) => name.startsWith("data-"))
    .map(([name, value]) => [name.slice(5).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  return {
    dataset,
    textContent: "",
    innerHTML: "",
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    getAttribute(name) { return values[name] ?? null; },
    setAttribute(name, value) { values[name] = String(value); },
    hasClass(name) { return classes.has(name); }
  };
}

test("localization: normalizes locale aliases and interpolates named tokens", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["zh-tw", "en", "ja", "ko"]);
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-tw");
  assert.equal(normalizeLocale("ja-JP"), "ja");
  assert.equal(normalizeLocale("unknown", "ko"), "ko");
  assert.equal(interpolate("{name} · {count}", { name: "Dice", count: 3 }), "Dice · 3");
});

test("localization: published fallback is deterministic and selected locale persists", () => {
  const values = new Map();
  const storage = {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); }
  };
  const service = new LocalizationService(catalog, { storage, clientLanguages: [] });
  assert.equal(service.getLocale(), "zh-tw");
  assert.equal(service.t("brand.title"), "RANDOM DICE 2 LAB");
  assert.equal(service.setLocale("en"), true);
  assert.equal(values.get("locale"), "en");
  assert.equal(service.t("faction.1"), "Nature");
  assert.equal(new LocalizationService(catalog, { storage, clientLanguages: [] }).getLocale(), "en");
});

test("localization: detects client language and preserves explicit and stored precedence", () => {
  assert.equal(detectClientLocale(["fr-FR", "ja-JP"]), "ja");
  assert.equal(detectClientLocale(["zh-CN"]), "zh-tw");
  assert.equal(detectClientLocale("ko-KR"), "ko");
  assert.equal(detectClientLocale(["de-DE"]), null);

  const detected = new LocalizationService(catalog, { clientLanguages: ["ja-JP"] });
  assert.equal(detected.getLocale(), "ja");

  const stored = new LocalizationService(catalog, {
    clientLanguages: ["ja-JP"],
    storage: { get() { return "ko"; } }
  });
  assert.equal(stored.getLocale(), "ko");

  const explicit = new LocalizationService(catalog, {
    locale: "en",
    clientLanguages: ["ja-JP"],
    storage: { get() { return "ko"; } }
  });
  assert.equal(explicit.getLocale(), "en");
});

test("localization: all runtime entities resolve complete translated content", () => {
  const tree = readJson("site/data/dice_tree.json");
  const bossEvents = readJson("site/boss_event_data.json");
  const service = new LocalizationService(catalog, { locale: "en" });
  const localized = service.localizeTreeAndEvents(tree, bossEvents);
  const fire = localized.treeData.nodes.find((node) => String(node.id) === "1001");
  assert.equal(fire.name_zh, "Fire Dice");
  assert.equal(fire._canonical_name_zh, "火骰子");
  assert.match(fire.description_zh, /Basic Attacks/);
  assert.equal(localized.treeData.tag_definitions.BURN.name_zh, "Burn");
  assert.ok(localized.treeData.tag_definitions.BURN.desc_zh.length > 0);
  const augment = localized.bossEvents.events.find((event) => event.id === "event_69");
  assert.ok(augment.augment_choices.every((choice) => choice.name_zh && choice.desc_zh));
  const durationEvent = localized.bossEvents.events.find((event) => event.id === "event_7");
  assert.match(durationEvent.mode_desc_coop_zh, /100/);
  assert.match(durationEvent.mode_desc_versus_zh, /60/);
  assert.doesNotMatch(durationEvent.mode_desc_coop_zh, /\{\d+\}/);
  assert.doesNotMatch(durationEvent.mode_desc_versus_zh, /\{\d+\}/);
  assert.equal(localized.bossEvents.monsters.length, 15);
});

test("localization: special unlock conditions and level thresholds use locale keys", () => {
  const tree = readJson("site/data/dice_tree.json");
  const expected = {
    "zh-tw": {
      "4008": "七日任務 700",
      "5002": "合作擊殺數 900",
      "5006": "討伐獎勵 2100",
      "5008": "競技場通行證 300",
      "1106": "自然等級 10",
      "1107": "自然等級 30",
      "1108": "自然等級 50",
      "2106": "工學等級 10",
      "2107": "工學等級 30",
      "2108": "工學等級 50",
      "3106": "魔法等級 10",
      "3107": "魔法等級 30",
      "3108": "魔法等級 50"
    },
    en: {
      "4008": "Seven-day mission 700",
      "5002": "Co-op kills 900",
      "5006": "Bounty reward 2100",
      "5008": "Arena pass 300",
      "1106": "Nature level 10",
      "1107": "Nature level 30",
      "1108": "Nature level 50",
      "2106": "Engineering level 10",
      "2107": "Engineering level 30",
      "2108": "Engineering level 50",
      "3106": "Magic level 10",
      "3107": "Magic level 30",
      "3108": "Magic level 50"
    },
    ja: {
      "4008": "7日ミッション 700",
      "5002": "協力撃破数 900",
      "5006": "討伐報酬 2100",
      "5008": "アリーナパス 300",
      "1106": "自然レベル 10",
      "1107": "自然レベル 30",
      "1108": "自然レベル 50",
      "2106": "工学レベル 10",
      "2107": "工学レベル 30",
      "2108": "工学レベル 50",
      "3106": "魔法レベル 10",
      "3107": "魔法レベル 30",
      "3108": "魔法レベル 50"
    },
    ko: {
      "4008": "7일 임무 700",
      "5002": "협동 처치 수 900",
      "5006": "토벌 보상 2100",
      "5008": "아레나 패스 300",
      "1106": "자연 레벨 10",
      "1107": "자연 레벨 30",
      "1108": "자연 레벨 50",
      "2106": "공학 레벨 10",
      "2107": "공학 레벨 30",
      "2108": "공학 레벨 50",
      "3106": "마법 레벨 10",
      "3107": "마법 레벨 30",
      "3108": "마법 레벨 50"
    }
  };
  for (const locale of SUPPORTED_LOCALES) {
    const service = new LocalizationService(catalog, { locale });
    const localized = service.localizeTreeData(tree).nodes;
    for (const id of Object.keys(expected[locale])) {
      const node = localized.find((candidate) => String(candidate.id) === id);
      assert.ok(node, `node ${id} exists`);
      assert.equal(getUnlockConditionLabel(node), expected[locale][id], `${locale} ${id}`);
      if (id === "1106") {
        const conditionName = expected[locale][id].replace(/\s+10$/, "");
        assert.equal(getFactionLevelProgressLabel(node, 3), `${conditionName} 3/10`, `${locale} faction level progress`);
        assert.equal(getFactionLevelProgressLabel(node), `${conditionName} ?/10`, `${locale} unknown faction level progress`);
      }
    }
    const ordinaryNode = localized.find((candidate) => String(candidate.id) === "1001");
    assert.equal(getUnlockConditionLabel(ordinaryNode), "", `${locale} ordinary prerequisite`);
  }
});

test("localization: document adapter handles text, html, attributes, placeholders, and active locale", () => {
  const title = createFakeElement({ "data-i18n": "brand.title" });
  const html = createFakeElement({ "data-i18n-html": "disclaimer.item.community" });
  const input = createFakeElement({ "data-i18n-placeholder": "search.placeholder", placeholder: "" });
  input.dataset.i18nValues = "{}";
  const labelled = createFakeElement({ "data-i18n-attr": "aria-label:search.label;title:filter.title", "aria-label": "", title: "" });
  const option = createFakeElement({ "data-locale": "en" });
  const rootElement = {
    documentElement: createFakeElement(),
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return [title];
      if (selector === "[data-i18n-html]") return [html];
      if (selector === "[data-i18n-placeholder]") return [input];
      if (selector === "[data-i18n-attr]") return [labelled];
      if (selector === "[data-locale]") return [option];
      return [];
    }
  };
  const service = new LocalizationService(catalog, { locale: "en" });
  applyLocalizationDocument(service, rootElement);
  assert.equal(title.textContent, "RANDOM DICE 2 LAB");
  assert.match(html.innerHTML, /Player-made/);
  assert.match(input.getAttribute("placeholder"), /Search dice/);
  assert.equal(labelled.getAttribute("aria-label"), "Search dice tree nodes");
  assert.equal(labelled.getAttribute("title"), "Filters");
  assert.equal(rootElement.documentElement.getAttribute("lang"), "en");
  assert.equal(option.getAttribute("aria-pressed"), "true");
  assert.equal(option.hasClass("is-active"), true);
});

test("localization: every catalog entry has all locales and matching placeholders", () => {
  for (const [section, entries] of Object.entries({ ui: catalog.ui, source: catalog.source })) {
    for (const [key, entry] of Object.entries(entries)) {
      for (const locale of SUPPORTED_LOCALES) {
        assert.ok(String(entry[locale] || "").trim(), `${section}.${key} is empty in ${locale}`);
      }
      const base = [...String(entry["zh-tw"]).matchAll(/\{[^}]+\}/g)].map((match) => match[0]).sort();
      for (const locale of SUPPORTED_LOCALES.slice(1)) {
        const candidate = [...String(entry[locale]).matchAll(/\{[^}]+\}/g)].map((match) => match[0]).sort();
        assert.deepEqual(candidate, base, `${section}.${key} placeholder mismatch in ${locale}`);
      }
    }
  }
});
