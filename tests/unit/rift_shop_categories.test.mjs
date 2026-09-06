import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyRiftTactic, RIFT_SHOP_CATEGORIES, mergeRiftShopItems } from "../../src/domain/rift_shop_categories.js";

test("rift_shop_categories - 完整覆蓋 55 筆裂縫商店戰術並正確分類", () => {
  const data = JSON.parse(fs.readFileSync(new URL("../../site/boss_event_data.json", import.meta.url), "utf8"));
  const riftItems = data.rift_shop || [];

  assert.equal(riftItems.length, 55, "裂縫商店應包含 55 筆資料");

  const counts = { damage: 0, sp: 0, board: 0, field: 0 };
  const unclassified = [];

  for (const item of riftItems) {
    const category = classifyRiftTactic(item.kind);
    if (!counts[category]) {
      counts[category] = 0;
    }
    counts[category]++;
  }

  assert.equal(counts.damage, 17, "增傷效果應為 17 筆 (含女王寶座)");
  assert.equal(counts.sp, 11, "SP效果應為 11 筆");
  assert.equal(counts.board, 17, "骰盤效果應為 17 筆");
  assert.equal(counts.field, 10, "場地效果應為 10 筆");
  assert.equal(counts.damage + counts.sp + counts.board + counts.field, 55, "總計應為 55 筆");
});

test("rift_shop_categories - 女王寶座 (QueensSeatBuff) 必須為增傷效果", () => {
  assert.equal(classifyRiftTactic("QueensSeatBuff"), "damage");
});

test("rift_shop_categories - RIFT_SHOP_CATEGORIES 定義包含四大分類", () => {
  assert.equal(RIFT_SHOP_CATEGORIES.length, 4);
  const keys = RIFT_SHOP_CATEGORIES.map(c => c.key);
  assert.deepEqual(keys, ["damage", "sp", "board", "field"]);
});

test("rift_shop_categories - mergeRiftShopItems 將 55 筆裂縫項目精準合併為 35 筆聚合效果", () => {
  const data = JSON.parse(fs.readFileSync(new URL("../../site/boss_event_data.json", import.meta.url), "utf8"));
  const riftItems = data.rift_shop || [];

  const merged = mergeRiftShopItems(riftItems);
  assert.equal(merged.length, 35, "55 筆裂縫效果合併後應為 35 組聚合效果");

  // 驗證三階效果：強化彈
  const bullet = merged.find(m => m.baseKind === "FieldAttackUp");
  assert.ok(bullet, "應包含強化彈聚合項目");
  assert.deepEqual(bullet.grades, ["Common", "Rare", "Legendary"]);
  assert.equal(bullet.costText, "30 / 70 / 100");
  assert.equal(bullet.isMerged, true);
  assert.equal(bullet.getMergedDescription("zh-tw"), "子彈攻擊力增加10 / 20 / 30%");

  // 驗證三階效果：支援金 (千分位 format)
  const spGrant = merged.find(m => m.baseKind === "GainNSp");
  assert.ok(spGrant, "應包含支援金聚合項目");
  assert.deepEqual(spGrant.grades, ["Common", "Rare", "Legendary"]);
  assert.equal(spGrant.costText, "30 / 70 / 100");
  assert.equal(spGrant.isMerged, true);
  assert.equal(spGrant.getMergedDescription("zh-tw"), "立即獲得3,000 / 10,000 / 30,000 SP");

  // 驗證單階效果：女王寶座
  const queen = merged.find(m => m.baseKind === "QueensSeatBuff");
  assert.ok(queen, "應包含女王寶座聚合項目");
  assert.deepEqual(queen.grades, ["Legendary"]);
  assert.equal(queen.costText, "200");
  assert.equal(queen.isMerged, false);
  assert.equal(queen.getMergedDescription("zh-tw"), "女王寶座：產生賦予王位一半增益的格子");

  // 驗證單階無 values 效果：重新分配
  const swap = merged.find(m => m.baseKind === "SwapMaxMinDicePip");
  assert.ok(swap, "應包含重新分配聚合項目");
  assert.deepEqual(swap.grades, ["Rare"]);
  assert.equal(swap.costText, "70");
  assert.equal(swap.isMerged, false);
  assert.equal(swap.getMergedDescription("zh-tw"), "最高與最低骰點骰子的骰點互換");
});

