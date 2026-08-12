import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCoopSp,
  calculateMonsterCoopSp,
  calculateVersusSp,
  calculateMonsterVersusSp,
  calculateMonsterSp,
  getCoopStageInfo,
  getVersusStageInfo,
  describeMonsterSp,
  resolveMonsterSpDisplay,
  resolveMonsterSpPer,
  COOP_SP_STAGES,
  COOP_NORMAL_SP,
  VERSUS_SP_STAGES,
  VERSUS_NORMAL_SP,
  COOP_STAGE_COUNT,
  VERSUS_STAGE_COUNT
} from "../../src/domain/monster_sp.js";

test("monster_sp: 常數定義與階級總數", () => {
  assert.equal(COOP_STAGE_COUNT, 7);
  assert.equal(VERSUS_STAGE_COUNT, 11);
  assert.deepEqual(COOP_SP_STAGES, [1, 11, 21, 31, 46, 56, 65]);
  assert.deepEqual(COOP_NORMAL_SP, [20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual(VERSUS_SP_STAGES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(VERSUS_NORMAL_SP, [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
});

test("monster_sp: MS-01 合作模式 7 階普通怪 SP 掉落序列", () => {
  const drops1Based = [1, 2, 3, 4, 5, 6, 7].map((r) => calculateCoopSp(r, 100));
  assert.deepEqual(drops1Based, [20, 30, 40, 50, 60, 70, 80]);

  const dropsAlias = [1, 2, 3, 4, 5, 6, 7].map((r) => calculateMonsterCoopSp(r, 100));
  assert.deepEqual(dropsAlias, [20, 30, 40, 50, 60, 70, 80]);
});

test("monster_sp: MS-02 & MS-03 合作模式比例係數 (50% 與 200%)", () => {
  const drops50 = [1, 2, 3, 4, 5, 6, 7].map((r) => calculateCoopSp(r, 50));
  assert.deepEqual(drops50, [10, 15, 20, 25, 30, 35, 40]);

  const drops200 = [1, 2, 3, 4, 5, 6, 7].map((r) => calculateCoopSp(r, 200));
  assert.deepEqual(drops200, [40, 60, 80, 100, 120, 140, 160]);
});

test("monster_sp: MS-04 合作模式 Boss 怪物 10 倍 SP 掉落", () => {
  const bossDrops = [1, 2, 3, 4, 5, 6, 7].map((r) => calculateCoopSp(r, 1000));
  assert.deepEqual(bossDrops, [200, 300, 400, 500, 600, 700, 800]);
});

test("monster_sp: MS-05 競技模式 11 回合普通怪 SP 掉落序列", () => {
  const drops1Based = Array.from({ length: 11 }, (_, i) => i + 1).map((r) => calculateVersusSp(r, 100));
  assert.deepEqual(drops1Based, [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);

  const dropsAlias = Array.from({ length: 11 }, (_, i) => i + 1).map((r) => calculateMonsterVersusSp(r, 100));
  assert.deepEqual(dropsAlias, [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
});

test("monster_sp: MS-06 競技模式 Boss 怪物 10 倍 SP 掉落", () => {
  const bossVersus = Array.from({ length: 11 }, (_, i) => i + 1).map((r) => calculateVersusSp(r, 1000));
  assert.deepEqual(bossVersus, [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300]);
});

test("monster_sp: MS-07 BOX 怪物特殊呈現解析", () => {
  const boxMonster = { id: "monster_box", subType: "BOX" };
  const desc = describeMonsterSp(boxMonster, "coop");
  assert.equal(desc.isBox, true);
  assert.equal(desc.isRankable, false);
  assert.equal(desc.initialDisplay, "依效果");
  assert.equal(desc.note, "由轉移／貪婪效果決定");

  const resolved = resolveMonsterSpDisplay(boxMonster, "coop", 3);
  assert.equal(resolved.displayValue, "依效果");
  assert.equal(resolved.isSpecial, true);
});

test("monster_sp: MS-08 SP 魔像描述與呈現轉接", () => {
  const golemMonster = { id: "monster_14", subType: "GOLEM" };
  const desc = describeMonsterSp(golemMonster, "coop");
  assert.equal(desc.isGolem, true);
  assert.equal(desc.isRankable, true);
  assert.equal(desc.rankCount, 30);
  assert.equal(desc.initialDisplay, "500 SP");

  const resolvedRank25 = resolveMonsterSpDisplay(golemMonster, "coop", 25);
  assert.equal(resolvedRank25.displayValue, "10,000 SP");
});

test("monster_sp: MS-09 階段詳細資訊與邊界防護", () => {
  const coopInfo4 = getCoopStageInfo(4, 100);
  assert.equal(coopInfo4.rank, 4);
  assert.equal(coopInfo4.spValue, 50);
  assert.equal(coopInfo4.displayValue, "50 SP");
  assert.equal(coopInfo4.stageLabel, "4/7");
  assert.equal(coopInfo4.startWaveOrRound, 31);

  const vsInfo11 = getVersusStageInfo(11, 100);
  assert.equal(vsInfo11.rank, 11);
  assert.equal(vsInfo11.spValue, 30);
  assert.equal(vsInfo11.displayValue, "30 SP");
  assert.equal(vsInfo11.stageLabel, "11/11");
  assert.equal(vsInfo11.startWaveOrRound, 11);
});

test("monster_sp: MS-10 resolveMonsterSpPer 係數解析", () => {
  assert.equal(resolveMonsterSpPer({ sp_per: 150 }), 150);
  assert.equal(resolveMonsterSpPer({ subType: "BOSS" }), 1000);
  assert.equal(resolveMonsterSpPer({ category: "BOSS" }), 1000);
  assert.equal(resolveMonsterSpPer({ subType: "NORMAL" }), 100);
  assert.equal(resolveMonsterSpPer(null), 100);
});
