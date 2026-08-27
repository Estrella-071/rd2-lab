import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  formatGameText,
  resolveGameText,
  sanitizeGameMarkup,
  escapeHtml,
  DEFAULT_TAG_MAP
} from "../../src/domain/game_text.js";

const canonicalTree = JSON.parse(fs.readFileSync(new URL("../../site/data/dice_tree.json", import.meta.url), "utf8"));
const localeCatalog = JSON.parse(fs.readFileSync(new URL("../../site/data/locales.json", import.meta.url), "utf8"));

test("game_text: escapeHtml 實體符號轉義", () => {
  assert.equal(escapeHtml('<script>alert("xss")&\'</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&amp;&#039;&lt;/script&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(123), "123");
});

test("game_text: GT-01 PLAYER_PASSIVE 佔位符替換與階級線性計算", () => {
  const node = {
    node_type: "PLAYER_PASSIVE",
    passive_value: "10",
    passive_rank_add: "1.5",
    max_rank: 10
  };
  const template = "暴擊傷害增加 {0}% <color=green>(+{1}%)</color>";

  // Rank 1: 10 + 0 = 10
  const r1 = formatGameText(template, node, 1);
  assert.ok(r1.includes("<strong>10</strong>"));
  assert.ok(r1.includes('<span class="stat-green-add">(+1.5%)</span>'));

  // Rank 3: 10 + 2 * 1.5 = 13
  const r3 = formatGameText(template, node, 3);
  assert.ok(r3.includes("<strong>13</strong>"));
});

test("game_text: GT-02 DICE_RUNE 6 個佔位符替換與多參數計算", () => {
  const node = {
    node_type: "DICE_RUNE",
    rune_value1: "50",
    rune_value1_rank_add: "5",
    rune_value2: "100",
    rune_value2_rank_add: "10",
    rune_duration: "8",
    rune_duration_rank_add: "0.5",
    max_rank: 5
  };
  const template = "造成 {0} 點傷害 (+{1})，次要目標 {2} 點 (+{3})，持續 {4} 秒 (+{5})";

  // Rank 2: value1 = 55, value2 = 110
  const res = formatGameText(template, node, 2);
  assert.ok(res.includes("<strong>55</strong>"));
  assert.ok(res.includes("<strong>110</strong>"));
  assert.ok(res.includes("<strong>8</strong>"));
});

test("game_text: signed cooldown rune rank increments are applied and localized as magnitudes", () => {
  const node = canonicalTree.nodes.find((candidate) => candidate.id === "1204");
  const templates = Object.values(localeCatalog.source.PillarCooldownMinus1Sec_desc || {});
  assert.ok(node, "canonical node 1204 must exist");
  assert.equal(templates.length, 4, "the signed-rune regression must cover all locales");

  for (const template of templates) {
    const rank1 = formatGameText(template, node, 1);
    const rank2 = formatGameText(template, node, 2);
    const rank50 = formatGameText(template, node, 50);
    assert.ok(rank1.includes("<strong>0.5</strong>"), template);
    assert.ok(rank2.includes("<strong>0.7</strong>"), template);
    assert.ok(rank50.includes("<strong>10.3</strong>"), template);
    assert.ok(rank2.includes("0.2"), template);
    assert.ok(!rank50.includes("stat-green-add"), template);
    assert.ok(!rank2.includes("+-"), template);
  }
});

test("game_text: every signed RuneTable reduction axis is displayed as a magnitude", () => {
  const cases = [
    {
      node: { node_type: "DICE_RUNE", rune_kind: "ElementDefenderRotationSpeedIncrease", rune_value1: "3", rune_value2: "-0.5", rune_duration: "5", max_rank: 1 },
      template: "每{0}秒，持續{2}秒增加(最多{4}秒)",
      expected: ["<strong>3</strong>", "<strong>0.5</strong>", "<strong>5</strong>"]
    },
    {
      node: { node_type: "DICE_RUNE", rune_kind: "AtkCountDecrease", rune_value1: "-10", max_rank: 1 },
      template: "需要攻擊次數減少{0}",
      expected: ["<strong>10</strong>"]
    }
  ];

  for (const { node, template, expected } of cases) {
    const rendered = formatGameText(template, node, 1);
    for (const fragment of expected) assert.ok(rendered.includes(fragment), `${node.rune_kind}: ${fragment}`);
    assert.ok(!rendered.includes("--"), node.rune_kind);
    assert.ok(!rendered.includes(">-"), node.rune_kind);
  }
});

test("game_text: node 2304 uses the generated four-locale interval/duration wording", () => {
  const node = canonicalTree.nodes.find((candidate) => candidate.id === "2304");
  const rawNode = JSON.parse(fs.readFileSync(new URL("../../data/raw_snapshot_1.0.3.json", import.meta.url), "utf8"))
    .projection.tree.nodes.find((candidate) => candidate.id === "2304");
  const rune = JSON.parse(fs.readFileSync(new URL("../../data/raw_snapshot_1.0.3.json", import.meta.url), "utf8"))
    .projection.tables.RuneTable.records.find((candidate) => candidate.Id === "53");
  const templates = localeCatalog.source.ElementDefenderRotationSpeedIncrease_desc;

  assert.ok(node, "canonical node 2304 must exist");
  assert.ok(rawNode, "raw node 2304 must exist");
  assert.ok(rune, "raw RuneTable kind 53 must exist");
  assert.deepEqual(
    { description_zh: node.description_zh, rune_value1: node.rune_value1, rune_value2: node.rune_value2, rune_duration: node.rune_duration },
    { description_zh: rawNode.description_zh, rune_value1: rune.Value1, rune_value2: rune.Value2, rune_duration: rune.Duration },
    "canonical raw fields must remain identical to the client snapshot"
  );

  const rendered = Object.fromEntries(Object.entries(templates).map(([locale, template]) => [
    locale,
    formatGameText(template, node, 1)
  ]));
  assert.match(rendered["zh-tw"], /旋轉週期縮短<strong>0\.5<\/strong>秒，效果最多持續<strong>5<\/strong>秒/);
  assert.match(rendered.en, /rotation interval by <strong>0\.5<\/strong> sec; the effect lasts up to <strong>5<\/strong> sec/);
  assert.match(rendered.ja, /回転間隔を<strong>0\.5<\/strong>秒短縮し、効果は最大<strong>5<\/strong>秒間持続/);
  assert.match(rendered.ko, /회전 주기를 <strong>0\.5<\/strong>초 줄이며, 효과는 최대 <strong>5<\/strong>초 동안 지속됩니다/);
  assert.ok(!Object.values(rendered).some((value) => /持續時間|Duration 5|持続時間|지속 시간/.test(value)), "the semantic wording must not reintroduce a generic duration label");
});

test("game_text: GT-03 DICE 攻擊力與攻速佔位符替換", () => {
  const node = {
    node_type: "DICE",
    dice_attack: "120",
    dice_attack_interval: "0.8"
  };
  const template = "攻擊力 {0}，攻擊間隔 {1} 秒";
  const res = formatGameText(template, node, 1);
  assert.ok(res.includes("<strong>120</strong>"));
  assert.ok(res.includes("<strong>0.8</strong>"));
});

test("game_text: GT-04 滿級綠色增量文案隱藏", () => {
  const node = {
    node_type: "PLAYER_PASSIVE",
    passive_value: "10",
    passive_rank_add: "1.5",
    max_rank: 10
  };
  const template = "暴擊傷害增加 {0}% <color=green>(+{1}%)</color>";

  // Rank 10 滿級時，不應包含綠色增量
  const resMax = formatGameText(template, node, 10);
  assert.ok(resMax.includes("<strong>23.5</strong>"));
  assert.ok(!resMax.includes("stat-green-add"));
  assert.ok(!resMax.includes("(+1.5%)"));
});

test("game_text: GT-05 單階無升級節點綠色增量隱藏", () => {
  const node = {
    node_type: "PLAYER_PASSIVE",
    passive_value: "50",
    max_rank: 1
  };
  const template = "固定效果 {0} <color=green>(+0%)</color>";
  const res = formatGameText(template, node, 1);
  assert.ok(!res.includes("stat-green-add"));
});

test("game_text: GT-06 & GT-07 遊戲標籤轉譯與未知標籤回退", () => {
  const template = "發動 <tag>BURN</tag> 與 <tag>UNKNOWN_CODE</tag> 效果";
  const res = formatGameText(template, null, 1);

  assert.ok(res.includes('data-tag-key="BURN"'));
  assert.ok(res.includes("燙傷"));
  assert.ok(res.includes('data-tag-key="UNKNOWN_CODE"'));
  assert.ok(res.includes("UNKNOWN_CODE"));
});

test("game_text: supplied tag definitions drive localized labels", () => {
  const tagDefinitions = {
    POISON: {
      name_zh: "毒素",
      desc_zh: "每1秒造成與子彈傷害等比的傷害"
    }
  };
  const res = formatGameText("套用 <tag>POISON</tag>", null, 1, { tagDefinitions });

  assert.ok(res.includes('data-tag-key="POISON"'));
  assert.ok(res.includes(">毒素</u>"));
  assert.ok(!res.includes("中毒"));
});

test("game_text: GT-08 純字串 XSS 惡意腳本注入消毒 (0 DOM 依賴)", () => {
  const malicious = '<script>alert("xss")</script><img src=x onerror=alert(1)><strong>安全加粗</strong><a href="javascript:void(0)">連結</a>';
  const sanitized = sanitizeGameMarkup(malicious);

  assert.ok(!sanitized.includes("<script>"));
  assert.ok(!sanitized.includes("onerror"));
  assert.ok(!sanitized.includes("<img"));
  assert.ok(!sanitized.includes("<a"));
  assert.ok(sanitized.includes("<strong>安全加粗</strong>"));
});

test("game_text: GT-09 HTML 實體解析與換行符號規整", () => {
  const raw = "第一行<br/>第二行 &amp; &lt;第三行&gt;";
  const res = formatGameText(raw, null, 1);
  assert.ok(res.includes("第一行 第二行"));
  assert.ok(res.includes("&"));
});

test("game_text: GT-10 resolveGameText 純文字搜尋版本解析", () => {
  const node = {
    node_type: "PLAYER_PASSIVE",
    passive_value: "10",
    passive_rank_add: "2"
  };
  const raw = "賦予 <tag>BURN</tag> 效果，傷害增加 {0}% {1}";
  const plainText = resolveGameText(raw, node);

  assert.equal(plainText, "賦予 燙傷 效果，傷害增加 10% (+2%)");
  assert.ok(!plainText.includes("<"));
  assert.ok(!plainText.includes(">"));
});
