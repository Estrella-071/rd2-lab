import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateGolemStats,
  clampGolemRank,
  deriveRankFromHpPercent,
  getGolemRankFromHp,
  inferRankFromLifePercent,
  deriveRankFromSp,
  getGolemRankFromSp,
  inferRankFromCoopSp,
  inferRankFromBattleSp,
  synchronizeGolemStats,
  formatThousands,
  GOLEM_MONSTER_ID,
  GOLEM_MIN_RANK,
  GOLEM_MAX_RANK,
  GOLEM_SP_CAP_RANK,
  GOLEM_SP_CAP_VALUE
} from "../../src/domain/sp_golem.js";

test("sp_golem: 常數定義正確性", () => {
  assert.equal(GOLEM_MONSTER_ID, "monster_14");
  assert.equal(GOLEM_MIN_RANK, 1);
  assert.equal(GOLEM_MAX_RANK, 30);
  assert.equal(GOLEM_SP_CAP_RANK, 20);
  assert.equal(GOLEM_SP_CAP_VALUE, 10000);
});

test("sp_golem: formatThousands 數值格式化", () => {
  assert.equal(formatThousands(50), "50");
  assert.equal(formatThousands(500), "500");
  assert.equal(formatThousands(1000), "1,000");
  assert.equal(formatThousands(10000), "10,000");
  assert.equal(formatThousands(1250000), "1,250,000");
});

test("sp_golem: SG-01 Rank 1 初始屬性驗證", () => {
  const stats = calculateGolemStats(1);
  assert.equal(stats.rank, 1);
  assert.equal(stats.hpPercent, 50);
  assert.equal(stats.lifePercent, 50);
  assert.equal(stats.hpDisplay, "50%");
  assert.equal(stats.coopSp, 500);
  assert.equal(stats.battleSp, 500);
  assert.equal(stats.coopSpDisplay, "500 SP");
  assert.equal(stats.spDisplay, "500 SP");
  assert.equal(stats.stageLabel, "1/30");
  assert.equal(stats.isMax, false);
  assert.equal(stats.isCapped, false);
  assert.equal(stats.sliderProgressPercent, 0);
});

test("sp_golem: SG-02 線性增長區間 (Rank 10)", () => {
  const stats = calculateGolemStats(10);
  assert.equal(stats.rank, 10);
  assert.equal(stats.hpPercent, 500);
  assert.equal(stats.hpDisplay, "500%");
  assert.equal(stats.coopSp, 5000);
  assert.equal(stats.battleSp, 5000);
  assert.equal(stats.coopSpDisplay, "5,000 SP");
  assert.equal(stats.stageLabel, "10/30");
  assert.equal(stats.isCapped, false);
});

test("sp_golem: SG-03 臨界封頂前一階 (Rank 19)", () => {
  const stats = calculateGolemStats(19);
  assert.equal(stats.rank, 19);
  assert.equal(stats.hpPercent, 950);
  assert.equal(stats.coopSp, 9500);
  assert.equal(stats.battleSp, 9500);
  assert.equal(stats.coopSpDisplay, "9,500 SP");
  assert.equal(stats.stageLabel, "19/30");
  assert.equal(stats.isCapped, false);
});

test("sp_golem: SG-04 封頂起始階 (Rank 20)", () => {
  const stats = calculateGolemStats(20);
  assert.equal(stats.rank, 20);
  assert.equal(stats.hpPercent, 1000);
  assert.equal(stats.hpDisplay, "1,000%");
  assert.equal(stats.coopSp, 10000);
  assert.equal(stats.battleSp, 10000);
  assert.equal(stats.coopSpDisplay, "10,000 SP");
  assert.equal(stats.stageLabel, "20/30");
  assert.equal(stats.isCapped, true);
});

test("sp_golem: SG-05 封頂持續區間 (Rank 25)", () => {
  const stats = calculateGolemStats(25);
  assert.equal(stats.rank, 25);
  assert.equal(stats.hpPercent, 1250);
  assert.equal(stats.hpDisplay, "1,250%");
  assert.equal(stats.coopSp, 10000);
  assert.equal(stats.battleSp, 10000);
  assert.equal(stats.coopSpDisplay, "10,000 SP");
  assert.equal(stats.stageLabel, "25/30");
  assert.equal(stats.isCapped, true);
});

test("sp_golem: SG-06 滿級狀態 (Rank 30)", () => {
  const stats = calculateGolemStats(30);
  assert.equal(stats.rank, 30);
  assert.equal(stats.hpPercent, 1500);
  assert.equal(stats.hpDisplay, "1,500%");
  assert.equal(stats.coopSp, 10000);
  assert.equal(stats.battleSp, 10000);
  assert.equal(stats.coopSpDisplay, "10,000 SP");
  assert.equal(stats.stageLabel, "Max");
  assert.equal(stats.isMax, true);
  assert.equal(stats.isCapped, true);
  assert.equal(stats.sliderProgressPercent, 100);
});

test("sp_golem: SG-07 & SG-08 階級邊界夾緊與無效數值容錯", () => {
  assert.equal(clampGolemRank(0), 1);
  assert.equal(clampGolemRank(-10), 1);
  assert.equal(clampGolemRank(99), 30);
  assert.equal(clampGolemRank(NaN), 1);
  assert.equal(clampGolemRank("15"), 15);
  assert.equal(clampGolemRank(10.7), 10);
});

test("sp_golem: SG-09 生命值反向推導 Rank", () => {
  assert.equal(deriveRankFromHpPercent(50), 1);
  assert.equal(getGolemRankFromHp(500), 10);
  assert.equal(inferRankFromLifePercent(1000), 20);
  assert.equal(deriveRankFromHpPercent(1500), 30);
  assert.equal(deriveRankFromHpPercent(0), 1);
  assert.equal(deriveRankFromHpPercent(2000), 30);
});

test("sp_golem: SG-10 SP 反向推導 Rank (封頂與保持機制)", () => {
  assert.equal(deriveRankFromSp(500), 1);
  assert.equal(getGolemRankFromSp(5000), 10);
  assert.equal(inferRankFromCoopSp(9500), 19);
  assert.equal(inferRankFromBattleSp(10000), 20);
  // 當 SP=10000 且傳入 currentRank 在 20~30 區間時，應保持 currentRank
  assert.equal(deriveRankFromSp(10000, 27), 27);
  assert.equal(deriveRankFromSp(10000, 30), 30);
});

test("sp_golem: SG-11 synchronizeGolemStats 跨屬性同步協調器", () => {
  const syncFromRank = synchronizeGolemStats("rank", 15);
  assert.equal(syncFromRank.rank, 15);
  assert.equal(syncFromRank.hpPercent, 750);
  assert.equal(syncFromRank.coopSp, 7500);

  const syncFromHp = synchronizeGolemStats("hp", 1250);
  assert.equal(syncFromHp.rank, 25);
  assert.equal(syncFromHp.coopSp, 10000);

  const syncFromSp = synchronizeGolemStats("coopSp", 4000);
  assert.equal(syncFromSp.rank, 8);
  assert.equal(syncFromSp.hpPercent, 400);
});
