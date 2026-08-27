import { calculateCoopSp, calculateVersusSp, resolveMonsterSpPer } from "../domain/monster_sp.js";
import { formatThousands, calculateGolemStats } from "../domain/sp_golem.js";
import { escapeHtml, formatGameText } from "../domain/game_text.js";
import { installImageFallbacks } from "./image_fallback.js";
import { resolvePublicIconFilename, translate } from "./compendium_utils.js";

/**
 * Render monster groups, Spine presentation cards, and rankable SP statistics.
 */
export function renderMonsters(compendium) {
  const state = compendium.store.getState();
  const bossEvents = state.bossEvents || {};
  const monsters = (bossEvents.monsters || []).filter((m) => m.visible_in_compendium !== false);

  const q = compendium.search.trim().toLowerCase();
  const matched = monsters.filter((m) => {
    if (!q) return true;
    return [m.name_zh, m.name_en, m.desc_zh, m.subType_zh, m.bossType].some((v) =>
      String(v || "").toLowerCase().includes(q)
    );
  });

  if (compendium.countBadge) {
    compendium.countBadge.textContent = translate(compendium, "compendium.countMonsters", { count: matched.length }, `${matched.length} monsters`);
  }

  if (matched.length === 0) {
    if (compendium.emptyEl) compendium.emptyEl.hidden = false;
    return;
  }
  const isGridMode = compendium.viewMode === "grid";

  const groups = [
    { key: "normal", color: "#4ecdc4", filter: (m) => m.subType !== "BOSS" && m.category !== "BOSS" },
    { key: "boss", color: "#ff5277", filter: (m) => m.subType === "BOSS" || m.category === "BOSS" }
  ];

  groups.forEach((g) => {
    const groupMonsters = matched.filter(g.filter);
    if (groupMonsters.length === 0) return;

    const section = document.createElement("section");
    section.className = "compendium-branch-section";
    const groupName = translate(compendium, `compendium.monsterGroup.${g.key}`, {}, g.key === "boss" ? "Boss monsters (BOSS)" : "Normal and special monsters");
    section.setAttribute("aria-label", groupName);

    const header = document.createElement("header");
    header.className = "branch-section-header";
    header.innerHTML = `
      <div class="branch-section-title-wrap">
        <h3 class="branch-section-title">
          <span style="display:inline-block; width:4px; height:18px; border-radius:2px; background:${g.color}; margin-right:8px; vertical-align:middle;"></span>${escapeHtml(groupName)}
        </h3>
        <span class="branch-section-count">${escapeHtml(translate(compendium, "compendium.countMonsters", { count: groupMonsters.length }, `${groupMonsters.length} monsters`))}</span>
      </div>
    `;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = isGridMode ? "compendium-compact-grid" : "compendium-grid";
    groupMonsters.forEach((monster, idx) => {
      const item = isGridMode
        ? compendium._createMonsterCompactItem(monster, idx)
        : compendium._createMonsterCard(monster, idx);
      grid.appendChild(item);
    });
    section.appendChild(grid);
    compendium.sectionsWrap.appendChild(section);
  });
}


export function createMonsterCompactItem(compendium, monster, index = 0) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "compendium-compact-item compendium-monster-compact-item";
  item.style.animationDelay = `${Math.min(index * 20, 300)}ms`;
  const fallbackName = translate(compendium, "monster.normal.name", {}, "Monster");
  item.setAttribute("aria-label", translate(compendium, "compendium.details", { name: monster.name_zh || monster.bossType || fallbackName }, `View details for ${monster.name_zh || monster.bossType || fallbackName}`));

  const slot = document.createElement("div");
  slot.className = "compact-dice-slot";
  slot.style.setProperty("--node-faction", monster.subType === "BOSS" || monster.category === "BOSS" ? "#ff5277" : "#4ecdc4");

  const posterPath = resolvePublicIconFilename(monster.poster || monster.icon, "Boss_Bubble.png");
  const img = document.createElement("img");
  img.className = "compact-dice-img";
  img.src = `icons/${posterPath}`;
  img.alt = monster.name_zh || monster.bossType || fallbackName;
  img.loading = "lazy";
  img.decoding = "async";
  img.dataset.fallbackSrc = "icons/Big_minion.png";
  slot.appendChild(img);

  const label = document.createElement("span");
  label.className = "compact-dice-label";
  label.textContent = monster.name_zh || monster.bossType || fallbackName;

  item.append(slot, label);
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = compendium._createMonsterCard(monster, 0);
    compendium.openCompactModal(card, e.currentTarget);
  });
  installImageFallbacks(item);
  return item;
}

function appendGolemStats(compendium, grid, speedItem) {
  const initialStats = calculateGolemStats(1);
  const hpStageInfo = (rank) => ({
    stageLabel: rank === 30 ? translate(compendium, "stats.max", {}, "Max") : `${rank}/30`,
    value: `${formatThousands(calculateGolemStats(rank).lifePercent)}%`
  });
  const coopStageInfo = (rank) => ({
    stageLabel: rank === 30 ? translate(compendium, "stats.max", {}, "Max") : `${rank}/30`,
    value: `${formatThousands(calculateGolemStats(rank).coopSp)} SP`
  });
  const versusStageInfo = (rank) => ({
    stageLabel: rank === 30 ? translate(compendium, "stats.max", {}, "Max") : `${rank}/30`,
    value: `${formatThousands(calculateGolemStats(rank).battleSp)} SP`
  });
  const hpItem = compendium._createRankableStatItem({
    icon: "icons/Attack_Icon.png",
    label: translate(compendium, "stats.golemHp", {}, "Golem HP"),
    initialDisplay: `${formatThousands(initialStats.lifePercent)}%`,
    maxRank: 30,
    getStageInfo: hpStageInfo
  });
  const coopItem = compendium._createRankableStatItem({
    icon: "icons/Icon_Goods_SP.png",
    label: translate(compendium, "stats.spDropCoop", {}, "SP drop (Co-op)"),
    initialDisplay: `${formatThousands(initialStats.coopSp)} SP`,
    maxRank: 30,
    getStageInfo: coopStageInfo
  });
  const versusItem = compendium._createRankableStatItem({
    icon: "icons/Icon_Goods_SP.png",
    label: translate(compendium, "stats.spDropVersus", {}, "SP drop (Arena)"),
    initialDisplay: `${formatThousands(initialStats.battleSp)} SP`,
    maxRank: 30,
    getStageInfo: versusStageInfo
  });
  const synchronizedItems = [
    { item: hpItem, getStageInfo: hpStageInfo },
    { item: coopItem, getStageInfo: coopStageInfo },
    { item: versusItem, getStageInfo: versusStageInfo }
  ];
  const syncAll = (rank) => {
    for (const entry of synchronizedItems) {
      const info = entry.getStageInfo(rank);
      entry.item.update(rank, info.value, info.stageLabel);
    }
  };
  synchronizedItems.forEach(({ item }) => {
    item.onRankChange = syncAll;
  });
  grid.append(speedItem, ...synchronizedItems.map(({ item }) => item.element));
}

function getMonsterHpValue(compendium, monster) {
  if (monster?.id === "monster_14") return translate(compendium, "monster.golemHpRange", {}, "50–100%");
  if (monster.hp_percent == null) return translate(compendium, "monster.modeDataFallback", {}, "Mode-specific data");
  return `${monster.hp_percent}%`;
}

function appendStandardMonsterStats(compendium, grid, speedItem, monster, isBoss) {
  const hpLabel = isBoss
    ? translate(compendium, "stats.bossHp", {}, "Boss HP ratio")
    : translate(compendium, "stats.relativeHp", {}, "Relative HP");
  const hpItem = document.createElement("div");
  hpItem.className = "dice-stat-item";
  hpItem.innerHTML = `
    <div class="dice-stat-icon-box"><img src="icons/Attack_Icon.png" alt="${escapeHtml(hpLabel)}" /></div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(hpLabel)}</span>
      <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(getMonsterHpValue(compendium, monster))}</span></span>
    </div>
  `;

  const spPer = resolveMonsterSpPer(monster);
  const initialCoop = calculateCoopSp(1, spPer);
  const initialVs = calculateVersusSp(1, spPer);
  const coopItem = compendium._createRankableStatItem({
    icon: "icons/Icon_Goods_SP.png",
    label: translate(compendium, "stats.spDropCoop", {}, "SP drop (Co-op)"),
    initialDisplay: `${initialCoop} SP`,
    maxRank: 7,
    getStageInfo: (rank) => ({ stageLabel: `${rank}/7`, value: `${calculateCoopSp(rank, spPer)} SP` })
  });
  const versusItem = compendium._createRankableStatItem({
    icon: "icons/Icon_Goods_SP.png",
    label: translate(compendium, "stats.spDropVersus", {}, "SP drop (Arena)"),
    initialDisplay: `${initialVs} SP`,
    maxRank: 11,
    getStageInfo: (rank) => ({ stageLabel: `${rank}/11`, value: `${calculateVersusSp(rank, spPer)} SP` })
  });

  grid.append(speedItem, hpItem, coopItem.element, versusItem.element);
}

function getMonsterVisualDefinition(visualBox, monster) {
  return visualBox.__monsterVisualDefinition || (monster.spine ? { poster: monster.poster, spine: monster.spine } : null);
}

function bindMonsterSpineInteractions(compendium, card, header, monster) {
  const visualBox = header.querySelector(".monster-spine-visual");
  if (!visualBox || !compendium.spineEngine) return;

  visualBox.style.cursor = "pointer";
  visualBox.title = translate(compendium, "compendium.spineReplay", {}, "Click to replay the Spine animation");
  const triggerSpine = () => {
    const visualDefinition = getMonsterVisualDefinition(visualBox, monster);
    if (visualDefinition && !visualBox.classList.contains("is-ready")) {
      compendium.spineEngine.acquireCanvas(visualBox, visualDefinition);
    }
  };
  card.addEventListener("mouseenter", triggerSpine, { passive: true });
  card.addEventListener("focusin", triggerSpine, { passive: true });
  visualBox.addEventListener("click", (event) => {
    event.stopPropagation();
    const visualDefinition = getMonsterVisualDefinition(visualBox, monster);
    if (visualDefinition) {
      compendium.spineEngine.acquireCanvas(visualBox, visualDefinition);
    }
  });
}


export function createMonsterCard(compendium, monster, index = 0) {
  const isBoss = monster.subType === "BOSS" || monster.category === "BOSS";
  const isGolem = (monster._canonical_name_zh || monster.name_zh || "").includes("魔像") || (monster.bossType || "").includes("Golem");
  const fallbackName = translate(compendium, "monster.normal.name", {}, "Monster");
  const bossBadge = translate(compendium, "monster.subtype.boss", {}, "Boss");
  const normalBadge = translate(compendium, "monster.subtype.normal", {}, "Normal monster");
  const staticLabel = translate(compendium, "compendium.static", {}, "STATIC");

  const card = document.createElement("article");
  card.className = `compendium-card node-tooltip ${isBoss ? "is-boss-card is-boss" : "is-normal-monster"}`;
  card.style.animationDelay = `${Math.min(index * 25, 300)}ms`;

  const posterPath = resolvePublicIconFilename(monster.poster || monster.icon, "Boss_Bubble.png");

  const header = document.createElement("div");
  header.className = "tooltip-header";
  header.innerHTML = `
    <div class="tooltip-heading">
      <h3 class="tooltip-title">${escapeHtml(monster.name_zh || monster.bossType || fallbackName)}</h3>
      <div class="tooltip-badges">
        <span class="badge ${isBoss ? "boss-badge" : "normal-monster-badge"}">${escapeHtml(monster.subType_zh || (isBoss ? bossBadge : normalBadge))}</span>
        ${(!compendium.localization || compendium.localization.getLocale?.() === "zh-tw") ? `<span class="badge">${escapeHtml(monster.name_en || monster.bossType || fallbackName)}</span>` : ""}
      </div>
    </div>
    <div class="tooltip-dice-visual">
      <div class="monster-spine-visual">
        <img class="monster-spine-poster" src="icons/${posterPath}" alt="${escapeHtml(monster.name_zh || monster.name_en || fallbackName)}" loading="lazy" decoding="async" data-fallback-src="icons/Big_minion.png" />
        <canvas class="monster-spine-canvas" aria-hidden="true"></canvas>
        <span class="monster-spine-status">${escapeHtml(staticLabel)}</span>
      </div>
    </div>
  `;
  card.appendChild(header);

  const visual = header.querySelector(".monster-spine-visual");
  if (visual) {
    visual.__monsterVisualDefinition = monster.spine ? { poster: monster.poster, spine: monster.spine } : null;
    if (compendium._spineObserver && monster.spine) {
      compendium._spineObserver.observe(visual);
    }
  }

  const body = document.createElement("div");
  body.className = "tooltip-body";
  const descriptionText = monster.desc_zh || monster.desc_en || translate(compendium, "monster.normal.desc", {}, "Monster details");
  const descriptionHtml = formatGameText(descriptionText, null, 1, { tagDefinitions: compendium.tagDefinitions });
  body.innerHTML = `
    <div class="detail-section">
      <p class="detail-copy">${descriptionHtml}</p>
    </div>
    <hr class="tooltip-divider" />
  `;

  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";

  // 0. Speed
  const speedItem = document.createElement("div");
  speedItem.className = "dice-stat-item";
  const speedLabel = translate(compendium, "stats.moveSpeed", {}, "Movement speed");
  speedItem.innerHTML = `
    <div class="dice-stat-icon-box"><img src="icons/attackspeed_icon.png" alt="${escapeHtml(speedLabel)}" /></div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(speedLabel)}</span>
      <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(monster.speed ?? "—")}</span></span>
    </div>
  `;

  if (isGolem) {
    appendGolemStats(compendium, grid, speedItem);
  } else {
    appendStandardMonsterStats(compendium, grid, speedItem, monster, isBoss);
  }

  body.appendChild(grid);
  card.appendChild(body);
  installImageFallbacks(card);

  bindMonsterSpineInteractions(compendium, card, header, monster);

  return card;
}


export function createRankableStatItem(compendium, { icon, label, initialDisplay, maxRank, getStageInfo }) {
  const item = document.createElement("div");
  item.className = "dice-stat-item is-rankable-stat";

  const initialInfo = typeof getStageInfo === "function" ? getStageInfo(1) : { stageLabel: `1/${maxRank}`, value: initialDisplay };
  const initBadgeText = initialInfo.stageLabel || `1/${maxRank}`;

  item.innerHTML = `
    <div class="dice-stat-icon-box"><img src="${icon}" alt="${escapeHtml(label)}" /></div>
    <div class="dice-stat-text">
      <div class="stat-label-with-rank">
        <span class="dice-stat-label">${escapeHtml(label)}</span>
        <button type="button" class="rune-rank-badge-btn sp-rank-badge-btn" title="${escapeHtml(translate(compendium, "stats.adjustRank", { name: label }, `Adjust ${label} rank`))}">${initBadgeText}</button>
      </div>
      <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(initialDisplay)}</span></span>
    </div>
    <div class="rune-slider-popover" hidden>
      <div class="popover-header">
        <span class="popover-title">${escapeHtml(label)}</span>
        <span class="popover-rank-val">${initBadgeText}</span>
      </div>
      <div class="popover-slider-wrap rank-slider-wrap">
        <input class="rank-slider-input" type="range" min="1" max="${maxRank}" value="1" step="1" aria-label="${escapeHtml(translate(compendium, "stats.rankSlider", {}, "Rank slider"))}" />
      </div>
    </div>
  `;

  const badgeBtn = item.querySelector(".sp-rank-badge-btn");
  const popover = item.querySelector(".rune-slider-popover");
  const slider = item.querySelector(".rank-slider-input");
  const baseValEl = item.querySelector(".stat-base-val");
  const popValEl = item.querySelector(".popover-rank-val");

  badgeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = popover.hidden;
    document.querySelectorAll(".rune-slider-popover:not([hidden])").forEach((p) => (p.hidden = true));
    popover.hidden = !isHidden;
  });

  popover.addEventListener("click", (e) => e.stopPropagation());

  const handler = {
    element: item,
    onRankChange: null,
    update(rank, displayVal, stageLabel = null) {
      slider.value = String(rank);
      const percent = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
      slider.style.setProperty("--slider-pct", `${percent}%`);
      const labelText = stageLabel || (rank === maxRank && maxRank === 30 ? translate(compendium, "stats.max", {}, "Max") : `${rank}/${maxRank}`);
      badgeBtn.textContent = labelText;
      if (popValEl) popValEl.textContent = labelText;
      if (displayVal !== undefined) baseValEl.textContent = displayVal;
    }
  };

  compendium._attachElasticSlider(slider, {
    maxRank,
    onUpdate: (rank, pct) => {
      const info = typeof getStageInfo === "function" ? getStageInfo(rank) : { stageLabel: `${rank}/${maxRank}`, value: "" };
      handler.update(rank, info.value, info.stageLabel);
      if (typeof handler.onRankChange === "function") {
        handler.onRankChange(rank);
      }
    }
  });

  return handler;
}
