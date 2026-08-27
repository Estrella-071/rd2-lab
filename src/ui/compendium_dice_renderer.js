import { formatGameText, escapeHtml } from "../domain/game_text.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";
import { FACTION_DATA } from "../domain/faction_data.js";
import { installImageFallbacks } from "./image_fallback.js";
import { translate } from "./compendium_utils.js";

/**
 * Render dice collections and their full or compact cards.
 */
export function renderDice(compendium) {
  const state = compendium.store.getState();
  const allDice = Array.from(state.nodesMap.values()).filter((n) => (n.node_type || n.type) === "DICE");

  const q = compendium.search.trim().toLowerCase();
  let matchedDice = allDice.filter((node) => {
    const matchBranch = compendium.branch === "all" || String(node.faction || node.branch) === String(compendium.branch);
    const name = (node.name_zh || node.name || "").toLowerCase();
    const desc = (node.description_zh || node.desc || "").toLowerCase();
    const matchSearch = !q || name.includes(q) || desc.includes(q);
    return matchBranch && matchSearch;
  });

  // Sorting
  if (compendium.sort === "damage-desc") {
    matchedDice.sort((a, b) => (Number.parseFloat(b.dice_attack) || 0) - (Number.parseFloat(a.dice_attack) || 0));
  } else if (compendium.sort === "speed-asc") {
    matchedDice.sort((a, b) => (Number.parseFloat(a.dice_attack_interval) || 999) - (Number.parseFloat(b.dice_attack_interval) || 999));
  } else if (compendium.sort === "name-asc") {
    matchedDice.sort((a, b) => (a.name_zh || a.name || "").localeCompare(b.name_zh || b.name || "", "zh-Hant"));
  }

  if (compendium.countBadge) {
    compendium.countBadge.textContent = translate(compendium, "compendium.countDice", { count: matchedDice.length }, `${matchedDice.length} dice`);
  }

  if (matchedDice.length === 0) {
    if (compendium.emptyEl) compendium.emptyEl.hidden = false;
    return;
  }
  if (compendium.emptyEl) compendium.emptyEl.hidden = true;

  const isGrid = compendium.viewMode === "grid";
  const isFilteredOrSorted = Boolean(q || compendium.sort !== "default" || compendium.branch !== "all");

  if (isFilteredOrSorted || isGrid) {
    const grid = document.createElement("div");
    grid.className = isGrid ? "compendium-compact-grid" : "compendium-grid";

    matchedDice.forEach((node, idx) => {
      if (isGrid) {
        const item = compendium._createCompactDiceItem(node, idx);
        grid.appendChild(item);
      } else {
        const card = compendium._createDiceCard(node, idx);
        grid.appendChild(card);
      }
    });

    compendium.sectionsWrap.appendChild(grid);
  } else {
    // Group by faction.
    const branchMeta = [
      { id: 1, color: "#8ae665" },
      { id: 2, color: "#f9da67" },
      { id: 3, color: "#4591f0" },
      { id: 4, color: "#9c97bc" },
      { id: 5, color: "#aa3cea" },
    ];

    branchMeta.forEach((b) => {
      const branchDice = matchedDice.filter((n) => Number(n.faction || n.branch) === b.id);
      if (branchDice.length === 0) return;

      const factionName = translate(compendium, `faction.${b.id}`, {}, `Faction ${b.id}`);
      const sectionName = translate(compendium, "compendium.faction", { name: factionName }, `${factionName} faction`);
      const section = document.createElement("section");
      section.className = "compendium-branch-section";
      section.setAttribute("aria-label", sectionName);

      const header = document.createElement("header");
      header.className = "branch-section-header";
      header.innerHTML = `
        <div class="branch-section-title-wrap">
          <h3 class="branch-section-title">
            <span style="display:inline-block; width:4px; height:18px; border-radius:2px; background:${b.color}; margin-right:8px; vertical-align:middle;"></span>${escapeHtml(sectionName)}
          </h3>
          <span class="branch-section-count">${escapeHtml(translate(compendium, "compendium.factionCount", { count: branchDice.length }, `${branchDice.length} dice`))}</span>
        </div>
      `;
      section.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "compendium-grid";
      branchDice.forEach((node, idx) => {
        const card = compendium._createDiceCard(node, idx);
        grid.appendChild(card);
      });
      section.appendChild(grid);
      compendium.sectionsWrap.appendChild(section);
    });
  }
}


export function createDiceCard(compendium, node, index = 0) {
  const card = document.createElement("article");
  card.className = "compendium-card node-tooltip is-dice-node";
  card.style.animationDelay = `${Math.min(300, index * 25)}ms`;

  const fData = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
  card.style.setProperty("--node-faction", fData.color);
  card.style.setProperty("--node-faction-surface", fData.surface);
  card.style.setProperty("--node-faction-border", fData.border);
  card.style.setProperty("--node-faction-ink", fData.ink);

  // Header
  const header = document.createElement("div");
  header.className = "tooltip-header";

  const heading = document.createElement("div");
  heading.className = "tooltip-heading";
  const title = document.createElement("h3");
  title.className = "tooltip-title";
  title.textContent = node.name_zh || node.name || translate(compendium, "simulation.diceFallback", {}, "Dice");

  const badges = document.createElement("div");
  badges.className = "tooltip-badges";
  badges.innerHTML = `
    <span class="badge branch-badge">${escapeHtml(translate(compendium, `faction.${node.faction || node.branch}`, {}, fData.name))}</span>
    <span class="badge type-badge">${escapeHtml(translate(compendium, "node.type.dice", {}, "Dice"))}</span>
  `;

  const locateBtn = document.createElement("button");
  locateBtn.className = "card-locate-btn";
  locateBtn.type = "button";
  locateBtn.title = translate(compendium, "compendium.locate", {}, "Locate on map");
  locateBtn.setAttribute("aria-label", translate(compendium, "compendium.locateNamed", { name: node.name_zh || node.name }, `Locate ${node.name_zh || node.name} on the map`));
  locateBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line></svg>`;
  locateBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    compendium.close(node.id);
  });
  badges.appendChild(locateBtn);

  heading.append(title, badges);
  header.appendChild(heading);

  const iconFilename = resolveNode3Icon(node);
  if (iconFilename) {
    const visual = document.createElement("div");
    visual.className = "tooltip-dice-visual";
    const img = document.createElement("img");
    img.className = "tooltip-dice-img";
    img.src = `icons/${iconFilename}`;
    img.alt = node.name_zh || node.name || translate(compendium, "tooltip.diceIcon", {}, "Dice icon");
    visual.appendChild(img);
    header.appendChild(visual);
  }
  card.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "tooltip-body";

  // Description
  const descText = node.description_zh || node.desc || "";
  if (descText) {
    const sec = document.createElement("div");
    sec.className = "detail-section";
    const p = document.createElement("p");
    p.className = "detail-copy";
    p.innerHTML = formatGameText(descText, node.params || node, 1, { tagDefinitions: compendium.tagDefinitions });
    sec.appendChild(p);
    body.appendChild(sec);
  }

  // Stats Grid
  const divider = document.createElement("hr");
  divider.className = "tooltip-divider";
  body.appendChild(divider);

  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";

  const attackLabel = translate(compendium, "stats.attack", {}, "Attack");
  const attackSpeedLabel = translate(compendium, "stats.attackSpeed", {}, "Attack speed");
  const targetLabel = translate(compendium, "stats.target", {}, "Target");
  const targetValue = node.dice_target_zh || translate(compendium, "target.front", {}, "Front");

  // Attack
  grid.innerHTML += `
    <div class="dice-stat-item">
      <div class="dice-stat-icon-box"><img src="icons/Attack_Icon.png" alt="${escapeHtml(attackLabel)}" /></div>
      <div class="dice-stat-text">
        <span class="dice-stat-label">${escapeHtml(attackLabel)}</span>
        <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(node.dice_attack || "0")}</span></span>
      </div>
    </div>
    <div class="dice-stat-item">
      <div class="dice-stat-icon-box"><img src="icons/attackspeed_icon.png" alt="${escapeHtml(attackSpeedLabel)}" /></div>
      <div class="dice-stat-text">
        <span class="dice-stat-label">${escapeHtml(attackSpeedLabel)}</span>
        <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(node.dice_attack_interval || "0")}</span></span>
      </div>
    </div>
    <div class="dice-stat-item">
      <div class="dice-stat-icon-box"><img src="icons/targetingtype_icon.png" alt="${escapeHtml(targetLabel)}" /></div>
      <div class="dice-stat-text">
        <span class="dice-stat-label">${escapeHtml(targetLabel)}</span>
        <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(targetValue)}</span></span>
      </div>
    </div>
  `;

  if (Array.isArray(node.special_stats)) {
    node.special_stats.forEach((st) => {
      const iconName = ((/^[A-Za-z0-9_.-]+\.png$/.test(st.icon || '') ? st.icon : 'Attack_Icon.png') || 'Attack_Icon.png').replace(/^icons\//, '');
      const labelClean = st.label ? String(st.label).replace(/^zh-tw[:_]?/i, "") : translate(compendium, "stats.special", {}, "Special stat");
      const item = document.createElement("div");
      item.className = "dice-stat-item";
      item.innerHTML = `
        <div class="dice-stat-icon-box"><img src="icons/${iconName}" alt="${escapeHtml(labelClean)}" data-fallback-src="icons/Attack_Icon.png" /></div>
        <div class="dice-stat-text">
          <span class="dice-stat-label">${escapeHtml(labelClean)}</span>
          <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(st.value)}</span></span>
        </div>
      `;
      grid.appendChild(item);
    });
  }
  body.appendChild(grid);

  // Linked Runes (3 Companion Runes, exact companion layout)
  const linkedRunes = compendium._getLinkedRunes(node);
  if (linkedRunes.length > 0) {
    const runesSec = document.createElement("div");
    runesSec.className = "compendium-runes-section";

    const runesTitle = document.createElement("span");
    runesTitle.className = "section-label";
    runesTitle.textContent = translate(compendium, "compendium.specialEffects", {}, "Exclusive effects");
    runesSec.appendChild(runesTitle);

    const runesList = document.createElement("div");
    runesList.className = "compendium-rune-list";

    linkedRunes.forEach((rune) => {
      const item = document.createElement("div");
      item.className = "compendium-rune-item";

      let curRuneRank = 1;
      const runeMaxRank = Number(rune.max_rank || rune.max_level) || 1;
      const isRankable = runeMaxRank > 1;

      const descP = document.createElement("p");
      descP.className = "compendium-rune-desc detail-copy";
      descP.innerHTML = formatGameText(rune.description_zh || rune.desc || "", rune.params || rune, curRuneRank, { tagDefinitions: compendium.tagDefinitions });
      item.appendChild(descP);

      if (isRankable) {
        item.classList.add("is-rankable");

        const rankBtn = document.createElement("button");
        rankBtn.className = "rune-rank-badge-btn";
        rankBtn.type = "button";
        rankBtn.title = translate(compendium, "compendium.adjustLevel", {}, "Click to adjust level");
        rankBtn.setAttribute("aria-label", translate(compendium, "compendium.adjustRune", { name: rune.name_zh || rune.name }, `Adjust ${rune.name_zh || rune.name} level`));
        rankBtn.textContent = `Lv.${curRuneRank}/${runeMaxRank}`;

        const popover = document.createElement("div");
        popover.className = "rune-slider-popover";
        popover.hidden = true;

        popover.innerHTML = `
          <div class="popover-header">
            <span class="popover-title">${escapeHtml(rune.name_zh || rune.name || "")}</span>
            <span class="popover-rank-val">1/${runeMaxRank}</span>
          </div>
          <div class="popover-slider-wrap rank-slider-wrap">
            <input class="rank-slider-input" type="range" min="1" max="${runeMaxRank}" value="1" step="1" aria-label="${escapeHtml(translate(compendium, "compendium.rankSlider", {}, "Level slider"))}" />
          </div>
        `;

        const popoverRankVal = popover.querySelector(".popover-rank-val");
        const sliderInput = popover.querySelector(".rank-slider-input");

        compendium._attachElasticSlider(sliderInput, {
          maxRank: runeMaxRank,
          onUpdate: (rank) => {
            curRuneRank = rank;
            rankBtn.textContent = `Lv.${rank}/${runeMaxRank}`;
            if (popoverRankVal) popoverRankVal.textContent = `${rank}/${runeMaxRank}`;
            descP.innerHTML = formatGameText(rune.description_zh || rune.desc || "", rune.params || rune, rank, { tagDefinitions: compendium.tagDefinitions });
          },
        });

        rankBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          document.querySelectorAll(".rune-slider-popover:not([hidden])").forEach((p) => {
            if (p !== popover) p.hidden = true;
          });
          popover.hidden = !popover.hidden;
        });

        popover.addEventListener("click", (e) => e.stopPropagation());

        item.appendChild(rankBtn);
        item.appendChild(popover);
      }

      runesList.appendChild(item);
    });

    runesSec.appendChild(runesList);
    body.appendChild(runesSec);
  }

  card.appendChild(body);
  installImageFallbacks(card);
  return card;
}


export function createCompactDiceItem(compendium, node, index = 0) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "compendium-compact-item";
  item.dataset.nodeId = String(node.id);
  item.style.animationDelay = `${Math.min(300, index * 20)}ms`;
  item.setAttribute("aria-label", translate(compendium, "compendium.details", { name: node.name_zh || node.name }, `View details for ${node.name_zh || node.name}`));

  const fData = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
  if (typeof item.style?.setProperty === "function") {
    item.style.setProperty("--node-faction", fData.color);
  }

  const slot = document.createElement("div");
  slot.className = "compact-dice-slot";

  const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
  const img = document.createElement("img");
  img.className = "compact-dice-img";
  img.src = `icons/${iconFilename}`;
  img.alt = node.name_zh || node.name || translate(compendium, "simulation.diceFallback", {}, "Dice");
  img.loading = "lazy";
  slot.appendChild(img);

  const label = document.createElement("span");
  label.className = "compact-dice-label";
  const cleanName = (node.name_zh || node.name || "").replace(/骰子$/, "");
  label.textContent = cleanName;

  item.appendChild(slot);
  item.appendChild(label);

  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = compendium._createDiceCard(node, 0);
    compendium.openCompactModal(card, e.currentTarget);
  });

  installImageFallbacks(item);
  return item;
}


export function getLinkedRunes(compendium, diceNode) {
  const state = compendium.store.getState();
  const diceName = diceNode.dice_type || diceNode.name_zh || diceNode.name;
  const allRunes = Array.from(state.nodesMap.values()).filter((n) => (n.node_type || n.type) === "DICE_RUNE");
  return allRunes.filter((r) => r.rune_dice === diceName || r.dice_type === diceName);
}
