/**
 * Simulation planning mode: real browser flow for desktop and mobile.
 * This suite intentionally clicks the mode, batch confirmation, max-rank,
 * reset, share URL and fixed-size image path instead of only checking markup.
 */
import { startTestServer, createTestBrowser } from "../helpers/test_server.mjs";
import { assert, assertEqual, assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from "../helpers/test_utils.mjs";

async function armTooltipPopProbe(page) {
  await page.evaluate(() => {
    window.__tooltipPopProbe?.cleanup?.();
    const tooltip = document.getElementById("tooltip");
    if (!tooltip) {
      throw new Error("Tooltip is unavailable for the animation probe.");
    }

    const state = { detail: false, rank: false };
    const recordElement = (element, hadPopClass = false) => {
      if (!element?.matches) return;
      const hasPopClass = element.classList.contains("is-popping");
      if (!hadPopClass && !hasPopClass) return;
      state.detail ||= element.matches(".detail-copy");
      state.rank ||= element.matches("#tooltip-rank-badge, .rank-badge");
    };
    const recordState = (mutations = []) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const previousClasses = new Set((mutation.oldValue || "").split(/\s+/).filter(Boolean));
          recordElement(mutation.target, previousClasses.has("is-popping"));
        }
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          recordElement(node);
          node.querySelectorAll?.(".detail-copy.is-popping, #tooltip-rank-badge.is-popping, .rank-badge.is-popping")
            .forEach((element) => recordElement(element));
        }
      }
      state.detail ||= Boolean(tooltip.querySelector(".detail-copy.is-popping"));
      state.rank ||= Boolean(tooltip.querySelector("#tooltip-rank-badge.is-popping, .rank-badge.is-popping"));
    };
    const observer = new MutationObserver(recordState);
    observer.observe(tooltip, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
      childList: true,
      subtree: true
    });
    recordState();
    window.__tooltipPopProbe = {
      state,
      cleanup: () => observer.disconnect()
    };
  });
}

async function readTooltipPopProbe(page) {
  await page.waitForFunction(
    () => window.__tooltipPopProbe?.state.detail && window.__tooltipPopProbe?.state.rank,
    null,
    { timeout: 8000 }
  );
  const result = await page.evaluate(() => ({ ...window.__tooltipPopProbe.state }));
  await page.evaluate(() => {
    window.__tooltipPopProbe?.cleanup?.();
    delete window.__tooltipPopProbe;
  });
  return result;
}

async function selectSimulationDice(page, diceIds) {
  for (const diceId of diceIds) {
    await page.click(`#simulation-picker-grid .simulation-picker-card[data-dice-id="${diceId}"]`);
  }
}

async function closeSuiteResources(browserInstance, serverInstance) {
  await browserInstance?.close();
  await serverInstance?.close();
}

async function assertSimulationSurface(page) {
  await page.click("#simulation-toggle-btn");
  await page.waitForTimeout(220);
  const modeState = await page.evaluate(() => {
    const readIconFilters = (nodeId) => {
      const node = document.querySelector(`g.node[data-node-id="${nodeId}"]`);
      return [...(node?.querySelectorAll(".node-icon, .node-icon-flat, .node-icon-deep") || [])]
        .map((icon) => window.getComputedStyle(icon).filter);
    };
    const lockedIconFilters = readIconFilters("1201");
    const unlockedIconFilters = readIconFilters("1001");
    document.body.classList.add("is-zooming");
    const lockedMotionIconFilters = readIconFilters("1201");
    document.body.classList.remove("is-zooming");
    return {
      active: document.body.classList.contains("simulation-mode"),
      filterHidden: window.getComputedStyle(document.querySelector(".search-block")).display === "none",
      centerText: document.querySelector("#tree-center-compendium-btn .simulation-title")?.textContent.trim(),
      centerDisabled: document.getElementById("tree-center-compendium-btn")?.getAttribute("aria-disabled"),
      initialDiceVisible: ["1001", "1005", "1007", "2001", "3001"].every((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-sim-unlocked")),
      preUnlockedDiceVisible: ["4008", "5006", "5008"].every((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-sim-unlocked")),
      fearLocked: document.querySelector('g.node[data-node-id="5002"]')?.classList.contains("is-sim-locked"),
      levelGateSpecial: ["1106", "1107", "1108", "2106", "2107", "2108", "3106", "3107", "3108"].every((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-sim-special")),
      specialCount: document.querySelectorAll("g.node.is-sim-special").length,
      lockedDimmed: document.querySelector('g.node[data-node-id="1201"]')?.classList.contains("is-sim-locked"),
      lockedIconFilters,
      unlockedIconFilters,
      lockedMotionIconFilters,
      dependentBaseVisible: ["1005", "1007"].every((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-sim-unlocked"))
    };
  });
  assert(modeState.active, "simulation mode should activate");
  assert(modeState.filterHidden, "normal filters should be hidden in simulation mode");
  assertEqual(modeState.centerText, "骰子樹", "center entry should become dice-tree label");
  assertEqual(modeState.centerDisabled, "true", "center entry should be non-interactive");
  const lockedNodesStayGrayscale = modeState.lockedIconFilters.length > 0
    && modeState.lockedIconFilters.every((filter) => filter.includes("grayscale"))
    && modeState.lockedMotionIconFilters.every((filter) => filter.includes("grayscale"))
    && modeState.unlockedIconFilters.every((filter) => !filter.includes("grayscale"));
  assert(modeState.initialDiceVisible && modeState.preUnlockedDiceVisible && modeState.fearLocked && modeState.levelGateSpecial && modeState.lockedDimmed && modeState.specialCount === 9, "five base dice and three reward dice should start unlocked while level-gated milestones remain special");
  assert(lockedNodesStayGrayscale, `simulation mode should keep locked icons grayscale while unlocked icons remain colored (locked=${modeState.lockedIconFilters.join(",")}, unlocked=${modeState.unlockedIconFilters.join(",")}, motion=${modeState.lockedMotionIconFilters.join(",")})`);
  assert(modeState.dependentBaseVisible, "initial dice with prerequisites should remain available");

  const newSurfaceStyle = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = window.getComputedStyle(element);
      return {
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter,
        borderWidth: style.borderTopWidth,
        minHeight: element.getBoundingClientRect().height
      };
    };
    return {
      shareWidget: read("#simulation-share-widget"),
      version: read("#data-version-badge"),
      changelogButton: read("#changelog-open-btn")
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotionSurfaceStyle = await page.evaluate(() => [".simulation-share-widget", "#changelog-widget"].flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => ({
    selector,
    animationName: window.getComputedStyle(element).animationName
  }))));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert(
    newSurfaceStyle.shareWidget?.backgroundImage === "none"
      && newSurfaceStyle.shareWidget?.backdropFilter === "none"
      && reducedMotionSurfaceStyle.length >= 2
      && reducedMotionSurfaceStyle.every(({ animationName }) => animationName === "none"),
    "simulation panels should use a flat, non-blurred surface and honor reduced-motion"
  );
  assert(
    newSurfaceStyle.version?.backgroundImage === "none" && newSurfaceStyle.version?.minHeight >= 34,
    `version badge should use a flat surface and a usable hit area (backgroundImage=${newSurfaceStyle.version?.backgroundImage ?? "missing"}, minHeight=${newSurfaceStyle.version?.minHeight ?? "missing"})`
  );
  await page.click("#changelog-open-btn");
  await page.waitForSelector("#changelog-widget.is-expanded");
  const changelogStyle = await page.$eval("#changelog-widget", (element) => {
    const style = window.getComputedStyle(element);
    return { backgroundImage: style.backgroundImage, backdropFilter: style.backdropFilter };
  });
  assert(changelogStyle.backgroundImage === "none" && changelogStyle.backdropFilter === "none", "version changelog should use flat game panels without blur");
  await page.click("#changelog-widget .changelog-close-btn");
  await page.waitForSelector("#changelog-widget:not(.is-expanded)");
  return 11;
}

async function assertSimulationPlanning(page) {
  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("5003", true));
  const tyrantBatchSelector = '[data-sim-action="batch"][data-sim-node-id="5003"]';
  await page.waitForSelector(tyrantBatchSelector, { timeout: 3000 });
  await page.waitForFunction(() => {
    const nodeHas = (id, className) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains(className);
    const edgeHas = (key, className) => document.querySelector(`[data-edge-key="${key}"]`)?.classList.contains(className);
    return nodeHas("5003", "is-prereq-target")
      && nodeHas("5101", "is-prereq-active")
      && nodeHas("5006", "is-prereq-active")
      && !nodeHas("5002", "is-prereq-active")
      && !nodeHas("5007", "is-prereq-active")
      && edgeHas("5006->5101", "is-active-edge")
      && !edgeHas("5002->5007", "is-active-edge");
  }, null, { timeout: 3000 });
  const tyrantHighlight = await page.evaluate(() => ({
    activeNodes: ["5002", "5006", "5007", "5101", "5003"].filter((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-prereq-active")),
    activeEdges: ["5002->5007", "5006->5101"].filter((key) => document.querySelector(`[data-edge-key="${key}"]`)?.classList.contains("is-active-edge"))
  }));
  assert(tyrantHighlight.activeNodes.join(",") === "5006,5101,5003" && tyrantHighlight.activeEdges.join(",") === "5006->5101", "Tyrant simulation highlighting should stop at the Greed start dice");
  await page.click(tyrantBatchSelector);
  await page.waitForFunction(() => {
    const ranks = window.__TEST_HOOKS__.getSimulationPlan().ranks;
    return ranks["5101"] === 1 && ranks["5003"] === 1;
  });
  const tyrantState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  assert(tyrantState.ranks["5002"] === undefined && tyrantState.ranks["5007"] === undefined, "Tyrant auto-unlock should start at Greed instead of traversing its earlier topology");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("5105", true));
  await page.waitForFunction(() => {
    const nodeHas = (id, className) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains(className);
    const edgeHas = (key, className) => document.querySelector(`[data-edge-key="${key}"]`)?.classList.contains(className);
    return nodeHas("5105", "is-prereq-target")
      && nodeHas("5008", "is-prereq-active")
      && !nodeHas("5002", "is-prereq-active")
      && !nodeHas("5009", "is-prereq-active")
      && edgeHas("5008->5105", "is-active-edge")
      && !edgeHas("5002->5109", "is-active-edge");
  }, null, { timeout: 3000 });
  const chaosHighlight = await page.evaluate(() => ({
    activeNodes: ["5002", "5008", "5009", "5105"].filter((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-prereq-active")),
    activeEdges: ["5002->5109", "5008->5105"].filter((key) => document.querySelector(`[data-edge-key="${key}"]`)?.classList.contains("is-active-edge"))
  }));
  assert(chaosHighlight.activeNodes.join(",") === "5008,5105" && chaosHighlight.activeEdges.join(",") === "5008->5105", "Chaos critical-rate highlighting should stop at the Void start dice");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("5002", true));
  const fearButtonSelector = '[data-sim-action="unlock"][data-sim-node-id="5002"]';
  await page.waitForSelector(fearButtonSelector, { timeout: 3000 });
  const fearButtonText = await page.$eval(fearButtonSelector, (button) => button.textContent.trim());
  assert(fearButtonText.includes("8"), `Fear should expose its canonical resource cost (button=${fearButtonText})`);
  await page.click(fearButtonSelector);
  await page.waitForFunction(() => window.__TEST_HOOKS__.getSimulationPlan().ranks["5002"] === 1);

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("1106", true));
  const levelGateButton = page.locator(".simulation-action-btn-styled.is-special");
  await levelGateButton.waitFor({ state: "visible", timeout: 3000 });
  assert(await levelGateButton.isDisabled(), "a faction-level milestone should remain non-operable in simulation");
  assert((await levelGateButton.textContent()).includes("特殊"), "a faction-level milestone should explain its special condition");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("5102", true));
  const specialRouteButtonSelector = '[data-sim-action="batch"][data-sim-node-id="5102"]';
  await page.waitForSelector(specialRouteButtonSelector, { timeout: 3000 });
  assert(await page.$eval(specialRouteButtonSelector, (button) => !button.disabled), "a route through reward dice should remain batch-unlockable after Fear is purchased");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("1301", true));
  const batchButtonSelector = '[data-sim-action="batch"][data-sim-node-id="1301"]';
  await page.waitForSelector(batchButtonSelector, { timeout: 3000 });
  await page.waitForFunction((selector) => {
    const button = document.querySelector(selector);
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0
      && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  }, batchButtonSelector, { timeout: 3000 });
  await page.click(batchButtonSelector);
  await page.waitForFunction(() => window.__TEST_HOOKS__.getSimulationPlan().ranks["1301"] === 1);
  const batchState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  const batchUiState = await page.evaluate(() => ({
    unlockedInTree: ["1201", "1301"].every((id) => document.querySelector(`g.node[data-node-id="${id}"]`)?.classList.contains("is-sim-unlocked"))
  }));
  assert(batchState.ranks["1201"] === 1 && batchState.ranks["1301"] === 1, "batch unlock should apply prerequisite order");
  assert(batchState.spent.gold > 0 || batchState.spent.core > 0, "batch unlock should accumulate canonical cost");
  assert(batchUiState.unlockedInTree, "batch unlock should update both prerequisite and target nodes in the live tree");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("1201", true));
  await page.waitForSelector('[data-sim-action="revoke"][data-sim-node-id="1201"]');
  await armTooltipPopProbe(page);
  await page.click('[data-sim-action="revoke"][data-sim-node-id="1201"]');
  const revokePop = await readTooltipPopProbe(page);
  const revokedState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  assert(revokePop.detail && revokePop.rank, "revoke should pop the tooltip description and rank badge");
  assert(revokedState.ranks["1201"] === undefined && revokedState.ranks["1301"] === undefined, "revoke should remove the selected branch allocation");

  await page.waitForSelector('[data-sim-action="unlock"][data-sim-node-id="1201"]');
  await armTooltipPopProbe(page);
  await page.click('[data-sim-action="unlock"][data-sim-node-id="1201"]');
  const unlockPop = await readTooltipPopProbe(page);
  await page.waitForFunction(() => window.__TEST_HOOKS__.getSimulationPlan().ranks["1201"] === 1);
  const unlockedState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  assert(unlockPop.detail && unlockPop.rank, "unlock should pop the tooltip description and rank badge");

  await page.evaluate(() => window.__TEST_HOOKS__.showTooltip("1201", true));
  await page.waitForTimeout(600);
  const sliderState = await page.$eval(".rank-slider-input", (element) => ({ max: element.max, value: element.value }));
  assertEqual(sliderState.max, "50", "simulation rank slider should expose the canonical maximum");
  await page.$eval(".rank-slider-input", (element) => {
    element.value = "50";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const maxState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  assertEqual(maxState.ranks["1201"], 50, "max-rank should apply every canonical level");
  assert(maxState.spent.gold > unlockedState.spent.gold || maxState.spent.core > unlockedState.spent.core, "raising a node should accumulate the additional canonical cost");

  await page.click("#detailed-stats-btn");
  await page.waitForSelector("#detailed-stats-modal:not([hidden])");
  const simStatsState = await page.evaluate(() => ({
    isOpen: document.querySelector("#detailed-stats-modal")?.hidden === false,
    items: Array.from(document.querySelectorAll(".detailed-stats-item")).map((el) => el.textContent.trim())
  }));
  assert(simStatsState.isOpen, "detailed stats modal should open in simulation mode");
  await page.click("#detailed-stats-close-btn");
  await page.waitForSelector("#detailed-stats-modal", { state: "hidden" });
  return 10;
}

async function assertTeamPicker(page) {
  await page.click("#simulation-share-trigger-btn");
  await page.waitForSelector("#simulation-share-widget.is-expanded");
  const sharePanelState = await page.evaluate(() => ({
    expanded: document.querySelector("#simulation-share-widget")?.classList.contains("is-expanded") === true,
    mainVisible: document.querySelector("#simulation-share-main-pane")?.hidden === false,
    url: document.querySelector("#simulation-share-url")?.value || ""
  }));
  assert(sharePanelState.expanded && sharePanelState.mainVisible, "share panel should open its main pane");
  const teamIds = await page.evaluate(() => {
    const nodes = window.TREE_DATA?.nodes || [];
    const dice = nodes.filter((node) => node.node_type === "DICE" && node.is_base).slice(0, 5).map((node) => String(node.id));
    return { dice };
  });
  assert(teamIds.dice.length === 5, "team picker fixture should include five base dice");

  await page.click("#simulation-team-slots-1 .simulation-team-dice-card");
  await page.waitForSelector("#simulation-picker-pane:not([hidden])");
  const pickerState = await page.evaluate(() => ({
    visible: document.querySelector("#simulation-picker-pane")?.hidden === false,
    selected: document.querySelectorAll("#simulation-picker-grid .simulation-picker-card.is-selected").length,
    count: document.querySelector("#simulation-picker-count")?.textContent.trim() || ""
  }));
  assert(pickerState.visible && pickerState.selected === 0 && pickerState.count.includes("0/5"), "team picker should open with an empty five-dice selection");
  await selectSimulationDice(page, teamIds.dice);
  await page.waitForSelector("#simulation-picker-save:not([disabled])");
  const pickerCapacity = await page.$eval("#simulation-picker-grid", (grid) => ({
    selected: grid.querySelectorAll(".simulation-picker-card.is-selected").length,
    extraDisabled: [...grid.querySelectorAll(".simulation-picker-card:not(.is-selected)")].every((card) => card.disabled)
  }));
  assert(pickerCapacity.selected === 5 && pickerCapacity.extraDisabled, "picker should disable extra choices at capacity instead of showing a warning toast");
  await page.click("#simulation-picker-save");
  await page.waitForSelector("#simulation-picker-pane", { state: "hidden" });
  const savedTeam = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan().team);
  assertEqual(savedTeam.dice.map((entry) => String(entry.id)).join(","), teamIds.dice.join(","), "team picker should persist the selected dice order");
  const shareInitialFocus = await page.evaluate(() => ({
    className: document.activeElement?.className || "",
    teamIndex: document.activeElement?.dataset?.teamIndex || ""
  }));
  assert(shareInitialFocus.className.includes("simulation-team-dice-card") && shareInitialFocus.teamIndex === "0", "returning from the picker should restore focus to the edited team slot");
  const shareUrl = await page.$eval("#simulation-share-url", (el) => el.value);
  const shareCode = new URL(shareUrl).searchParams.get("s") || "";
  assert(shareUrl.includes("?s=") && /^[0-9A-Za-z]{6}$/.test(shareCode), `share modal should expose a six-character D1 share code (url=${shareUrl})`);

  await page.click("#simulation-team-slots-1 .simulation-team-dice-card");
  await page.waitForSelector("#simulation-picker-pane:not([hidden])");
  await page.click("#simulation-picker-grid .simulation-picker-card.is-selected");
  await page.click("#simulation-picker-cancel");
  await page.waitForSelector("#simulation-picker-pane", { state: "hidden" });
  const cancelledTeam = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan().team);
  assertEqual(cancelledTeam.dice.map((entry) => String(entry.id)).join(","), teamIds.dice.join(","), "cancelling the picker should discard unsaved changes");
  return { assertions: 8, shareUrl, teamIds };
}

async function assertShareImageAndImport(page, browserInstance, shareUrl) {
  await page.click("#simulation-share-close-btn");
  await page.setViewportSize({ width: 280, height: 568 });
  await page.waitForTimeout(80);
  await page.click("#simulation-share-trigger-btn");
  await page.waitForSelector("#simulation-share-widget.is-expanded");
  await page.waitForTimeout(420);
  await page.waitForFunction(() => {
    const loading = document.querySelector("#simulation-image-loading");
    const preview = document.querySelector("#simulation-share-image-preview");
    return loading?.hidden === true && preview?.complete === true && preview.naturalWidth > 0;
  }, { timeout: 5000 });
  const shareScrollProbe = await page.$eval(".simulation-share-card-inner", (content) => {
    const max = Math.max(0, content.scrollHeight - content.clientHeight);
    content.scrollTop = max;
    return { max, scrollTop: content.scrollTop };
  });
  await page.waitForTimeout(80);
  const shareScrollAfter = await page.$eval(".simulation-share-card-inner", (element) => ({
    scrollTop: element.scrollTop,
    max: Math.max(0, element.scrollHeight - element.clientHeight)
  }));
  assert(shareScrollAfter.max === 0 || Math.abs(shareScrollAfter.scrollTop - shareScrollAfter.max) <= 1, `narrow share content scroll must stay at the current end after opening (expected ${shareScrollAfter.max}, got ${shareScrollAfter.scrollTop}; initial max ${shareScrollProbe.max})`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(120);

  const imageResult = await page.evaluate(async () => {
    const result = await window.RD2App.simulationPlanUseCase.generateShareImage({ scale: 2 });
    if (!result.ok || !result.dataUrl) {
      return { ok: result.ok, width: result.layout?.width, height: result.layout?.height, hasDataUrl: false, iconPixels: 0 };
    }
    const image = new Image();
    image.src = result.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = result.layout.width;
    canvas.height = result.layout.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let iconPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (red > 150 && red > green * 1.45 && red > blue * 1.45) iconPixels += 1;
    }
    return { ok: true, width: result.layout.width, height: result.layout.height, hasDataUrl: true, iconPixels };
  });
  assert(imageResult.ok && imageResult.width === 3200 && imageResult.height === 2000 && imageResult.hasDataUrl && imageResult.iconPixels > 1000, `share image should include rendered node icons (dimensions=${imageResult.width}x${imageResult.height}, iconPixels=${imageResult.iconPixels})`);
  const downloadPromise = page.waitForEvent("download");
  await page.click("#simulation-image-share-btn");
  const download = await downloadPromise;
  const imageButtonLabel = await page.$eval("#simulation-image-share-btn", (el) => el.textContent.trim());
  assert(download.suggestedFilename() === "random-dice-2-lab-planning.png" && imageButtonLabel === "已下載", "share panel should download the fixed-size image and report completion inline");

  const sharedPage = await browserInstance.context.newPage({ viewport: { width: 390, height: 844 } });
  await sharedPage.goto(shareUrl, { waitUntil: "networkidle" });
  await sharedPage.waitForSelector("#loading-screen", { state: "hidden", timeout: 5000 });
  await sharedPage.waitForTimeout(700);
  const imported = await sharedPage.evaluate(() => ({
    active: document.body.classList.contains("simulation-mode"),
    ranks: window.__TEST_HOOKS__.getSimulationPlan().ranks,
    capsuleWidth: document.getElementById("simulation-top-capsule-group")?.getBoundingClientRect().width || 0
  }));
  assert(imported.active && imported.ranks["1201"] === 50, "opening a share URL should rebuild the simulation state");
  assert(imported.capsuleWidth <= 366, "simulation controls should fit the mobile viewport");
  await sharedPage.evaluate(() => window.__TEST_HOOKS__.showTooltip("1201", true));
  await sharedPage.waitForTimeout(600);
  await sharedPage.waitForSelector('[data-sim-action="revoke"][data-sim-node-id="1201"]');
  await sharedPage.click('[data-sim-action="revoke"][data-sim-node-id="1201"]');
  await sharedPage.waitForFunction(() => window.__TEST_HOOKS__.getSimulationPlan().ranks["1201"] === undefined);
  await sharedPage.waitForSelector('[data-sim-action="unlock"][data-sim-node-id="1201"]');
  await sharedPage.click('[data-sim-action="unlock"][data-sim-node-id="1201"]');
  await sharedPage.waitForFunction(() => window.__TEST_HOOKS__.getSimulationPlan().ranks["1201"] === 1);
  const sharedActionState = await sharedPage.evaluate(() => ({
    active: document.body.classList.contains("simulation-mode"),
    rank: window.__TEST_HOOKS__.getSimulationPlan().ranks["1201"]
  }));
  assert(sharedActionState.active && sharedActionState.rank === 1, "shared simulation should retain revoke and unlock actions");
  await sharedPage.close();
  return 6;
}

async function assertSimulationResetAndExit(page) {
  await page.click("#simulation-share-close-btn");
  await page.waitForSelector("#simulation-share-widget:not(.is-expanded)");
  const shareReturnFocus = await page.evaluate(() => document.activeElement?.id || "");
  assertEqual(shareReturnFocus, "simulation-share-trigger-btn", "closing the share panel should restore focus to its trigger");
  await page.evaluate(() => window.RD2App.simulationPlanUseCase.reset());
  await page.waitForTimeout(250);
  const resetState = await page.evaluate(() => window.__TEST_HOOKS__.getSimulationPlan());
  assertEqual(resetState.spent.gold, 0, "reset should clear gold spend");
  assertEqual(resetState.spent.core, 0, "reset should clear core spend");
  assertEqual(resetState.ranks["1201"], undefined, "reset should remove simulated ranks");
  assert(["1001", "1005", "1007", "2001", "3001", "4008", "5006", "5008"].every((id) => resetState.ranks[id] === 1)
    && resetState.ranks["5002"] === undefined, "reset should retain the five base dice and three pre-unlocked reward dice");

  await page.click("#simulation-toggle-btn");
  await page.waitForTimeout(220);
  const browsingState = await page.evaluate(() => ({
    active: document.body.classList.contains("simulation-mode"),
    filterVisible: window.getComputedStyle(document.querySelector(".search-block")).display !== "none",
    topCapsuleHidden: document.getElementById("simulation-top-capsule-group")?.hidden === true,
    specialBadgeText: document.querySelector('g.node[data-node-id="1106"] .cost-badge .cost-value')?.textContent.trim(),
    specialBadgeHasCurrency: Boolean(document.querySelector('g.node[data-node-id="1106"] .cost-badge use')),
    rankText: document.querySelector('g.node[data-node-id="1201"] .rank-badge .rank-value')?.textContent.trim()
  }));
  assert(!browsingState.active && browsingState.filterVisible && browsingState.topCapsuleHidden, "normal browsing controls should return after simulation");
  assert(browsingState.specialBadgeHasCurrency && browsingState.specialBadgeText === "10", "special condition badge should restore its canonical currency presentation");
  assertEqual(browsingState.rankText, "1/50", "rank badge should restore its canonical value after simulation");
  return 8;
}

async function assertSimulationLifecycle(page) {
  await page.click("#simulation-toggle-btn");
  await page.waitForTimeout(180);
  const simulationLifecycleRenderDelta = await page.evaluate(() => {
    const app = window.RD2App;
    const view = app.views.simulationView;
    const originalRender = view.render;
    let renderCount = 0;
    view.render = function (...args) {
      renderCount += 1;
      return originalRender.apply(this, args);
    };
    view.init();
    view.init();
    const beforeDispatch = renderCount;
    app.store.dispatch({ type: "TOGGLE_PREREQ_MODE", payload: true });
    const afterDispatch = renderCount;
    app.store.dispatch({ type: "TOGGLE_PREREQ_MODE", payload: false });
    view.render = originalRender;
    return afterDispatch - beforeDispatch;
  });
  assertEqual(simulationLifecycleRenderDelta, 1, "Simulation init must not duplicate store subscriptions");
  const lifecycleTeamBefore = await page.evaluate(() => JSON.stringify(window.__TEST_HOOKS__.getSimulationPlan().team));
  await page.click("#simulation-share-trigger-btn");
  await page.waitForSelector("#simulation-share-widget.is-expanded");
  await page.click("#simulation-team-slots-1 .simulation-team-dice-card");
  await page.waitForSelector("#simulation-picker-pane:not([hidden])");
  await page.click("#simulation-picker-grid .simulation-picker-card.is-selected");
  await page.evaluate(() => {
    const view = window.RD2App.views.simulationView;
    view.destroy();
    view.init();
  });
  await page.waitForTimeout(120);
  assert(await page.$eval("#simulation-share-widget", (element) => !element.classList.contains("is-expanded")), "destroy/init should close the share widget");
  await page.click("#simulation-share-trigger-btn");
  await page.waitForSelector("#simulation-share-widget.is-expanded");
  const lifecycleTeamAfter = await page.evaluate(() => JSON.stringify(window.__TEST_HOOKS__.getSimulationPlan().team));
  assertEqual(lifecycleTeamAfter, lifecycleTeamBefore, "destroy/init must discard unsaved team drafts before sharing");
  await page.click("#simulation-share-close-btn");
  await page.click("#simulation-toggle-btn");
  return 4;
}

export async function runSimulationModeSuite(options = {}) {
  const startTime = Date.now();
  let serverInstance = null;
  let browserInstance = null;
  let passedAssertions = 0;
  try {
    serverInstance = await startTestServer(options.port || 0);
    browserInstance = await createTestBrowser({
      browserType: options.browser || "chromium",
      headless: options.headless !== false,
      viewport: { width: 1280, height: 800 }
    });
    const page = browserInstance.page;
    await page.goto(`${serverInstance.baseUrl}/index.html`, { waitUntil: "networkidle" });
    await page.waitForSelector('g.node[data-node-id]', { timeout: 5000 });
    await page.waitForSelector("#loading-screen", { state: "hidden", timeout: 5000 });
    await page.waitForTimeout(500);

    passedAssertions += await assertSimulationSurface(page);

    passedAssertions += await assertSimulationPlanning(page);

    const teamFlow = await assertTeamPicker(page);
    passedAssertions += teamFlow.assertions;

    passedAssertions += await assertShareImageAndImport(page, browserInstance, teamFlow.shareUrl);
    passedAssertions += await assertSimulationResetAndExit(page);
    passedAssertions += await assertSimulationLifecycle(page);

    assertNoUnexpectedBrowserDiagnostics(browserInstance, 'simulation suite');
    const durationMs = Date.now() - startTime;
    return { suite: "simulation_mode", name: "Simulation Planning Mode", passed: true, durationMs, assertions: passedAssertions, errors: [] };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const failure = await captureFailureArtifacts({
      suiteName: "simulation-mode",
      error,
      browser: options.browser || process.env.TEST_BROWSER || "chromium",
      browserInstance,
      baseUrl: serverInstance?.baseUrl
    });
    return { suite: "simulation_mode", name: "Simulation Planning Mode", passed: false, durationMs, assertions: passedAssertions, errors: [failure.message], diagnostics: failure };
  } finally {
    await closeSuiteResources(browserInstance, serverInstance);
  }
}

const directEntry = process.argv[1];
if (directEntry?.endsWith("simulation_mode.suite.mjs")) {
  const result = await runSimulationModeSuite();
  process.exitCode = result.passed ? 0 : 1;
}
