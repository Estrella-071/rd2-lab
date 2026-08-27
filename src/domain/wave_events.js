/**
 * @fileoverview 戰術波次事件與科技樹心智圖純領域模組
 * @module domain/wave_events
 */

/**
 * 戰術波次事件過濾 (支援字串 mode 或物件 filters)
 *
 * @param {Object[]} events
 * @param {string|Object} [filterOrMode="all"]
 * @returns {Object[]}
 */
export function filterWaveEvents(events, filterOrMode = "all") {
  if (!Array.isArray(events)) return [];

  if (typeof filterOrMode === "string") {
    if (filterOrMode === "coop") {
      return events.filter((e) => e?.mode_flags?.coop !== false);
    }
    if (filterOrMode === "versus") {
      return events.filter((e) => e?.mode_flags?.versus !== false);
    }
    return [...events];
  }

  const { phase, eventMode, search } = filterOrMode || {};
  let result = [...events];

  if (eventMode === "coop") {
    result = result.filter((e) => e?.mode_flags?.coop !== false);
  } else if (eventMode === "versus") {
    result = result.filter((e) => e?.mode_flags?.versus !== false);
  }

  if (phase && phase !== "all") {
    result = result.filter((e) => e?.phase === phase);
  }

  if (search && typeof search === "string" && search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter((e) => {
      const nameZh = (e?.name_zh || "").toLowerCase();
      const nameEn = (e?.name_en || "").toLowerCase();
      const descZh = (e?.desc_zh || "").toLowerCase();
      const coopDesc = (e?.mode_desc_coop_zh || "").toLowerCase();
      const vsDesc = (e?.mode_desc_versus_zh || "").toLowerCase();
      const kind = (e?.eventKind || "").toLowerCase();
      return nameZh.includes(q) || nameEn.includes(q) || descZh.includes(q) || coopDesc.includes(q) || vsDesc.includes(q) || kind.includes(q);
    });
  }

  return result;
}

/**
 * 解析事件在指定模式下的描述文字
 *
 * @param {Object} event
 * @param {"coop"|"versus"} [mode="coop"]
 * @returns {string}
 */
export function resolveEventDescription(event, mode = "coop") {
  if (!event) return "戰術事件效果";
  if (mode === "coop" && event.mode_desc_coop_zh) {
    return event.mode_desc_coop_zh;
  }
  if (mode === "versus" && event.mode_desc_versus_zh) {
    return event.mode_desc_versus_zh;
  }
  return event.desc_zh || event.desc_en || "戰術事件效果";
}

export const getEventDescription = resolveEventDescription;

/**
 * 解析事件的合作與競技時長文案
 *
 * @param {Object} event
 * @returns {{ coopDuration: string, versusDuration: string }}
 */
export function resolveEventDurations(event) {
  if (!event) {
    return { coopDuration: "-", versusDuration: "-" };
  }
  const coopDuration = event.coop_time || (event.mode_flags?.coop === false ? "-" : "立即生效");
  const versusDuration = event.versus_time || (event.mode_flags?.versus === false ? "-" : "立即生效");
  return { coopDuration, versusDuration };
}

/**
 * 解析事件持續時間標籤 (純函式)
 *
 * @param {Object} event
 * @param {"coop"|"versus"} [mode="coop"]
 * @returns {string}
 */
export function getEventDurationLabel(event, mode = "coop") {
  if (!event) return "-";
  if (mode === "coop" && event.mode_flags?.coop === false) return "-";
  if (mode === "versus" && event.mode_flags?.versus === false) return "-";

  if (event.timing_type === "single_trigger") return "觸發 1 次";
  if (event.timing_type === "passive") return "永久";

  if (mode === "coop" && event.coop_time) return event.coop_time;
  if (mode === "versus" && event.versus_time) return event.versus_time;

  if (event.timing_type === "instant") return "立即生效";
  return "立即生效";
}

/**
 * 判定是否為「選擇由我決定」科技樹事件
 *
 * @param {Object} event
 * @returns {boolean}
 */
export function isAugmentSystemEvent(event) {
  return Boolean(
    event?.eventKind === "AugmentSystem" &&
    Array.isArray(event?.augment_choices) &&
    event.augment_choices.length > 0
  );
}

/**
 * 生成 1-to-3 心智圖分支資料模型 (純資料物件，零 DOM)
 *
 * @param {Object} event
 * @param {"coop"|"versus"} [mode="coop"]
 * @returns {Object}
 */
export function generateAugmentTreeStructure(event, mode = "coop") {
  const choices = Array.isArray(event?.augment_choices) ? event.augment_choices : [];
  const { coopDuration, versusDuration } = resolveEventDurations(event);
  const description = resolveEventDescription(event, mode);

  const mainCard = {
    nameZh: event?.name_zh || "選擇由我決定",
    nameEn: event?.name_en || "AugmentSystem",
    icon: event?.icon || "icon_AugmentSystem.png",
    description,
    coopDuration,
    versusDuration
  };

  const branches = choices.map((choice) => ({
    nameZh: choice.name_zh,
    nameEn: choice.name_en,
    descZh: choice.desc_zh,
    icon: choice.icon || "icon_TacticalEffect.png"
  }));

  return {
    isAugment: true,
    isAugmentTree: true,
    eventKind: event?.eventKind || "AugmentSystem",
    mainEvent: mainCard,
    mainCard,
    choices: branches,
    branches,
    connector: {
      viewBox: "0 0 48 200",
      startPoint: { x: 0, y: 100, r: 4.5 },
      endPoints: [
        { x: 48, y: 33.3, r: 3.5 },
        { x: 48, y: 100, r: 3.5 },
        { x: 48, y: 166.7, r: 3.5 }
      ],
      pathD: "M 0 100 C 24 100, 24 33.3, 48 33.3 M 0 100 H 48 M 0 100 C 24 100, 24 166.7, 48 166.7"
    }
  };
}

export const buildAugmentMindmapData = generateAugmentTreeStructure;
export const buildAugmentMindmapTree = generateAugmentTreeStructure;

/**
 * 依階段取得主題色
 * @param {string} phase - "Early" | "Mid" | "Late"
 * @returns {string}
 */
export function getPhaseColor(phase) {
  if (phase === "Early") return "#68d391";
  if (phase === "Mid") return "#f6ad55";
  return "#fc8181";
}
