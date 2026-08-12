import { escapeHtml, formatGameText } from "../domain/game_text.js";
import { installImageFallbacks } from "./image_fallback.js";
import { resolveEventDuration, resolvePublicIconFilename, translate } from "./compendium_utils.js";

/**
 * Render active and historical wave-event cards and augment branches.
 */
export function renderEvents(compendium) {
  const state = compendium.store.getState();
  const bossEvents = state.bossEvents || {};
  // Removed events stay in the source snapshot as historical records and never
  // participate in current-version counts or filters.
  const events = (bossEvents.events || []).filter((e) => e.mode_flags?.use !== false && e.status !== "removed" && e.is_removed !== true);
  const historicalEvents = Array.isArray(bossEvents.historical_events)
    ? bossEvents.historical_events.filter((e) => e.status === "removed" || e.is_removed === true)
    : [];

  const q = compendium.search.trim().toLowerCase();
  const eventMode = compendium.eventMode;

  let filtered = events.filter((ev) => {
    if (eventMode === "coop" && ev.mode_flags?.coop === false) return false;
    if (eventMode === "versus" && ev.mode_flags?.versus === false) return false;
    if (!q) return true;
    return (ev.name_zh || "").toLowerCase().includes(q) ||
           (ev.name_en || "").toLowerCase().includes(q) ||
           (ev.desc_zh || "").toLowerCase().includes(q) ||
           (ev.eventKind || "").toLowerCase().includes(q) ||
           (ev.phase_zh || "").toLowerCase().includes(q);
  });
  const historicalFiltered = historicalEvents.filter((ev) => {
    if (!q) return true;
    return (ev.name_zh || "").toLowerCase().includes(q) ||
           (ev.name_en || "").toLowerCase().includes(q) ||
           (ev.desc_zh || "").toLowerCase().includes(q) ||
           (ev.eventKind || "").toLowerCase().includes(q) ||
           translate(compendium, "compendium.removedBadge", {}, "Removed").toLowerCase().includes(q);
  });

  if (compendium.countBadge) {
    compendium.countBadge.textContent = translate(compendium, "compendium.countEvents", { count: filtered.length }, `${filtered.length} events`);
  }

  if (filtered.length === 0 && historicalFiltered.length === 0) {
    if (compendium.emptyEl) compendium.emptyEl.hidden = false;
    return;
  }
  if (compendium.emptyEl) compendium.emptyEl.hidden = true;

  const isGridMode = compendium.viewMode === "grid";

  if (q) {
    if (filtered.length > 0) {
      const grid = document.createElement("div");
      grid.className = isGridMode ? "compendium-compact-grid" : "compendium-grid";
      filtered.forEach((ev, idx) => {
        if (isGridMode) {
          grid.appendChild(compendium._createEventCompactItem(ev, idx, eventMode));
        } else if (ev.eventKind === "AugmentSystem" && Array.isArray(ev.augment_choices) && ev.augment_choices.length > 0) {
          grid.appendChild(compendium._createAugmentTree(ev, idx, eventMode));
        } else {
          grid.appendChild(compendium._createEventCard(ev, idx, eventMode));
        }
      });
      compendium.sectionsWrap.appendChild(grid);
    }
    compendium._renderHistoricalEvents(historicalFiltered, eventMode);
    return;
  }

  // Default phases (retained across all event modes when not searching)
  const phases = [
    { id: "Early", key: "early", color: "#68d391" },
    { id: "Mid", key: "mid", color: "#f6ad55" },
    { id: "Late", key: "late", color: "#fc8181" }
  ];

  phases.forEach((ph) => {
    const phaseEvents = filtered.filter((e) => e.phase === ph.id);
    if (phaseEvents.length === 0) return;

    const section = document.createElement("section");
    section.className = "compendium-branch-section";
    const phaseName = translate(compendium, `compendium.phase.${ph.key}`, {}, `${ph.key} events`);
    section.setAttribute("aria-label", phaseName);

    const header = document.createElement("header");
    header.className = "branch-section-header";
    header.innerHTML = `
      <div class="branch-section-title-wrap">
        <h3 class="branch-section-title">
            <span style="display:inline-block; width:4px; height:18px; border-radius:2px; background:${ph.color}; margin-right:8px; vertical-align:middle;"></span>${escapeHtml(phaseName)}
          </h3>
          <span class="branch-section-count">${escapeHtml(translate(compendium, "compendium.countEvents", { count: phaseEvents.length }, `${phaseEvents.length} events`))}</span>
      </div>
    `;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = isGridMode ? "compendium-compact-grid" : "compendium-grid";
    phaseEvents.forEach((ev, idx) => {
      if (isGridMode) {
        grid.appendChild(compendium._createEventCompactItem(ev, idx, eventMode));
      } else if (ev.eventKind === "AugmentSystem" && Array.isArray(ev.augment_choices) && ev.augment_choices.length > 0) {
        grid.appendChild(compendium._createAugmentTree(ev, idx, eventMode));
      } else {
        grid.appendChild(compendium._createEventCard(ev, idx, eventMode));
      }
    });
    section.appendChild(grid);
    compendium.sectionsWrap.appendChild(section);
  });
  compendium._renderHistoricalEvents(historicalFiltered, eventMode);
}


export function renderHistoricalEvents(compendium, events, eventMode = "all") {
  if (!Array.isArray(events) || events.length === 0) return;
  const section = document.createElement("section");
  section.className = "compendium-branch-section compendium-history-section";
  const historyTitle = translate(compendium, "compendium.historyTitle", {}, "Historical events · removed");
  section.setAttribute("aria-label", historyTitle);
  const header = document.createElement("header");
  header.className = "branch-section-header";
  header.innerHTML = `
    <div class="branch-section-title-wrap">
      <h3 class="branch-section-title"><span class="history-section-marker" aria-hidden="true"></span>${escapeHtml(historyTitle)}</h3>
      <span class="branch-section-count">${escapeHtml(translate(compendium, "compendium.countEvents", { count: events.length }, `${events.length} events`))}</span>
    </div>
    <p class="compendium-history-note">${escapeHtml(translate(compendium, "compendium.historyNote", {}, "Names and snapshots are retained for reference and excluded from the current-version count."))}</p>
  `;
  section.appendChild(header);
  const grid = document.createElement("div");
  grid.className = compendium.viewMode === "grid" ? "compendium-compact-grid" : "compendium-grid";
  events.forEach((event, index) => {
    if (compendium.viewMode === "grid") {
      grid.appendChild(compendium._createEventCompactItem(event, index, eventMode));
    } else if (event.eventKind === "AugmentSystem" && Array.isArray(event.augment_choices) && event.augment_choices.length > 0) {
      grid.appendChild(compendium._createAugmentTree(event, index, eventMode));
    } else {
      grid.appendChild(compendium._createEventCard(event, index, eventMode));
    }
  });
  section.appendChild(grid);
  compendium.sectionsWrap.appendChild(section);
}


export function createEventCompactItem(compendium, event, index = 0, eventMode = "all") {
  const item = document.createElement("button");
  item.type = "button";
  const isRemoved = event.status === "removed" || event.is_removed === true;
  item.className = `compendium-compact-item compendium-event-compact-item${isRemoved ? " is-removed-event" : ""}`;
  item.dataset.compendiumCategory = "event";
  item.dataset.compendiumId = String(event.id ?? event.index ?? "");
  item.dataset.eventMode = eventMode;
  item.style.animationDelay = `${Math.min(index * 20, 300)}ms`;
  const prefix = isRemoved ? translate(compendium, "compendium.removedView", {}, "View removed") : translate(compendium, "common.view", {}, "View");
  item.setAttribute("aria-label", translate(compendium, "compendium.eventDetails", { prefix, name: event.name_zh || event.eventKind }, `${prefix} ${event.name_zh || event.eventKind} event details`));

  const slot = document.createElement("div");
  slot.className = "compact-dice-slot";
  let color = "#fc8181";
  if (isRemoved) color = "#7f8796";
  else if (event.phase === "Early") color = "#68d391";
  else if (event.phase === "Mid") color = "#f6ad55";
  slot.style.setProperty("--node-faction", color);

  const eventIcon = resolvePublicIconFilename(event.icon, "icon_TacticalEffect.png");
  const img = document.createElement("img");
  img.className = "compact-dice-img";
  img.src = `icons/${eventIcon}`;
  img.alt = event.name_zh || event.eventKind;
  img.loading = "lazy";
  img.decoding = "async";
  img.dataset.fallbackSrc = "icons/icon_TacticalEffect.png";
  slot.appendChild(img);

  const label = document.createElement("span");
  label.className = "compact-dice-label";
  const removedSuffix = isRemoved ? ` (${translate(compendium, "compendium.removedBadge", {}, "Removed")})` : "";
  label.textContent = `${event.display_name_zh || event.name_zh || event.eventKind}${removedSuffix}`;

  item.append(slot, label);
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const isAugmentTree = event.eventKind === "AugmentSystem" && Array.isArray(event.augment_choices) && event.augment_choices.length > 0;
    const card = isAugmentTree
      ? compendium._createAugmentTree(event, 0, eventMode)
      : compendium._createEventCard(event, 0, eventMode);
    compendium.openCompactModal(card, e.currentTarget);
    compendium.onNavigate?.({ kind: "compendium-card", category: "event", id: String(event.id ?? event.index ?? ""), eventMode });
  });
  installImageFallbacks(item);
  return item;
}


export function createEventCard(compendium, event, index = 0, eventMode = "all") {
  const card = document.createElement("article");
  const isRemoved = event.status === "removed" || event.is_removed === true;
  const phaseClass = event.phase ? `phase-${event.phase.toLowerCase()}` : "";
  card.className = `compendium-card node-tooltip is-event-card ${phaseClass}${isRemoved ? " is-removed-event" : ""}`;
  card.dataset.compendiumCategory = "event";
  card.dataset.compendiumId = String(event.id ?? event.index ?? "");
  card.dataset.eventMode = eventMode;
  card.style.animationDelay = `${Math.min(index * 25, 300)}ms`;

  const eventIcon = resolvePublicIconFilename(event.icon, "icon_TacticalEffect.png");
  const header = document.createElement("div");
  header.className = "tooltip-header";
  const showSourceName = !compendium.localization || compendium.localization.getLocale?.() === "zh-tw";
  header.innerHTML = `
    <div class="tooltip-heading">
      <h3 class="tooltip-title">${escapeHtml(event.display_name_zh || event.name_zh || event.eventKind)}${isRemoved ? ` <span class="removed-event-badge">${escapeHtml(translate(compendium, "compendium.removedBadge", {}, "Removed"))}</span>` : ""}</h3>
      ${showSourceName ? `<span class="event-en-title">${escapeHtml(event.display_name_en || event.name_en || event.eventKind)}</span>` : ""}
    </div>
    <div class="tooltip-dice-visual">
      <img class="tooltip-dice-img" src="icons/${eventIcon}" alt="${escapeHtml(event.name_zh || event.eventKind)}" data-fallback-src="icons/icon_TacticalEffect.png" />
    </div>
  `;
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "tooltip-body";

  let descText = event.desc_zh || event.desc_en || translate(compendium, "event.fallback", {}, "Tactic effect");
  if (eventMode === "coop" && event.mode_desc_coop_zh) {
    descText = event.mode_desc_coop_zh;
  } else if (eventMode === "versus" && event.mode_desc_versus_zh) {
    descText = event.mode_desc_versus_zh;
  }
  const descHtml = formatGameText(descText, null, 1, { tagDefinitions: compendium.tagDefinitions });

  body.innerHTML = `
    <div class="detail-section">
      <p class="detail-copy">${descHtml}</p>
    </div>
    ${isRemoved ? `<p class="removed-event-status">${escapeHtml(translate(compendium, "compendium.removedStatus", { last: event.last_seen_version || translate(compendium, "common.unknown", {}, "Unknown"), removed: event.removed_in_version || translate(compendium, "common.unknown", {}, "Unknown") }, "Removed · last seen in {last}; removed in {removed}"))}</p>` : ""}
    <hr class="tooltip-divider" />
  `;

  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";

  const coopDuration = resolveEventDuration(event, "coop", compendium.localization);
  const versusDuration = resolveEventDuration(event, "versus", compendium.localization);
  const coopLabel = translate(compendium, "compendium.modeCoop", {}, "Co-op");
  const versusLabel = translate(compendium, "compendium.modeVersus", {}, "Arena");

  const coopStatHtml = `
    <div class="dice-stat-item">
      <div class="dice-stat-icon-box"><img src="icons/Icon_Time.png" alt="${escapeHtml(coopLabel)}" /></div>
      <div class="dice-stat-text">
        <span class="dice-stat-label">${escapeHtml(coopLabel)}</span>
        <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(coopDuration)}</span></span>
      </div>
    </div>
  `;

  const versusStatHtml = `
    <div class="dice-stat-item">
      <div class="dice-stat-icon-box"><img src="icons/Icon_Time.png" alt="${escapeHtml(versusLabel)}" /></div>
      <div class="dice-stat-text">
        <span class="dice-stat-label">${escapeHtml(versusLabel)}</span>
        <span class="dice-stat-val"><span class="stat-base-val">${escapeHtml(versusDuration)}</span></span>
      </div>
    </div>
  `;

  if (eventMode === "coop") {
    grid.innerHTML = coopStatHtml;
  } else if (eventMode === "versus") {
    grid.innerHTML = versusStatHtml;
  } else {
    grid.innerHTML = coopStatHtml + versusStatHtml;
  }

  body.appendChild(grid);
  card.appendChild(body);
  installImageFallbacks(card);
  return card;
}


export function createAugmentTree(compendium, event, index = 0, eventMode = "all") {
  const wrap = document.createElement("div");
  wrap.className = "compendium-event-augment-tree-wrap";
  wrap.dataset.compendiumCategory = "event";
  wrap.dataset.compendiumId = String(event.id ?? event.index ?? "");
  wrap.dataset.eventMode = eventMode;
  wrap.style.animationDelay = `${Math.min(index * 25, 300)}ms`;

  const mainSlot = document.createElement("div");
  mainSlot.className = "augment-tree-main-slot";
  const mainCard = compendium._createEventCard(event, 0, eventMode);
  mainSlot.appendChild(mainCard);
  wrap.appendChild(mainSlot);

  const connector = document.createElement("div");
  connector.className = "augment-tree-connector";
  connector.setAttribute("aria-hidden", "true");
  connector.innerHTML = `
    <svg class="augment-tree-svg" preserveAspectRatio="none" viewBox="0 0 48 200">
      <path class="tree-line-bg" d="M 0 100 C 24 100, 24 33.3, 48 33.3 M 0 100 H 48 M 0 100 C 24 100, 24 166.7, 48 166.7" />
      <path class="tree-line-glow" d="M 0 100 C 24 100, 24 33.3, 48 33.3 M 0 100 H 48 M 0 100 C 24 100, 24 166.7, 48 166.7" />
      <circle class="tree-dot" cx="0" cy="100" r="4.5" />
      <circle class="tree-dot" cx="48" cy="33.3" r="3.5" />
      <circle class="tree-dot" cx="48" cy="100" r="3.5" />
      <circle class="tree-dot" cx="48" cy="166.7" r="3.5" />
    </svg>
  `;
  wrap.appendChild(connector);

  const branchesCol = document.createElement("div");
  branchesCol.className = "augment-tree-branches-col";

  const choices = event.augment_choices || [];
  choices.forEach((choice) => {
    const choiceIcon = resolvePublicIconFilename(choice.icon, "icon_TacticalEffect.png");
    const choiceName = choice.name_zh || choice.name_en || choice.key || translate(compendium, "event.fallback", {}, "Tactic effect");
    const choiceDescription = formatGameText(choice.desc_zh || choice.desc_en || "", null, 1, { tagDefinitions: compendium.tagDefinitions });
    const subCard = document.createElement("div");
    subCard.className = "augment-sub-card";
    subCard.innerHTML = `
      <div class="augment-sub-icon-box">
        <img src="icons/${choiceIcon}" alt="${escapeHtml(translate(compendium, "compendium.eventChoiceAlt", { name: choiceName }, choiceName))}" data-fallback-src="icons/icon_TacticalEffect.png" />
      </div>
      <div class="augment-sub-content">
      <div class="augment-sub-title-row">
          <span class="augment-sub-title">${escapeHtml(choiceName)}</span>
          ${(!compendium.localization || compendium.localization.getLocale?.() === "zh-tw") ? `<span class="augment-sub-en">${escapeHtml(choice.name_en || '')}</span>` : ""}
        </div>
        <p class="augment-sub-desc">${choiceDescription}</p>
      </div>
    `;
    branchesCol.appendChild(subCard);
  });

  wrap.appendChild(branchesCol);
  installImageFallbacks(wrap);
  return wrap;
}
