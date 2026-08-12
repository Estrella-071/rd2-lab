/**
 * Shared faction presentation data.
 *
 * The values are immutable domain data so views can consume them without
 * importing another view module.
 */
export const FACTION_DATA = Object.freeze({
  1: Object.freeze({ name: "自然", color: "#8ae665", surface: "rgba(126, 227, 82, 0.14)", border: "rgba(126, 227, 82, 0.35)", ink: "#071203" }),
  2: Object.freeze({ name: "工學", color: "#f9da67", surface: "rgba(245, 211, 88, 0.14)", border: "rgba(245, 211, 88, 0.35)", ink: "#140d02" }),
  3: Object.freeze({ name: "魔法", color: "#4591f0", surface: "rgba(93, 160, 255, 0.14)", border: "rgba(93, 160, 255, 0.35)", ink: "#030c18" }),
  4: Object.freeze({ name: "秩序", color: "#9c97bc", surface: "rgba(186, 166, 224, 0.14)", border: "rgba(186, 166, 224, 0.35)", ink: "#11091a" }),
  5: Object.freeze({ name: "渾沌", color: "#aa3cea", surface: "rgba(203, 101, 255, 0.14)", border: "rgba(203, 101, 255, 0.35)", ink: "#14031a" })
});
