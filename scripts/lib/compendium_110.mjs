const number = (value) => value === "" || value == null ? null : Number(value);
const label = (raw, key, locale) => raw.localization.entries[key]?.[locale] || "";

export function prepareCompendium110(current, raw) {
  const result = structuredClone(current);
  for (const row of raw.tables.MinionTable.records) {
    const id = Number(row.Id);
    const icon = `Icon_${row.BossType === "Assassin_Hard" ? "Meteor_Hard" : row.BossType}.png`;
    if (!result.monster_types.some((item) => item.id === id)) {
      result.monster_types.push({ id, icon, visual_id: `boss_${id}`, visible_in_compendium: true, visual_status: "source_icon" });
    }
    if (id < 18 || result.monsters.some((item) => item.id === `boss_${id}`)) continue;
    result.monsters.push({
      id: `boss_${id}`, category: "BOSS", subType: "BOSS", subType_zh: "首領怪物",
      bossType: row.BossType, difficulty: "hard", icon,
      name_zh: label(raw, row.Local_Name, "zh-tw"), name_en: label(raw, row.Local_Name, "en"),
      desc_zh: label(raw, row.Local_Desc, "zh-tw"), desc_en: label(raw, row.Local_Desc, "en"),
      speed: number(row.BaseMoveSpeed), sp_gain_base: null, hp_percent: number(row.BossHpPer),
      hp_display_zh: `${row.BossHpPer}%`, sp_display_zh: "依合作波次",
      sp_note_zh: null, hp_note_zh: null,
      skill_parameters: Object.fromEntries(["InitInterval", "SkillInterval", "CastingTime", "MaxSkillCount", "TargetCount", "Value1", "Value2", "Value3", "Value4"].map((key) => [key, number(row[key])]))
    });
  }
  result.rift_shop = raw.tables.TacticsEffectTable.records.filter((row) => row.Store === "True").map((row) => ({
    id: `rift_${row.Index}`, kind: row.TacticsKind, name_key: row.Local_Name, description_key: row.Local_Desc,
    names: Object.fromEntries(["zh-tw", "en", "ja", "ko"].map((locale) => [locale, label(raw, row.Local_Name, locale)])),
    descriptions: Object.fromEntries(["zh-tw", "en", "ja", "ko"].map((locale) => [locale, label(raw, row.Local_Desc, locale)])),
    cost: number(row.Cost), grade: row.TacticGrade, target: row.TacticApplyTarget,
    values: [0, 1, 2, 3].map((i) => number(row[`Value_${i}`])),
    // Store availability is separate from ordinary event Use.
    ordinary_event_enabled: row.Use === "True"
  }));
  result.meta.game_data_version = "1.1.0";
  result.meta.snapshot = { ...result.meta.snapshot, snapshot_id: "random-dice-2-1.1.0", verified_at: "2026-09-05" };
  result.meta.scope_zh = "Random Dice 2 1.1.0 客戶端資料快照；困難模式與裂縫商店分別保留。即時平衡與執行期公式以遊戲內顯示為準。";
  return result;
}
