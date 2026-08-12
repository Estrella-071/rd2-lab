import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { calculateFullDiceBonus } from "../../src/domain/dice_bonus.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tree = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "data", "dice_tree.json"), "utf8"));
const compendium = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "boss_event_data.json"), "utf8"));
const locales = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "data", "locales.json"), "utf8"));
const lineage = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "raw_snapshot_1.0.3.json"), "utf8"));

function byId(items) {
  return new Map((items || []).map((item) => [String(item?.stat_id || item?.id), item]));
}

function assertNoAbsolutePaths(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoAbsolutePaths);
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") assert.equal(/^[A-Za-z]:[\\/]|^\//.test(value), false);
    return;
  }
  Object.values(value).forEach(assertNoAbsolutePaths);
}

test("raw pipeline: frozen lineage is complete, version-bound, and path-redacted", () => {
  assert.equal(lineage.schema_version, 1);
  assert.equal(lineage.snapshot_id, "random-dice-2-1.0.3");
  assert.match(lineage.source.source_identity_sha256, /^[A-Fa-f0-9]{64}$/);
  assert.equal(lineage.source.version, "1.0.3");
  assert.equal(lineage.source.source_count, 4255);
  assert.equal(lineage.projection.tree.nodes.length, 239);
  assert.equal(lineage.projection.tree.edges.length, 248);
  assert.equal(lineage.unlock_supplements.topology_corrections.length, 2);
  assert.deepEqual(
    lineage.unlock_supplements.topology_corrections.map((entry) => `${entry.from_node_id}->${entry.to_node_id}`),
    ["5007->5006", "5009->5008"]
  );
  assert.equal(Object.keys(lineage.projection.tables).length, 13);
  assert.equal(lineage.projection.localization.count, 2157);
  assert.equal(lineage.projection.localization.complete_count, 2129);
  assert.equal(Object.keys(lineage.canonical_expectations).length, 239);
  assert.equal(lineage.compendium_expectations.monster_types.length, 17);
  assert.equal(lineage.compendium_expectations.monsters.length, 15);
  assert.equal(lineage.compendium_expectations.modes.coop.waves.length, 80);
  assert.equal(lineage.compendium_expectations.modes.hunt.rewards.length, 30);
  assert.equal(lineage.compendium_expectations.modes.versus.trophy_base_hp.length, 20);
  assert.equal(lineage.compendium_expectations.modes.versus.wave_profiles.length, 11);
  assert.equal(lineage.compendium_expectations.events.length, 55);
  assertNoAbsolutePaths(lineage);
});

test("raw pipeline: every published dice stat has stable raw identity and both axes match", () => {
  const dice = tree.nodes.filter((node) => node.node_type === "DICE");
  assert.equal(dice.length, 41);
  for (const node of dice) {
    const base = byId(node.special_stats);
    const powerup = byId(node.powerup_data?.special_stats);
    const dot = byId(node.dot_data?.special_stats);
    assert.equal(base.size, node.special_stats.length, `${node.id} has duplicate base stat IDs`);
    assert.deepEqual([...base.keys()], [...powerup.keys()], `${node.id} power-up stat IDs drifted`);
    assert.deepEqual([...base.keys()], [...dot.keys()], `${node.id} dot stat IDs drifted`);
    for (const stat of node.special_stats) {
      assert.match(stat.stat_id, /^[A-Za-z0-9_.:-]+$/);
      assert.match(stat.label_key, /^[A-Za-z0-9_.-]+$/);
      assert.equal(stat.raw_source.field.length > 0, true);
      assert.equal(stat.raw_source.label_key, stat.label_key);
    }
  }
  const ray = tree.nodes.find((node) => node.id === "2009");
  assert.equal(ray.powerup_data.special_stats[0].add, "+225");
  assert.equal(ray.dot_data.special_stats[0].add, "+150");
  const shuriken = tree.nodes.find((node) => node.id === "3003");
  assert.equal(shuriken.powerup_data.special_stats.find((stat) => stat.label_key === "diceskill_Shuriken_name").add, "+500");
  assert.equal(shuriken.dot_data.special_stats.find((stat) => stat.label_key === "diceskill_Shuriken_castcnt").add, "+1");
  assert.equal(tree.nodes.find((node) => node.id === "4001").special_stats.length, 0);

  const iron = tree.nodes.find((node) => node.id === "2001");
  const ironBossMultiplier = iron.special_stats.find((stat) => stat.stat_id === "DefenderTable:Iron:BossAttackPer");
  assert.deepEqual(ironBossMultiplier, {
    stat_id: "DefenderTable:Iron:BossAttackPer",
    label_key: "stats.bossDamageMultiplier",
    label: "首領傷害倍率",
    value: "200%",
    unit: "%",
    icon: "Attack_Icon.png",
    raw_source: {
      table: "DefenderTable",
      key: "Iron",
      field: "BossAttackPer",
      label_key: "stats.bossDamageMultiplier",
      base: "200",
      powerup: "50",
      dot: ""
    }
  });
  assert.equal(iron.powerup_data.special_stats.find((stat) => stat.stat_id === ironBossMultiplier.stat_id).add, "+50");
  assert.equal(iron.dot_data.special_stats.find((stat) => stat.stat_id === ironBossMultiplier.stat_id).add, "");
  assert.equal(locales.ui["stats.bossDamageMultiplier"].en, "Boss damage multiplier");
  assert.equal(locales.content.nodes["2001"].specialStats.includes("stats.bossDamageMultiplier"), true);
  const rawIron = lineage.projection.tables.DefenderTable.records.find((row) => row.DefenderType === "Iron");
  assert.equal(rawIron.BossAttackPer, "200");
  assert.equal(rawIron.BossAttackPer_UpAdd, "50");
  const projectedBossMultipliers = dice.flatMap((node) => node.special_stats)
    .filter((stat) => stat.stat_id.endsWith(":BossAttackPer"));
  assert.deepEqual(projectedBossMultipliers.map((stat) => stat.stat_id), ["DefenderTable:Iron:BossAttackPer"]);
});

test("raw pipeline: canonical expectations cover every generated node", () => {
  for (const node of tree.nodes) {
    const expected = lineage.canonical_expectations[node.id];
    assert.ok(expected, `missing lineage expectation for ${node.id}`);
    const rawFields = { ...expected.raw_fields };
    if (expected.unlock_supplement) delete rawFields.unlock_condition_value;
    if (expected.unlock_cost_policy) {
      for (const field of ["gold_costs", "core_costs", "unlock_gold", "unlock_core", "total_gold", "total_core"]) delete rawFields[field];
    }
    for (const [field, value] of Object.entries(rawFields)) assert.deepEqual(node[field], value, `${node.id}.${field}`);
    if (expected.unlock_supplement) {
      assert.equal(node.unlock_condition_key, expected.unlock_supplement.key);
      assert.equal(node.unlock_condition_label_zh, expected.unlock_supplement.label_zh);
      assert.equal(node.unlock_condition_value, expected.unlock_supplement.value);
      assert.deepEqual(node.unlock_condition_evidence, expected.unlock_supplement.evidence);
    }
    if (expected.unlock_cost_policy) assert.deepEqual(node.unlock_cost_policy, expected.unlock_cost_policy);
    if (expected.special_stats) assert.deepEqual(node.special_stats, expected.special_stats, `${node.id}.special_stats`);
  }
});

test("raw pipeline: compendium values and countdown axes remain raw-backed", () => {
  assert.equal(compendium.raw_lineage.snapshot_id, "random-dice-2-1.0.3");
  assert.equal(compendium.monster_types.length, 17);
  assert.equal(compendium.modes.coop.waves.length, 80);
  assert.equal(compendium.modes.hunt.rewards.length, 30);
  assert.equal(compendium.modes.versus.trophy_base_hp.length, 20);
  assert.equal(compendium.modes.versus.wave_profiles.length, 11);
  assert.equal(compendium.events.length, 55);
  const expectedVersusSeconds = new Map([[14, 50], [16, 55], [17, 40], [24, 30], [25, 30], [29, 30], [31, 40], [32, 50], [33, 30], [34, 55], [41, 40], [42, 55], [43, 50], [44, 30], [45, 40], [47, 50], [48, 40], [49, 40], [57, 50], [62, 40]]);
  for (const [index, seconds] of expectedVersusSeconds) {
    assert.equal(compendium.events.find((event) => event.index === index)?.versus_seconds, seconds, `event ${index}`);
  }
});

test("raw pipeline: unlock supplements and resource-free policy stay explicit", () => {
  const byNode = new Map(tree.nodes.map((node) => [String(node.id), node]));
  const resourceFreeIds = ["1001", "1005", "1007", "2001", "3001", "4008", "5006", "5008"];
  for (const id of resourceFreeIds) {
    const node = byNode.get(id);
    assert.deepEqual(node.gold_costs, [], `${id} gold costs must be empty`);
    assert.deepEqual(node.core_costs, [], `${id} core costs must be empty`);
    assert.equal(node.unlock_gold, 0, `${id} unlock gold must be zero`);
    assert.equal(node.unlock_core, 0, `${id} unlock core must be zero`);
    assert.equal(node.total_gold, 0, `${id} total gold must be zero`);
    assert.equal(node.total_core, 0, `${id} total core must be zero`);
    assert.equal(node.unlock_cost_policy.policy, "resource_free");
  }
  const rawByNode = new Map(lineage.projection.tree.nodes.map((node) => [String(node.id), node]));
  assert.deepEqual(rawByNode.get("1001").core_costs, [5]);
  assert.deepEqual(rawByNode.get("4008").core_costs, [8]);
  const supplements = new Map(lineage.unlock_supplements.entries.map((entry) => [entry.node_id, entry]));
  assert.deepEqual(
    ["4008", "5006", "5008", "5002"].map((id) => supplements.get(id).value),
    ["700", "2100", "300", "900"]
  );
  assert.equal(supplements.get("4008").raw_value, "");
  assert.equal(supplements.get("5002").raw_value, "900");
  assert.equal(lineage.unlock_supplements.resource_free_nodes.length, 8);
});

test("raw pipeline: reward-granted secondary dice are effective topology roots", () => {
  const rawEdges = new Set(lineage.projection.tree.edges.map((edge) => `${edge.from}->${edge.to}`));
  const effectiveEdges = new Set(tree.edges.map((edge) => `${edge.from}->${edge.to}`));
  const corrections = new Set(["5007->5006", "5009->5008"]);
  assert.equal(rawEdges.size, 248);
  assert.equal(effectiveEdges.size, 246);
  assert.deepEqual(
    [...effectiveEdges].toSorted(),
    [...rawEdges].filter((key) => !corrections.has(key)).toSorted()
  );

  const canonicalById = new Map(tree.nodes.map((node) => [String(node.id), node]));
  const rawById = new Map(lineage.projection.tree.nodes.map((node) => [String(node.id), node]));
  for (const [sourceId, targetId] of [["5007", "5006"], ["5009", "5008"]]) {
    assert.equal(canonicalById.get(targetId).incoming.length, 0);
    assert.equal(canonicalById.get(sourceId).next_nodes.includes(targetId), false);
    assert.equal(rawById.get(targetId).incoming.includes(sourceId), true);
    assert.equal(rawById.get(sourceId).next_nodes.includes(targetId), true);
  }
  for (const node of tree.nodes) {
    for (const targetId of node.next_nodes) {
      assert.equal(canonicalById.get(String(targetId)).incoming.includes(node.id), true, `${node.id}->${targetId}`);
    }
  }
});

test("raw pipeline: Predator targets use within-range wording and Punch charge stays in seconds", () => {
  const predatorNodes = tree.nodes.filter((node) => node.dice_type === "Predator" || node.rune_dice === "Predator");
  assert.equal(predatorNodes.length, 4);
  assert.deepEqual(new Set(predatorNodes.map((node) => node.dice_target_zh)), new Set(["範圍內"]));

  const punch = tree.nodes.find((node) => node.id === "4003");
  assert.equal(punch.name_zh, "審判骰子");
  const punchInterval = punch.special_stats.find((stat) => stat.stat_id === "DefenderSkillTable:Punch:Interval");
  assert.equal(punchInterval.value, "10s");
  assert.equal(punchInterval.unit, "s");
  assert.equal(punchInterval.raw_source.base, "10");
  assert.equal(punchInterval.raw_source.dot, "1");
  const rawPunch = lineage.projection.tables.DefenderSkillTable.records.find((row) => row.Kind === "Punch");
  assert.equal(rawPunch.Interval, "10");
  assert.equal(rawPunch.Interval_LvAdd, "1");
  assert.equal(rawPunch.Local_Interval, "diceskill_Punch_interval");
  assert.deepEqual(locales.source.target_rangefront, {
    "zh-tw": "範圍內",
    en: "Within range",
    ja: "範囲内",
    ko: "범위 내"
  });
});

test("raw pipeline: Flower Bloom one-shot window is generated as a 60-second duration", () => {
  const flower = tree.nodes.find((node) => node.id === "1003");
  const bloomDuration = flower.special_stats.find((stat) => stat.stat_id === "DefenderSkillTable:Flower:Interval");
  assert.deepEqual(bloomDuration, {
    stat_id: "DefenderSkillTable:Flower:Interval",
    label_key: "stats.bloomDuration",
    label: "綻放持續時間",
    value: "60s",
    unit: "s",
    icon: "Attack_Icon.png",
    raw_source: {
      table: "DefenderSkillTable",
      key: "Flower",
      field: "Interval",
      label_key: "stats.bloomDuration",
      base: "60",
      powerup: "",
      dot: ""
    }
  });
  assert.equal(flower.powerup_data.special_stats[0].add, "");
  assert.equal(flower.dot_data.special_stats[0].add, "");
  assert.equal(locales.ui["stats.bloomDuration"].en, "Bloom duration");

  const rawFlowerSkill = lineage.projection.tables.DefenderSkillTable.records.find((row) => row.Kind === "Flower");
  assert.equal(rawFlowerSkill.Duration, "");
  assert.equal(rawFlowerSkill.Interval, "60");
  const rawFlowerSevenSkill = lineage.projection.tables.DefenderSkillTable.records.find((row) => row.Kind === "FlowerSeven");
  assert.equal(rawFlowerSevenSkill.Interval, "10");
  assert.equal(flower.special_stats.some((stat) => stat.stat_id.includes("FlowerSeven")), false);
});

test("raw pipeline: 1.0.3 notice disables exactly three tactics in co-op", () => {
  const expected = new Map([
    ["RandomTypeChange", "勢力戰"],
    ["TopRowDiceChange", "頂樓"],
    ["RandomDiceNoAttack", "和平主義者"]
  ]);
  for (const [kind, name] of expected) {
    const event = compendium.events.find((candidate) => candidate.eventKind === kind);
    assert.equal(event.name_zh, name);
    assert.equal(event.mode_flags.coop, false);
    assert.equal(event.coop_time, null);
    assert.equal(event.coop_seconds, 0);
    assert.deepEqual(event.coop_wave_refs, []);
  }
  assert.equal(lineage.source.official_notice.entries.length, 3);
  assert.equal(lineage.source.official_notice.version, "1.0.3");
});

test("raw pipeline: stat identity keeps four-locale axes aligned after reordering", () => {
  const state = calculateFullDiceBonus({
    dice_attack_interval: "1",
    special_stats: [
      { stat_id: "a", label_key: "stat_a", unit: "s" },
      { stat_id: "b", label_key: "stat_b", unit: "%" }
    ],
    powerup_data: {
      attack_add: "",
      interval_add: "",
      special_stats: [
        { stat_id: "b", add: "+2", unit: "%" },
        { stat_id: "a", add: "+3", unit: "s" }
      ]
    },
    dot_data: {
      attack_add: "",
      interval_add: "",
      special_stats: [
        { stat_id: "b", add: "+5", unit: "%" },
        { stat_id: "a", add: "+7", unit: "s" }
      ]
    }
  }, 2, 3);
  assert.deepEqual(state.specialStatsBonus.map((item) => item.stat_id), ["a", "b"]);
  assert.equal(state.specialStatsBonus[0].powerupBonus, "+6");
  assert.equal(state.specialStatsBonus[0].dotBonus, "+21");
  assert.equal(state.specialStatsBonus[0].powerupDisplay, " (+6s)");
  assert.equal(state.specialStatsBonus[1].powerupBonus, "+4");
  assert.equal(state.specialStatsBonus[1].dotBonus, "+15");
  assert.equal(state.specialStatsBonus[1].dotDisplay, " (+15%)");
});
