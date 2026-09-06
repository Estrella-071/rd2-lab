import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyRiftTactic, RIFT_SHOP_CATEGORIES } from "../../src/domain/rift_shop_categories.js";

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
