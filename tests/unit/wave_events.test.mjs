import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  filterWaveEvents,
  resolveEventDescription,
  getEventDescription,
  resolveEventDurations,
  getEventDurationLabel,
  isAugmentSystemEvent,
  generateAugmentTreeStructure,
  buildAugmentMindmapData,
  buildAugmentMindmapTree,
  getPhaseColor
} from "../../src/domain/wave_events.js";

test("wave_events: WE-01 常規事件模式描述切換", () => {
  const event = {
    eventKind: "event_soul",
    desc_zh: "通用描述",
    mode_desc_coop_zh: "合作專屬描述：70秒後獲得SP",
    mode_desc_versus_zh: "競技專屬描述：60秒後召喚怪物"
  };

  assert.equal(resolveEventDescription(event, "coop"), "合作專屬描述：70秒後獲得SP");
  assert.equal(getEventDescription(event, "versus"), "競技專屬描述：60秒後召喚怪物");

  const fallbackEvent = { eventKind: "event_plain", desc_zh: "通用描述" };
  assert.equal(resolveEventDescription(fallbackEvent, "coop"), "通用描述");
  assert.equal(resolveEventDescription(fallbackEvent, "versus"), "通用描述");
});

test("wave_events: WE-02 ~ WE-05 各類持續時間標籤解析", () => {
  // WE-02 單次觸發
  assert.equal(getEventDurationLabel({ timing_type: "single_trigger" }, "coop"), "觸發 1 次");

  // WE-03 永久被動
  assert.equal(getEventDurationLabel({ timing_type: "passive" }, "coop"), "永久");

  // WE-04 模式禁用
  assert.equal(getEventDurationLabel({ mode_flags: { coop: false } }, "coop"), "-");
  assert.equal(getEventDurationLabel({ mode_flags: { versus: false } }, "versus"), "-");

  // WE-05 自定義時長與立即生效
  assert.equal(getEventDurationLabel({ coop_time: "10秒" }, "coop"), "10秒");
  assert.equal(getEventDurationLabel({ timing_type: "instant" }, "coop"), "立即生效");
});

test("wave_events: WE-06 AugmentSystem 1分3心智圖分支資料構建", () => {
  const mockAugment = {
    eventKind: "AugmentSystem",
    name_zh: "選擇由我決定",
    augment_choices: [
      { name_zh: "神話骰子", desc_zh: "開場獲得神話骰子", icon: "icon_1.png" },
      { name_zh: "大量SP", desc_zh: "獲得 1000 SP", icon: "icon_2.png" },
      { name_zh: "炸彈骰子", desc_zh: "召喚 2 顆炸彈", icon: "icon_3.png" }
    ]
  };

  assert.ok(isAugmentSystemEvent(mockAugment));
  const tree = generateAugmentTreeStructure(mockAugment, "coop");

  assert.equal(tree.isAugment, true);
  assert.equal(tree.isAugmentTree, true);
  assert.equal(tree.choices.length, 3);
  assert.equal(tree.branches.length, 3);
  assert.equal(tree.mainCard.nameZh, "選擇由我決定");
  assert.ok(tree.connector);
  assert.equal(tree.connector.startPoint.x, 0);
  assert.equal(tree.connector.endPoints.length, 3);
});

test("wave_events: WE-07 缺失 choices 容錯", () => {
  const malformed = { eventKind: "AugmentSystem", augment_choices: null };
  const tree = buildAugmentMindmapTree(malformed);
  assert.equal(tree.choices.length, 0);
  assert.equal(tree.branches.length, 0);
});

test("wave_events: WE-08 真實 55 筆事件資料完整性與模式過濾", () => {
  const candidatePaths = [
    path.resolve("site/boss_event_data.json"),
    path.resolve("site/data/boss_event_data.json"),
    path.resolve("data/boss_event_data.json")
  ];
  const jsonPath = candidatePaths.find((p) => fs.existsSync(p));

  assert.ok(jsonPath, `boss_event_data.json 必須存在於以下路徑之一: ${candidatePaths.join(", ")}`);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const events = raw.events || [];

  assert.equal(events.length, 55, "標準規範波次事件資料集應有 55 筆事件");

  const coopEvents = filterWaveEvents(events, "coop");
  const versusEvents = filterWaveEvents(events, "versus");
  assert.equal(coopEvents.length, 44, "1.0.3 合作模式應有 44 筆支援事件");
  assert.equal(versusEvents.length, 55, "競技模式應有 55 筆支援事件");
  for (const name of ["勢力戰", "頂樓", "和平主義者"]) {
    assert.equal(coopEvents.some((event) => event.name_zh === name), false, `${name} 不應套用於合作模式`);
  }
});

test("wave_events: WE-09 & WE-10 階段與關鍵字過濾", () => {
  const mockEvents = [
    { name_zh: "和平主義者", phase: "Early", mode_flags: { coop: true, versus: true } },
    { name_zh: "末日審判", phase: "Late", mode_flags: { coop: true, versus: false } },
    { name_zh: "魔法潮汐", phase: "Mid", mode_flags: { coop: false, versus: true } }
  ];

  const lateOnly = filterWaveEvents(mockEvents, { phase: "Late" });
  assert.equal(lateOnly.length, 1);
  assert.equal(lateOnly[0].name_zh, "末日審判");

  const searchResult = filterWaveEvents(mockEvents, { search: "和平" });
  assert.equal(searchResult.length, 1);
  assert.equal(searchResult[0].name_zh, "和平主義者");
});

test("wave_events: WE-11 getPhaseColor 主題色彩", () => {
  assert.equal(getPhaseColor("Early"), "#68d391");
  assert.equal(getPhaseColor("Mid"), "#f6ad55");
  assert.equal(getPhaseColor("Late"), "#fc8181");
});
