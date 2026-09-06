import { escapeHtml, formatGameText } from "../domain/game_text.js";
import { installImageFallbacks } from "./image_fallback.js";
import { translate } from "./compendium_utils.js";

const GRADE_DATA = Object.freeze({
  Common: {
    phase: "early",
    color: "#68d391",
    surface: "rgba(104, 211, 145, 0.14)",
    border: "rgba(104, 211, 145, 0.4)",
    names: { "zh-tw": "普通", en: "Common", ja: "一般", ko: "일반" }
  },
  Rare: {
    phase: "mid",
    color: "#4591f0",
    surface: "rgba(69, 145, 240, 0.14)",
    border: "rgba(69, 145, 240, 0.4)",
    names: { "zh-tw": "稀有", en: "Rare", ja: "レア", ko: "희귀" }
  },
  Legendary: {
    phase: "late",
    color: "#f6ad55",
    surface: "rgba(246, 173, 85, 0.14)",
    border: "rgba(246, 173, 85, 0.4)",
    names: { "zh-tw": "傳說", en: "Legendary", ja: "伝説", ko: "전설" }
  }
});

const TARGET_DATA = Object.freeze({
  Owner: { "zh-tw": "自身", en: "Self", ja: "自身", ko: "자신" },
  All: { "zh-tw": "全體", en: "All", ja: "全体", ko: "전체" },
  Team: { "zh-tw": "隊友", en: "Team", ja: "チーム", ko: "팀" }
});

function resolveTacticIconFile(kind) {
  // Client assets share the Low icon tier for Mid and High variants
  const resolvedKind = String(kind || "").replace(/(Mid|High)$/, "Low");
  const direct = `${resolvedKind}.png`;
  const fallback = "targetingtype_icon.png";
  return { direct, fallback };
}

export function createRiftCard(view, row, index = 0) {
  const locale = view.localization?.getLocale() || "zh-tw";
  const gradeMeta = GRADE_DATA[row.grade] || GRADE_DATA.Common;
  const gradeName = gradeMeta.names[locale] || gradeMeta.names["zh-tw"] || row.grade || "Common";
  const targetName = TARGET_DATA[row.target]?.[locale] || TARGET_DATA[row.target]?.["zh-tw"] || row.target || "Owner";

  const card = document.createElement("article");
  card.className = `compendium-card node-tooltip is-event-card is-rift-card phase-${gradeMeta.phase}`;
  card.dataset.compendiumCategory = "event";
  card.dataset.compendiumId = String(row.id);
  card.dataset.eventMode = "hard";
  card.style.animationDelay = `${Math.min(index * 25, 300)}ms`;
  card.style.setProperty("--node-faction", gradeMeta.color);
  card.style.setProperty("--node-faction-surface", gradeMeta.surface);
  card.style.setProperty("--node-faction-border", gradeMeta.border);

  const { direct, fallback } = resolveTacticIconFile(row.kind);
  const titleText = row.names[locale] || row.names["zh-tw"] || row.kind;

  // Header
  const header = document.createElement("div");
  header.className = "tooltip-header";
  header.innerHTML = `
    <div class="tooltip-heading">
      <h3 class="tooltip-title">${escapeHtml(titleText)}</h3>
      <div class="tooltip-badges">
        <span class="badge event-badge" style="background: ${gradeMeta.color}22 !important; border-color: ${gradeMeta.border} !important; color: ${gradeMeta.color} !important;">${escapeHtml(gradeName)}</span>
        <span class="badge normal-monster-badge">${escapeHtml(targetName)}</span>
      </div>
    </div>
    <div class="tooltip-dice-visual">
      <img class="tooltip-dice-img" src="icons/${direct}" alt="${escapeHtml(titleText)}" data-fallback-src="icons/${fallback}" />
    </div>
  `;
  card.appendChild(header);

  // Body
  const rawDesc = (row.descriptions[locale] || row.descriptions["zh-tw"] || "")
    .replace(/\{([0-3])\}/g, (token, i) => row.values[i] ?? token);
  const formattedDesc = formatGameText(rawDesc, null, 1, { tagDefinitions: view.tagDefinitions });

  const body = document.createElement("div");
  body.className = "tooltip-body";
  body.innerHTML = `
    <div class="detail-section">
      <p class="detail-copy">${formattedDesc}</p>
    </div>
    <hr class="tooltip-divider" />
  `;

  // Stats Grid
  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";

  const costLabel = translate(view, "compendium.raidCoins", {}, "Raid Coins");
  const costItem = document.createElement("div");
  costItem.className = "dice-stat-item";
  costItem.innerHTML = `
    <div class="dice-stat-icon-box"><img src="icons/Icon_Goods_SP.png" alt="${escapeHtml(costLabel)}" /></div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(costLabel)}</span>
      <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(String(row.cost ?? "—"))}</span></span>
    </div>
  `;

  const targetHeading = translate(view, "compendium.target", {}, "Target");
  const targetItem = document.createElement("div");
  targetItem.className = "dice-stat-item";
  targetItem.innerHTML = `
    <div class="dice-stat-icon-box"><img src="icons/targetingtype_icon.png" alt="${escapeHtml(targetHeading)}" /></div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(targetHeading)}</span>
      <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(targetName)}</span></span>
    </div>
  `;

  grid.append(costItem, targetItem);
  body.appendChild(grid);
  card.appendChild(body);

  installImageFallbacks(card);
  return card;
}

export function createRiftCompactItem(view, row, index = 0) {
  const locale = view.localization?.getLocale() || "zh-tw";
  const gradeMeta = GRADE_DATA[row.grade] || GRADE_DATA.Common;
  const titleText = row.names[locale] || row.names["zh-tw"] || row.kind;

  const item = document.createElement("button");
  item.type = "button";
  item.className = "compendium-compact-item compendium-event-compact-item";
  item.dataset.compendiumCategory = "event";
  item.dataset.compendiumId = String(row.id);
  item.dataset.eventMode = "hard";
  item.style.animationDelay = `${Math.min(index * 20, 300)}ms`;
  item.setAttribute("aria-label", translate(view, "compendium.details", { name: titleText }, `View details for ${titleText}`));

  const slot = document.createElement("div");
  slot.className = "compact-dice-slot";
  slot.style.setProperty("--node-faction", gradeMeta.color);

  const { direct, fallback } = resolveTacticIconFile(row.kind);
  const img = document.createElement("img");
  img.className = "compact-dice-img";
  img.src = `icons/${direct}`;
  img.alt = titleText;
  img.loading = "lazy";
  img.decoding = "async";
  img.dataset.fallbackSrc = `icons/${fallback}`;
  slot.appendChild(img);

  const label = document.createElement("span");
  label.className = "compact-dice-label";
  label.textContent = titleText;

  item.append(slot, label);
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = createRiftCard(view, row, 0);
    view.openCompactModal(card, e.currentTarget);
    view.onNavigate?.({ kind: "compendium-card", category: "event", id: String(row.id), eventMode: "hard" });
  });
  installImageFallbacks(item);
  return item;
}

export function renderRiftShop(view) {
  const mode = view.eventMode;
  if (mode !== "hard" && mode !== "all") return;

  const locale = view.localization?.getLocale() || "zh-tw";
  const query = view.search.trim().toLowerCase();
  const rows = (view.store.getState().bossEvents?.rift_shop || []).filter((row) =>
    !query || `${row.names[locale]} ${row.descriptions[locale]} ${row.kind}`.toLowerCase().includes(query)
  );

  if (mode === "hard" && view.countBadge) {
    view.countBadge.textContent = translate(view, "compendium.countEvents", { count: rows.length }, `${rows.length} events`);
  }

  if (!rows.length) {
    if (mode === "hard" && view.emptyEl) view.emptyEl.hidden = false;
    return;
  }
  if (view.emptyEl) view.emptyEl.hidden = true;

  const isGridMode = view.viewMode === "grid";

  // Group by grade
  const grades = [
    { key: "Common", meta: GRADE_DATA.Common },
    { key: "Rare", meta: GRADE_DATA.Rare },
    { key: "Legendary", meta: GRADE_DATA.Legendary }
  ];

  grades.forEach((g) => {
    const groupRows = rows.filter((r) => r.grade === g.key);
    if (groupRows.length === 0) return;

    const section = document.createElement("section");
    section.className = "compendium-branch-section";
    const gradeTitle = g.meta.names[locale] || g.meta.names["zh-tw"] || g.key;
    const sectionTitle = `${translate(view, "compendium.riftShop", {}, "Rift Shop")} · ${gradeTitle}`;
    section.setAttribute("aria-label", sectionTitle);

    const header = document.createElement("header");
    header.className = "branch-section-header";
    header.innerHTML = `
      <div class="branch-section-title-wrap">
        <h3 class="branch-section-title">
          <span style="display:inline-block; width:4px; height:18px; border-radius:2px; background:${g.meta.color}; margin-right:8px; vertical-align:middle;"></span>${escapeHtml(sectionTitle)}
        </h3>
        <span class="branch-section-count">${escapeHtml(translate(view, "compendium.countEvents", { count: groupRows.length }, `${groupRows.length} events`))}</span>
      </div>
    `;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = isGridMode ? "compendium-compact-grid" : "compendium-grid";
    groupRows.forEach((row, idx) => {
      const item = isGridMode
        ? createRiftCompactItem(view, row, idx)
        : createRiftCard(view, row, idx);
      grid.appendChild(item);
    });
    section.appendChild(grid);
    view.sectionsWrap.appendChild(section);
  });
}
