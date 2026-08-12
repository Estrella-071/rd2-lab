import { formatGameText, escapeHtml } from "../domain/game_text.js";
import { calculateFullDiceBonus, POWERUP_LABELS, DOT_LABELS } from "../domain/dice_bonus.js";

export function appendAwakeningSection(view, container, node, currentRank = 1) {
  const awakenText = node.dice_awaken || node.awaken_desc || "";
  if (!awakenText) return;

  const section = document.createElement("div");
  section.className = "detail-section";
  const label = document.createElement("span");
  label.className = "section-label";
  label.textContent = view._t("tooltip.awakening", {}, "Awakening effect");
  const paragraph = document.createElement("p");
  paragraph.className = "detail-copy";
  paragraph.innerHTML = formatGameText(awakenText, node.params || node, currentRank, { tagDefinitions: view.tagDefinitions });
  section.append(label, paragraph);
  container.append(section);
}

function createCombinedBonusButton(className, label, ariaLabel, index) {
  const indexAttribute = index === undefined ? "" : ` data-index="${index}"`;
  return `<button type="button" class="stat-bonus-val stat-bonus-combined ${className}" data-bonus-label="${escapeHtml(label)}" aria-label="${escapeHtml(ariaLabel)}" aria-controls="stat-bonus-popover" aria-expanded="false"${indexAttribute} hidden></button>`;
}

function createDiceStatItem(iconName, label, value, bonusMarkup = "") {
  const item = document.createElement("div");
  item.className = "dice-stat-item";
  item.innerHTML = `
    <div class="dice-stat-icon-box">
      <img src="icons/${iconName}" alt="${escapeHtml(label)}" />
    </div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(label)}</span>
      <span class="dice-stat-val">
        <span class="stat-base-val">${escapeHtml(value)}</span>
        ${bonusMarkup}
      </span>
    </div>
  `;
  return item;
}

function normalizeStatIcon(icon) {
  const candidate = /^[A-Za-z0-9_.-]+\.png$/.test(icon || "") ? icon : "Attack_Icon.png";
  return candidate.replace(/^icons\//, "");
}

function createSpecialStatItem(stat, index, bonusAriaLabel) {
  const item = document.createElement("div");
  item.className = "dice-stat-item";
  const iconName = normalizeStatIcon(stat.icon);
  item.innerHTML = `
    <div class="dice-stat-icon-box">
      <img src="icons/${iconName}" alt="${escapeHtml(stat.label)}" data-fallback-src="icons/Attack_Icon.png" />
    </div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(stat.label)}</span>
      <span class="dice-stat-val">
        <span class="stat-base-val">${escapeHtml(stat.value)}</span>
        <span class="stat-bonus-val is-gold dice-stat-bonus-special-powerup" data-index="${index}" hidden></span>
        <span class="stat-bonus-val is-purple dice-stat-bonus-special-dot" data-index="${index}" hidden></span>
        ${createCombinedBonusButton("dice-stat-bonus-special-combined", stat.label, bonusAriaLabel, index)}
      </span>
    </div>
  `;
  return item;
}

export function appendDiceStats(view, container, node) {
  const divider = document.createElement("hr");
  divider.className = "tooltip-divider";
  container.append(divider);

  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";
  const attackLabel = view._t("stats.attack", {}, "Attack");
  const speedLabel = view._t("stats.attackSpeed", {}, "Attack speed");
  const targetLabel = view._t("stats.target", {}, "Target");
  const bonusAriaLabel = (label) => view._t(
    "tooltip.bonusDetails",
    { label },
    `View ${label} bonus details`
  );
  grid.append(
    createDiceStatItem(
      "Attack_Icon.png",
      attackLabel,
      node.dice_attack || "0",
      `<span class="stat-bonus-val is-gold dice-stat-bonus-atk-powerup" hidden></span><span class="stat-bonus-val is-purple dice-stat-bonus-atk-dot" hidden></span>${createCombinedBonusButton("dice-stat-bonus-atk-combined", attackLabel, bonusAriaLabel(attackLabel))}`
    ),
    createDiceStatItem(
      "attackspeed_icon.png",
      speedLabel,
      node.dice_attack_interval || "0",
      `<span class="stat-bonus-val is-gold dice-stat-bonus-spd-powerup" hidden></span><span class="stat-bonus-val is-purple dice-stat-bonus-spd-dot" hidden></span>${createCombinedBonusButton("dice-stat-bonus-spd-combined", speedLabel, bonusAriaLabel(speedLabel))}`
    ),
    createDiceStatItem("targetingtype_icon.png", targetLabel, node.dice_target_zh || view._t("target.front", {}, "Front"))
  );

  if (Array.isArray(node.special_stats)) {
    node.special_stats.forEach((stat, index) => grid.append(createSpecialStatItem(stat, index, bonusAriaLabel(stat.label))));
  }
  container.append(grid);

  const buttonRow = document.createElement("div");
  buttonRow.className = "dice-upgrade-action-bar dice-upgrade-btns-row";
  buttonRow.innerHTML = `
    <button type="button" class="dice-upgrade-btn btn-powerup" data-mode="powerup">${escapeHtml(view._t("tooltip.powerup", {}, "Power up"))}</button>
    <button type="button" class="dice-upgrade-btn btn-dot" data-mode="dot">${escapeHtml(view._t("tooltip.dot", {}, "Increase pips"))}</button>
  `;
  container.append(buttonRow);
  bindDiceUpgradeButtons(view, buttonRow, node, container);
}

function setBonusElement(element, display, active) {
  if (!element) return;
  element.textContent = display;
  element.hidden = !active;
}

function setCombinedBonusElement(element, bonus, view) {
  if (!element) return;
  const active = Boolean(bonus?.combinedBonus);
  element.textContent = bonus?.combinedDisplay || "";
  element.hidden = !active;
  element.dataset.powerupValue = bonus?.powerupBonus || "";
  element.dataset.dotValue = bonus?.dotBonus || "";
  element.dataset.bonusUnit = bonus?.unit || "";
  const label = element.dataset.bonusLabel || "";
  element.setAttribute(
    "aria-label",
    view._t("tooltip.bonusDetails", { label }, `View ${label} bonus details`)
  );
  if (!active) element.setAttribute("aria-expanded", "false");
}

function updateBonusPairElements(container, selectors, bonus, view) {
  const combinedActive = Boolean(bonus?.combinedBonus);
  setBonusElement(
    container.querySelector(selectors.powerup),
    bonus?.powerupDisplay || "",
    Boolean(bonus?.powerupBonus) && !combinedActive
  );
  setBonusElement(
    container.querySelector(selectors.dot),
    bonus?.dotDisplay || "",
    Boolean(bonus?.dotBonus) && !combinedActive
  );
  setCombinedBonusElement(container.querySelector(selectors.combined), bonus, view);
}

function updateSpecialBonusElements(container, specialStats, view) {
  container.querySelectorAll(".dice-stat-bonus-special-powerup").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    const bonus = specialStats[index];
    setBonusElement(
      element,
      bonus?.powerupDisplay || "",
      Boolean(bonus?.powerupBonus) && !bonus?.combinedBonus
    );
  });
  container.querySelectorAll(".dice-stat-bonus-special-dot").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    const bonus = specialStats[index];
    setBonusElement(
      element,
      bonus?.dotDisplay || "",
      Boolean(bonus?.dotBonus) && !bonus?.combinedBonus
    );
  });
  container.querySelectorAll(".dice-stat-bonus-special-combined").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    setCombinedBonusElement(element, specialStats[index], view);
  });
}

function updateDiceBonusStats(view, container, bonusState) {
  updateBonusPairElements(
    container,
    {
      powerup: ".dice-stat-bonus-atk-powerup",
      dot: ".dice-stat-bonus-atk-dot",
      combined: ".dice-stat-bonus-atk-combined"
    },
    bonusState.attackBonus,
    view
  );
  updateBonusPairElements(
    container,
    {
      powerup: ".dice-stat-bonus-spd-powerup",
      dot: ".dice-stat-bonus-spd-dot",
      combined: ".dice-stat-bonus-spd-combined"
    },
    bonusState.intervalBonus,
    view
  );
  updateSpecialBonusElements(container, bonusState.specialStatsBonus, view);
}

function upgradeButtonLabels(view, buttons, bonusState) {
  const { powerupBtn, dotBtn } = buttons;
  const dotLabel = bonusState.dotIdx === 0
    ? view._t("tooltip.dot", {}, "Increase pips")
    : String(bonusState.dotIdx + 1);
  dotBtn.textContent = dotLabel;
  dotBtn.classList.toggle("is-active", bonusState.isDotActive);

  let powerupLabel = String(bonusState.powerupIdx + 1);
  if (bonusState.powerupIdx === 0) powerupLabel = view._t("tooltip.powerup", {}, "Power up");
  if (bonusState.powerupIdx >= POWERUP_LABELS.length - 1) powerupLabel = view._t("stats.max", {}, "Max");
  powerupBtn.textContent = powerupLabel;
  powerupBtn.classList.toggle("is-active", bonusState.isPowerupActive);
}

function applyUpgradeButtonState(view, buttons, node, container, powerupIdx, dotIdx) {
  const bonusState = calculateFullDiceBonus(node, powerupIdx, dotIdx);
  upgradeButtonLabels(view, buttons, bonusState);
  updateDiceBonusStats(view, container, bonusState);
}

export function bindDiceUpgradeButtons(view, btnRow, node, container) {
  const powerupBtn = btnRow.querySelector(".btn-powerup");
  const dotBtn = btnRow.querySelector(".btn-dot");
  if (!powerupBtn || !dotBtn) return;

  let dotIdx = 0;
  let powerupIdx = 0;
  const buttons = { powerupBtn, dotBtn };
  const updateStats = () => applyUpgradeButtonState(view, buttons, node, container, powerupIdx, dotIdx);

  powerupBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    powerupIdx = (powerupIdx + 1) % POWERUP_LABELS.length;
    updateStats();
  });

  dotBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dotIdx = (dotIdx + 1) % DOT_LABELS.length;
    updateStats();
  });
}
