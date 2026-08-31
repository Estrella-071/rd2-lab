import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startTestServer } from "../tests/helpers/test_server.mjs";
import { orderedStylesheets } from "./stylesheet_contract.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const reportOnly = args.includes("--report-only");
const runsArgument = args.find((arg) => arg.startsWith("--runs="));
const siteArgument = args.find((arg) => arg.startsWith("--site="));
const budgetPath = path.join(rootDir, "performance-budget.json");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
let selectedProfile = process.env.RD2_PERFORMANCE_PROFILE?.trim() || "local";
if (args.includes("--high-refresh")) selectedProfile = "high-refresh";
if (args.includes("--stress")) selectedProfile = "stress";
const isHighRefreshProfile =
  selectedProfile === "high-refresh" || selectedProfile === "stress";
const frameTargetHz = budget.framePolicy.targetHz;
const nominalFrameIntervalMs = 1000 / frameTargetHz;
const frameDropThresholdMs = budget.framePolicy.dropThresholdMs;
const frameGateProfiles = new Set(budget.framePolicy.enforcedProfiles || []);
const frameGateEnabled = frameGateProfiles.has(selectedProfile);
let defaultRuns = budget.runs;
if (selectedProfile === "high-refresh") defaultRuns = budget.highRefreshRuns;
if (selectedProfile === "stress") defaultRuns = budget.stressRuns;
const runs = Number(runsArgument?.split("=")[1] || defaultRuns);
const supportedProfiles = new Set(["local", "hosted-ci", "high-refresh", "stress"]);
let effectiveBrowserBudget = budget.browser;
if (selectedProfile === "hosted-ci") {
  effectiveBrowserBudget = { ...budget.browser, ...budget.hostedCiBrowser };
} else if (selectedProfile === "high-refresh") {
  effectiveBrowserBudget = { ...budget.browser, ...budget.highRefreshBrowser };
} else if (selectedProfile === "stress") {
  effectiveBrowserBudget = {
    ...budget.browser,
    ...budget.highRefreshBrowser,
    ...budget.stressBrowser,
  };
}
const profileCpuThrottlingRate =
  selectedProfile === "stress"
    ? Number(budget.stressBrowser.cpuThrottlingRate)
    : 1;
const readinessTimeoutMs = 10000 * profileCpuThrottlingRate;
const interactionTimeoutMs = 5000 * profileCpuThrottlingRate;
const requestedSite = siteArgument?.slice("--site=".length) || process.env.VERIFY_SITE_DIR || ".pages";
const siteDir = path.resolve(rootDir, requestedSite);
const reportDir = path.join(rootDir, "artifacts", "performance");
let reportFile = "pages-budget.json";
if (selectedProfile === "high-refresh") reportFile = "pages-budget-high-refresh.json";
if (selectedProfile === "stress") reportFile = "pages-budget-stress.json";
const reportPath = path.join(reportDir, reportFile);
let evidenceScope = "Local headless Chromium lab gate; not field data or Core Web Vitals evidence.";
if (selectedProfile === "hosted-ci") {
  evidenceScope = "GitHub-hosted Chromium regression gate; not field data or Core Web Vitals evidence.";
} else if (selectedProfile === "high-refresh") {
  evidenceScope = "Local headed Chromium gate on a high-refresh display; reference-machine evidence, not a universal device guarantee.";
} else if (selectedProfile === "stress") {
  evidenceScope = `Local headed Chromium stress gate with ${budget.stressBrowser.cpuThrottlingRate}x CPU throttling on a high-refresh display; controlled lab evidence, not a universal device guarantee.`;
}

function validateInputs() {
  if (!supportedProfiles.has(selectedProfile)) {
    throw new Error(`Unsupported performance profile: ${selectedProfile}.`);
  }
  if (!Number.isFinite(frameTargetHz) || frameTargetHz <= 0) {
    throw new Error("performance-budget.json framePolicy.targetHz must be a positive number.");
  }
  if (!Number.isFinite(nominalFrameIntervalMs) || nominalFrameIntervalMs <= 0) {
    throw new Error("performance-budget.json framePolicy.targetHz must produce a positive frame interval.");
  }
  if (!Number.isFinite(frameDropThresholdMs) || frameDropThresholdMs <= nominalFrameIntervalMs) {
    throw new Error("performance-budget.json framePolicy.dropThresholdMs must be greater than the nominal frame interval.");
  }
  if (frameDropThresholdMs > nominalFrameIntervalMs * 1.25) {
    throw new Error("performance-budget.json framePolicy.dropThresholdMs must stay within a 25% scheduling tolerance.");
  }
  if (
    !Array.isArray(budget.framePolicy.enforcedProfiles)
    || budget.framePolicy.enforcedProfiles.length === 0
    || budget.framePolicy.enforcedProfiles.some((profile) => !supportedProfiles.has(profile))
  ) {
    throw new Error("performance-budget.json framePolicy.enforcedProfiles must list supported profiles.");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new Error(`--runs must be an integer from 1 to 10; received ${runs}.`);
  }
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new Error(`Pages staging directory is missing: ${siteDir}. Run npm run build:pages first.`);
  }
}

function resolvePublicFile(relativePath) {
  const resolved = path.resolve(siteDir, relativePath);
  if (resolved !== siteDir && !resolved.startsWith(`${siteDir}${path.sep}`)) {
    throw new Error(`Runtime manifest contains an unsafe path: ${relativePath}`);
  }
  return resolved;
}

function measureArtifact() {
  const manifestPath = path.join(siteDir, "runtime-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`runtime-manifest.json is missing from ${siteDir}.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files)) {
    throw new TypeError("runtime-manifest.json must contain a files array.");
  }

  const generatedFiles = new Set(
    Array.isArray(manifest.generatedFiles) ? manifest.generatedFiles.map(String) : [],
  );
  let totalBytes = 0;
  const fileBytes = {};
  for (const relativePath of manifest.files) {
    const filePath = resolvePublicFile(relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Runtime manifest file is missing: ${relativePath}`);
    }
    const size = fs.statSync(filePath).size;
    if (!generatedFiles.has(relativePath)) totalBytes += size;
    fileBytes[relativePath] = size;
  }

  const rasterPaths = [...generatedFiles];
  const rasterBytes = rasterPaths.reduce((sum, relativePath) => {
    const filePath = resolvePublicFile(relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Generated raster manifest file is missing: ${relativePath}`);
    }
    return sum + fs.statSync(filePath).size;
  }, 0);
  const renderManifestPath = String(manifest.renderManifest || "map-render-manifest.json");
  const renderManifestFile = JSON.parse(fs.readFileSync(resolvePublicFile(renderManifestPath), "utf8"));
  const initialRasterPaths = Array.isArray(renderManifestFile?.initial?.paths)
    ? renderManifestFile.initial.paths.map(String)
    : [];
  const initialRasterBytes = initialRasterPaths.reduce((sum, relativePath) => {
    const filePath = resolvePublicFile(relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Initial raster manifest file is missing: ${relativePath}`);
    }
    return sum + fs.statSync(filePath).size;
  }, 0);

  return {
    fileCount: manifest.files.length - generatedFiles.size,
    totalBytes,
    generatedFiles: generatedFiles.size,
    raster: {
      fileCount: rasterPaths.length,
      totalBytes: rasterBytes,
      initialBytes: initialRasterBytes,
      manifest: renderManifestPath,
    },
    stylesheets: {
      fileCount: orderedStylesheets.length,
      totalBytes: orderedStylesheets.reduce(
        (sum, relativePath) => sum + (fileBytes[relativePath] ?? 0),
        0,
      ),
      fileBytes: Object.fromEntries(
        orderedStylesheets.map(relativePath => [relativePath, fileBytes[relativePath] ?? null]),
      ),
    },
    fileBytes: Object.fromEntries(
      Object.keys(budget.artifact.maxFileBytes).map((relativePath) => [
        relativePath,
        fileBytes[relativePath] ?? null,
      ]),
    ),
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function median(values) {
  if (values.some((value) => !Number.isFinite(value))) return null;
  return percentile(values, 0.5);
}

function rateFromDuration(duration) {
  return Number.isFinite(duration) && duration > 0 ? 1000 / duration : null;
}

function summarizeFrameDurations(frameDurations) {
  return {
    averageMs: frameDurations.reduce((sum, value) => sum + value, 0) / frameDurations.length,
    p50Ms: percentile(frameDurations, 0.5),
    p95Ms: percentile(frameDurations, 0.95),
    maxMs: Math.max(...frameDurations),
    framesOver25Ms: frameDurations.filter((value) => value > 25).length,
    framesOverNominalFrameInterval: frameDurations.filter((value) => value > nominalFrameIntervalMs).length,
    framesOver8Point34Ms: frameDurations.filter((value) => value > 8.34).length,
    droppedFrameCount: frameDurations.filter((value) => value > frameDropThresholdMs).length,
    nominalFrameIntervalMs,
    frameDropThresholdMs,
    sampleCount: frameDurations.length,
  };
}

async function measureRasterSettle(page, timeoutMs = 2000) {
  return page.evaluate(async ({ timeout }) => {
    const renderer = window.RD2App?.mapRenderer;
    const started = performance.now();
    const isSettled = () => {
      const scene = document.querySelector(".map-scene");
      const body = document.body;
      return Boolean(
        renderer
        && renderer.currentResolution === renderer.desiredResolution
        && !renderer._sceneFramePromise
        && scene?.dataset.canvasReady === "true"
        && !body?.classList.contains("is-zooming")
        && !body?.classList.contains("is-navigating")
      );
    };
    // Let the final input event enqueue the viewport render before checking
    // the state. Otherwise an already-matching bucket could report zero while
    // the browser still has a candidate frame waiting for the next RAF.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    while (!isSettled() && performance.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return {
      settled: isSettled(),
      settleMs: performance.now() - started,
      currentResolution: renderer?.currentResolution ?? null,
      desiredResolution: renderer?.desiredResolution ?? null
    };
  }, { timeout: timeoutMs });
}

async function readFilteredVisualState(page) {
  return page.evaluate(() => {
    const map = document.querySelector(".map-scene");
    const renderer = window.RD2App?.mapRenderer;
    const model = renderer?.model;
    const semanticButtons = document.querySelectorAll("button.tree-node-semantic[data-node-id]");
    const hasMatchedNode = [...(model?.nodes || [])].some((node) => node.isMatching && !node.isDimmed);
    const hasUnmatchedNode = [...(model?.nodes || [])].some((node) => node.isDimmed);
    const nodeCanvas = document.querySelector("canvas.tree-node-surface");
    const canvasSceneReady = Boolean(
      map?.dataset.canvasReady === "true"
      && semanticButtons.length === 239
      && document.querySelector("canvas.tree-state-surface")
      && !map.querySelector("svg")
    );

    return {
      labelsVisible: document.body.classList.contains("show-node-names") && hasMatchedNode,
      matchedEffectVisible: hasMatchedNode && nodeCanvas?.dataset.canvasReady === "true",
      unmatchedContextVisible: hasUnmatchedNode && nodeCanvas?.dataset.canvasReady === "true",
      canvasSceneReady,
      noRuntimeMapSvg: !map?.querySelector("svg"),
    };
  });
}

async function measureGesture(page) {
  const frameDurations = await page.evaluate(async () => {
    const viewport = document.getElementById("viewport");
    if (!viewport) throw new Error("Viewport is missing during gesture measurement.");

    const frameDurations = [];
    let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 30; index += 1) {
      viewport.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 640,
        clientY: 400,
        deltaY: index % 2 === 0 ? -65 : 52,
      }));
      const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameDurations.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
    }

    return frameDurations;
  });
  const rasterSettle = await measureRasterSettle(page);
  return {
    ...summarizeFrameDurations(frameDurations),
    rasterSettleMs: rasterSettle.settleMs,
    rasterSettled: rasterSettle.settled,
    rasterResolution: rasterSettle.currentResolution,
    desiredRasterResolution: rasterSettle.desiredResolution
  };
}

async function measureHighZoomPan(page) {
  await page.evaluate(async () => {
    const app = window.RD2App;
    if (!app?.viewportController || !app?.filterTreeUseCase) {
      throw new Error("Viewport or filter controller is unavailable during high-zoom pan measurement.");
    }

    app.filterTreeUseCase.clear();
    const viewportState = app.viewportController.getState();
    app.viewportController.zoomTo(
      viewportState.maxScale,
      app.viewportController.mapWidth / 2,
      app.viewportController.mapHeight / 2,
      true,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(180);

  const sampleCount = isHighRefreshProfile ? 240 : 120;
  const result = await page.evaluate(async ({ frameCount }) => {
    const viewport = document.getElementById("viewport");
    const app = window.RD2App;
    if (!viewport || !app?.viewportController) {
      throw new Error("Viewport is missing during high-zoom pan measurement.");
    }

    const frameDurations = [];
    const pointerId = 29;
    const dispatch = ({ target, type, clientX, clientY, buttons }) => {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        clientX,
        clientY,
        buttons,
        button: type === "pointerdown" ? 0 : -1,
      };
      target.dispatchEvent(new PointerEvent(type, eventInit));
    };

    dispatch({ target: viewport, type: "pointerdown", clientX: 640, clientY: 400, buttons: 1 });
    let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / Math.max(1, frameCount - 1);
      dispatch({
        target: window,
        type: "pointermove",
        clientX: 640 + Math.sin(progress * Math.PI * 12) * 360,
        clientY: 400 + Math.cos(progress * Math.PI * 9) * 210,
        buttons: 1,
      });
      const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameDurations.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
    }
    dispatch({ target: window, type: "pointerup", clientX: 640, clientY: 400, buttons: 0 });

    const map = document.querySelector(".map-scene");
    const canvasSceneReady = Boolean(
      map?.dataset.canvasReady === "true"
      && document.querySelectorAll("button.tree-node-semantic[data-node-id]").length === 239
      && document.querySelector("canvas.tree-state-surface")
      && !map.querySelector("svg")
    );
    const viewportState = app.viewportController.getState();
    return {
      frameDurations,
      scale: viewportState.scale,
      maxScale: viewportState.maxScale,
      labelsVisible: document.body.classList.contains("show-node-names"),
      shadowFilterFree: true,
      canvasSceneReady,
      noRuntimeMapSvg: !map?.querySelector("svg"),
    };
  }, { frameCount: sampleCount });

  await page.evaluate(() => {
    window.RD2App.viewportController.resetToCenter(true);
  });

  const { frameDurations, ...state } = result;
  return {
    ...summarizeFrameDurations(frameDurations),
    ...state,
  };
}

async function measureFilteredLowZoomPan(page) {
  await page.evaluate(async () => {
    const app = window.RD2App;
    if (!app?.viewportController || !app?.filterTreeUseCase) {
      throw new Error("Viewport or filter controller is unavailable during filtered low-zoom measurement.");
    }

    app.filterTreeUseCase.clear();
    const viewportState = app.viewportController.getState();
    app.viewportController.zoomTo(
      viewportState.minScale,
      app.viewportController.mapWidth / 2,
      app.viewportController.mapHeight / 2,
      true,
    );
    app.filterTreeUseCase.toggleFaction(1, true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(180);

  const visualState = await readFilteredVisualState(page);

  const result = await page.evaluate(async () => {
    const viewport = document.getElementById("viewport");
    if (!viewport) throw new Error("Viewport is missing during filtered low-zoom measurement.");

    const frameDurations = [];
    const pointerId = 23;
    const dispatch = ({ target, type, clientX, clientY, buttons }) => {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        clientX,
        clientY,
        buttons,
        button: type === "pointerdown" ? 0 : -1,
        pressure: buttons > 0 ? 0.5 : 0,
      };
      target.dispatchEvent(new PointerEvent(type, eventInit));
    };

    dispatch({ target: viewport, type: "pointerdown", clientX: 640, clientY: 400, buttons: 1 });
    let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 120; index += 1) {
      const progress = index / 119;
      dispatch({
        target: window,
        type: "pointermove",
        clientX: 640 + Math.sin(progress * Math.PI * 5) * 280,
        clientY: 400 + Math.cos(progress * Math.PI * 4) * 150,
        buttons: 1,
      });
      const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameDurations.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
    }
    dispatch({ target: window, type: "pointerup", clientX: 640, clientY: 400, buttons: 0 });

    const viewportState = window.RD2App.viewportController.getState();
    return {
      frameDurations,
      scale: viewportState.scale,
      activeFilter: document.querySelector(".map-scene")?.classList.contains("has-tree-filter") || false,
    };
  });

  await page.evaluate(() => {
    window.RD2App.filterTreeUseCase.clear();
    window.RD2App.viewportController.resetToCenter(true);
  });
  const { frameDurations, ...state } = result;
  return { ...summarizeFrameDurations(frameDurations), ...state, ...visualState };
}

async function measureFilteredLowZoomWheel(page) {
  await page.evaluate(async () => {
    const app = window.RD2App;
    if (!app?.viewportController || !app?.filterTreeUseCase) {
      throw new Error("Viewport or filter controller is unavailable during filtered wheel-zoom measurement.");
    }
    app.filterTreeUseCase.clear();
    const viewportState = app.viewportController.getState();
    app.viewportController.zoomTo(
      viewportState.minScale,
      app.viewportController.mapWidth / 2,
      app.viewportController.mapHeight / 2,
      true,
    );
    app.filterTreeUseCase.toggleFaction(1, true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(180);

  const sampleCount = isHighRefreshProfile ? 360 : 180;
  const activeFrameCount = Math.max(1, sampleCount - 48);
  const rawResult = await page.evaluate(async ({ frameCount }) => {
    const viewport = document.getElementById("viewport");
    const app = window.RD2App;
    if (!viewport || !app?.viewportController) {
      throw new Error("Viewport is missing during filtered wheel-zoom measurement.");
    }

    const frameDurations = [];
    const scales = [];
    let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < frameCount; index += 1) {
      const direction = Math.floor(index / 24) % 2 === 0 ? -1 : 1;
      viewport.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 640,
        clientY: 400,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: direction * 180,
      }));
      const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameDurations.push(timestamp - previousTimestamp);
      scales.push(app.viewportController.getState().scale);
      previousTimestamp = timestamp;
    }

    return {
      frameDurations,
      minObservedScale: Math.min(...scales),
      maxObservedScale: Math.max(...scales),
      scaleExcursion: Math.max(...scales) - Math.min(...scales),
      activeFilter: document.querySelector(".map-scene")?.classList.contains("has-tree-filter") || false,
    };
  }, { frameCount: activeFrameCount });

  const rasterSettle = await measureRasterSettle(page);
  const visualState = await readFilteredVisualState(page);
  await page.evaluate(() => {
    window.RD2App.filterTreeUseCase.clear();
    window.RD2App.viewportController.resetToCenter(true);
  });

  const { frameDurations, ...state } = rawResult;
  return {
    ...summarizeFrameDurations(frameDurations),
    ...state,
    rasterSettleMs: rasterSettle.settleMs,
    rasterSettled: rasterSettle.settled,
    rasterResolution: rasterSettle.currentResolution,
    desiredRasterResolution: rasterSettle.desiredResolution,
    ...visualState,
  };
}

async function measureFilterInteraction(page) {
  await page.evaluate(async () => {
    const app = window.RD2App;
    if (!app?.viewportController || !app?.filterTreeUseCase) {
      throw new Error("Viewport or filter controller is unavailable during filter interaction measurement.");
    }
    app.filterTreeUseCase.clear();
    const viewportState = app.viewportController.getState();
    app.viewportController.zoomTo(
      viewportState.minScale,
      app.viewportController.mapWidth / 2,
      app.viewportController.mapHeight / 2,
      true,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(180);

  const sampleCount = isHighRefreshProfile ? 300 : 180;
  const rawResult = await page.evaluate(async ({ frameCount }) => {
    const chips = [1, 2, 1, 3, 2].map(
      (branch) => document.querySelector(`.filter-chip.branch-chip[data-branch="${branch}"]`),
    );
    if (chips.some((chip) => !chip)) {
      throw new Error("Faction filter controls are missing during filter interaction measurement.");
    }

    const triggerFrames = (frameCount >= 300
      ? [5, 55, 105, 155, 205]
      : [5, 35, 65, 95, 125]
    ).filter((frame) => frame < frameCount);
    const frameDurations = [];
    let actionIndex = 0;
    let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < frameCount; index += 1) {
      if (index === triggerFrames[actionIndex]) {
        chips[actionIndex].click();
        actionIndex += 1;
      }
      const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameDurations.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
    }

    const appState = window.RD2App.store.getState();
    return {
      frameDurations,
      filterActions: actionIndex,
      activeFilter: document.querySelector(".map-scene")?.classList.contains("has-tree-filter") || false,
      activeFactionCount: appState.filters.factions.size,
    };
  }, { frameCount: sampleCount });

  await page.waitForTimeout(500);
  const visualState = await readFilteredVisualState(page);
  await page.evaluate(() => {
    window.RD2App.filterTreeUseCase.clear();
    window.RD2App.viewportController.resetToCenter(true);
  });

  const { frameDurations, ...state } = rawResult;
  return {
    ...summarizeFrameDurations(frameDurations),
    ...state,
    ...visualState,
  };
}

async function measureMobilePan(
  browser,
  baseUrl,
  run,
  cpuThrottlingRate = 1,
) {
  const context = await browser.newContext({
    viewport: {
      width: budget.mobileViewport.width,
      height: budget.mobileViewport.height,
    },
    deviceScaleFactor: budget.mobileViewport.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (cpuThrottlingRate > 1) {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", {
      rate: cpuThrottlingRate,
    });
  }
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(`mobile pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    runtimeErrors.push(`mobile requestfailed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });

  try {
    await page.goto(`${baseUrl}/index.html?performance-mobile-run=${run}`, { waitUntil: "networkidle" });
    await page.waitForSelector("#loading-screen", {
      state: "hidden",
      timeout: readinessTimeoutMs,
    });
    await page.waitForFunction(
      () => document.querySelectorAll("button.tree-node-semantic[data-node-id]").length === 239
        && document.querySelector(".map-scene[data-canvas-ready=\"true\"]"),
      null,
      { timeout: readinessTimeoutMs },
    );

    const gestureFrameDurations = await page.evaluate(async () => {
      const viewport = document.getElementById("viewport");
      if (!viewport) throw new Error("Viewport is missing during mobile pan measurement.");
      const frameDurations = [];
      const pointerId = 17;
      const dispatch = (target, type, clientX, clientY, buttons) => {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          clientX,
          clientY,
          buttons,
        }));
      };

      dispatch(viewport, "pointerdown", 195, 430, 1);
      let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let index = 0; index < 90; index += 1) {
        if (index < 46) {
          const progress = index / 45;
          dispatch(
            window,
            "pointermove",
            195 + Math.sin(progress * Math.PI) * 92,
            430 - progress * 145,
            1,
          );
        } else if (index === 46) {
          dispatch(window, "pointerup", 195, 285, 0);
        }
        const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
        frameDurations.push(timestamp - previousTimestamp);
        previousTimestamp = timestamp;
      }

      return frameDurations;
    });
    const gesture = summarizeFrameDurations(gestureFrameDurations);

    await page.evaluate(() => {
      window.RD2App?.viewportController?.resetToCenter(true);
    });
    await page.waitForTimeout(180);

    const pinchResult = await page.evaluate(async () => {
      const viewport = document.getElementById("viewport");
      const app = window.RD2App;
      if (!viewport || !app?.viewportController) {
        throw new Error("Viewport is missing during mobile pinch measurement.");
      }

      const frameDurations = [];
      const scales = [];
      const dispatch = (target, type, pointerId, clientX, clientY, buttons) => {
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 41,
          clientX,
          clientY,
          buttons,
          pressure: buttons > 0 ? 0.5 : 0,
        });
        // Chromium may allocate a synthetic pointer id during dispatch. Keep
        // both contacts stable so the measurement exercises the pinch path.
        Object.defineProperty(event, "pointerId", { value: pointerId });
        target.dispatchEvent(event);
      };

      dispatch(viewport, "pointerdown", 41, 140, 430, 1);
      dispatch(viewport, "pointerdown", 42, 250, 430, 1);
      let previousTimestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let index = 0; index < 120; index += 1) {
        const progress = index / 119;
        const halfDistance = 55 + progress * 140;
        dispatch(window, "pointermove", 41, 195 - halfDistance, 430, 1);
        dispatch(window, "pointermove", 42, 195 + halfDistance, 430, 1);
        const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));
        frameDurations.push(timestamp - previousTimestamp);
        scales.push(app.viewportController.getState().scale);
        previousTimestamp = timestamp;
      }
      dispatch(window, "pointerup", 41, 50, 430, 0);
      dispatch(window, "pointerup", 42, 340, 430, 0);

      const viewportState = app.viewportController.getState();
      return {
        frameDurations,
        scaleExcursion: Math.max(...scales) - Math.min(...scales),
        reachedMaxScale: Math.abs(viewportState.scale - viewportState.maxScale) < 0.001,
      };
    });
    const { frameDurations: pinchFrameDurations, ...pinchState } = pinchResult;
    const pinch = { ...summarizeFrameDurations(pinchFrameDurations), ...pinchState };

    return { gesture, pinch, runtimeErrors };
  } finally {
    await context.close();
  }
}

async function measureBrowserRuns() {
  process.env.VERIFY_SITE_DIR = siteDir;
  const server = await startTestServer(0);
  const highRefresh = isHighRefreshProfile;
  const cpuThrottlingRate = profileCpuThrottlingRate;
  const browser = await chromium.launch({
    headless: !highRefresh,
    args: highRefresh
      ? [
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          `--window-size=${budget.viewport.width},${budget.viewport.height}`,
        ]
      : [],
  });
  const results = [];

  try {
    for (let run = 1; run <= runs; run += 1) {
      const context = await browser.newContext({
        viewport: {
          width: budget.viewport.width,
          height: budget.viewport.height,
        },
        deviceScaleFactor: budget.viewport.deviceScaleFactor,
      });
      await context.addInitScript(() => {
        window.__RD2_PERF_LONG_TASKS__ = [];
        window.__RD2_PERF_LONG_TASKS_SUPPORTED__ = false;
        window.__RD2_PERF_TREE_READY_MS__ = null;
        window.__RD2_PERF_INTERACTIVE_READY_MS__ = null;
        const observeReadiness = () => {
          const capture = () => {
            const hasCanvasTree = document.querySelectorAll("button.tree-node-semantic[data-node-id]").length === 239
              && document.querySelector(".map-scene[data-canvas-ready=\"true\"]")
              && !document.querySelector(".map-scene svg");
            if (hasCanvasTree && window.__RD2_PERF_TREE_READY_MS__ === null) {
              window.__RD2_PERF_TREE_READY_MS__ = performance.now();
            }
            const loader = document.getElementById("loading-screen");
            if (
              hasCanvasTree
              && loader?.hidden
              && window.__RD2_PERF_INTERACTIVE_READY_MS__ === null
            ) {
              window.__RD2_PERF_INTERACTIVE_READY_MS__ = performance.now();
              observer.disconnect();
            }
          };
          const observer = new MutationObserver(capture);
          observer.observe(document, {
            attributes: true,
            attributeFilter: ["hidden"],
            childList: true,
            subtree: true,
          });
          capture();
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", observeReadiness, { once: true });
        } else {
          observeReadiness();
        }
        if (typeof PerformanceObserver !== "undefined") {
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                window.__RD2_PERF_LONG_TASKS__.push({
                  startTime: entry.startTime,
                  duration: entry.duration,
                });
              }
            });
            observer.observe({ type: "longtask", buffered: true });
            window.__RD2_PERF_LONG_TASKS_SUPPORTED__ = true;
          } catch {
            // The unsupported state is included in the report and fails the gate.
          }
        }
      });

      const page = await context.newPage();
      if (cpuThrottlingRate > 1) {
        const session = await context.newCDPSession(page);
        await session.send("Emulation.setCPUThrottlingRate", {
          rate: cpuThrottlingRate,
        });
      }
      if (highRefresh) await page.bringToFront();
      const runtimeErrors = [];
      page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
      page.on("requestfailed", (request) => {
        runtimeErrors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
      });

      try {
        await page.goto(`${server.baseUrl}/index.html?performance-run=${run}`, { waitUntil: "networkidle" });
        await page.waitForSelector("#loading-screen", {
          state: "hidden",
          timeout: readinessTimeoutMs,
        });
        await page.waitForFunction(
          () => document.querySelectorAll("button.tree-node-semantic[data-node-id]").length === 239
            && document.querySelector(".map-scene[data-canvas-ready=\"true\"]"),
          null,
          { timeout: readinessTimeoutMs },
        );

        const startup = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const firstContentfulPaint = performance.getEntriesByName("first-contentful-paint")[0];
          const resources = performance.getEntriesByType("resource");
          const initialTransferBytes = resources.reduce(
            (sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0),
            navigation?.transferSize || navigation?.encodedBodySize || 0,
          );
          return {
            firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
            loadEventMs: navigation?.loadEventEnd ?? null,
            treeReadyMs: window.__RD2_PERF_TREE_READY_MS__,
            interactiveReadyMs: window.__RD2_PERF_INTERACTIVE_READY_MS__,
            initialTransferBytes,
            renderManifestResponseEndMs: resources.find((entry) => entry.name.endsWith("/map-render-manifest.json"))?.responseEnd ?? null,
          };
        });

        const gesture = await measureGesture(page);
        const highZoomPan = await measureHighZoomPan(page);
        const filteredLowZoomPan = await measureFilteredLowZoomPan(page);
        const filteredLowZoomWheel = await measureFilteredLowZoomWheel(page);
        const filterInteraction = await measureFilterInteraction(page);
        const taskState = await page.evaluate(() => {
          const longTasks = window.__RD2_PERF_LONG_TASKS__ || [];
          return {
            maxLongTaskMs: longTasks.length > 0
              ? Math.max(...longTasks.map((entry) => entry.duration))
              : 0,
            totalBlockingTimeMs: longTasks.reduce(
              (sum, entry) => sum + Math.max(0, entry.duration - 50),
              0,
            ),
            longTaskCount: longTasks.length,
            longTaskObserverSupported: window.__RD2_PERF_LONG_TASKS_SUPPORTED__ === true,
          };
        });

        const mobile = await measureMobilePan(
          browser,
          server.baseUrl,
          run,
          cpuThrottlingRate,
        );
        results.push({
          run,
          startup,
          gesture,
          highZoomPan,
          filteredLowZoomPan,
          filteredLowZoomWheel,
          filterInteraction,
          mobileGesture: mobile.gesture,
          mobilePinch: mobile.pinch,
          tasks: taskState,
          runtimeErrors: [...runtimeErrors, ...mobile.runtimeErrors],
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  return results;
}

function aggregateRuns(runResults) {
  const metric = (selector) => median(runResults.map(selector));
  const maximum = (selector) => Math.max(...runResults.map(selector));
  const highZoomPanFrameAverageMs = metric((run) => run.highZoomPan.averageMs);
  const highZoomPanFrameP50Ms = metric((run) => run.highZoomPan.p50Ms);
  const filteredLowZoomPanFrameAverageMs = metric((run) => run.filteredLowZoomPan.averageMs);
  const filteredLowZoomPanFrameP50Ms = metric((run) => run.filteredLowZoomPan.p50Ms);
  const filteredLowZoomWheelFrameAverageMs = metric((run) => run.filteredLowZoomWheel.averageMs);
  const filteredLowZoomWheelFrameP50Ms = metric((run) => run.filteredLowZoomWheel.p50Ms);
  const filterInteractionFrameAverageMs = metric((run) => run.filterInteraction.averageMs);
  const filterInteractionFrameP50Ms = metric((run) => run.filterInteraction.p50Ms);
  return {
    frameTargetHz,
    nominalFrameIntervalMs,
    frameDropThresholdMs,
    firstContentfulPaintMs: metric((run) => run.startup.firstContentfulPaintMs),
    loadEventMs: metric((run) => run.startup.loadEventMs),
    treeReadyMs: metric((run) => run.startup.treeReadyMs),
    interactiveReadyMs: metric((run) => run.startup.interactiveReadyMs),
    initialTransferBytes: metric((run) => run.startup.initialTransferBytes),
    renderManifestResponseEndMs: metric((run) => run.startup.renderManifestResponseEndMs),
    maxLongTaskMs: metric((run) => run.tasks.maxLongTaskMs),
    totalBlockingTimeMs: metric((run) => run.tasks.totalBlockingTimeMs),
    longTaskObserverSupported: runResults.every((run) => run.tasks.longTaskObserverSupported),
    gestureFrameAverageMs: metric((run) => run.gesture.averageMs),
    gestureFrameP95Ms: metric((run) => run.gesture.p95Ms),
    gestureFrameMaxMs: metric((run) => run.gesture.maxMs),
    gestureFramesOver25Ms: metric((run) => run.gesture.framesOver25Ms),
    gestureDroppedFrameCount: maximum((run) => run.gesture.droppedFrameCount),
    gestureRasterSettleMs: maximum((run) => run.gesture.rasterSettleMs),
    gestureRasterSettled: runResults.every((run) => run.gesture.rasterSettled),
    highZoomPanFrameAverageMs,
    highZoomPanFrameP50Ms,
    highZoomPanFrameP95Ms: metric((run) => run.highZoomPan.p95Ms),
    highZoomPanFrameMaxMs: metric((run) => run.highZoomPan.maxMs),
    highZoomPanFramesOver25Ms: metric((run) => run.highZoomPan.framesOver25Ms),
    highZoomPanFramesOverNominalFrameInterval: metric((run) => run.highZoomPan.framesOverNominalFrameInterval),
    highZoomPanFramesOver8Point34Ms: metric((run) => run.highZoomPan.framesOver8Point34Ms),
    highZoomPanDroppedFrameCount: maximum((run) => run.highZoomPan.droppedFrameCount),
    highZoomPanAverageFps: rateFromDuration(highZoomPanFrameAverageMs),
    highZoomPanRefreshHz: rateFromDuration(highZoomPanFrameP50Ms),
    highZoomPanAtMaximumScale: runResults.every(
      (run) => Math.abs(run.highZoomPan.scale - run.highZoomPan.maxScale) < 0.001,
    ),
    highZoomPanVisualsPreserved: runResults.every(
      (run) => (
        run.highZoomPan.labelsVisible
        && run.highZoomPan.shadowFilterFree
        && run.highZoomPan.canvasSceneReady
        && run.highZoomPan.noRuntimeMapSvg
      ),
    ),
    filteredLowZoomPanFrameAverageMs,
    filteredLowZoomPanFrameP50Ms,
    filteredLowZoomPanFrameP95Ms: metric((run) => run.filteredLowZoomPan.p95Ms),
    filteredLowZoomPanFrameMaxMs: metric((run) => run.filteredLowZoomPan.maxMs),
    filteredLowZoomPanFramesOver25Ms: metric((run) => run.filteredLowZoomPan.framesOver25Ms),
    filteredLowZoomPanFramesOverNominalFrameInterval: metric((run) => run.filteredLowZoomPan.framesOverNominalFrameInterval),
    filteredLowZoomPanFramesOver8Point34Ms: metric((run) => run.filteredLowZoomPan.framesOver8Point34Ms),
    filteredLowZoomPanDroppedFrameCount: maximum((run) => run.filteredLowZoomPan.droppedFrameCount),
    filteredLowZoomPanAverageFps: rateFromDuration(filteredLowZoomPanFrameAverageMs),
    filteredLowZoomPanRefreshHz: rateFromDuration(filteredLowZoomPanFrameP50Ms),
    filteredLowZoomFilterActive: runResults.every((run) => run.filteredLowZoomPan.activeFilter),
    filteredLowZoomLabelsVisible: runResults.every((run) => run.filteredLowZoomPan.labelsVisible),
    filteredLowZoomMatchedEffectVisible: runResults.every((run) => run.filteredLowZoomPan.matchedEffectVisible),
    filteredLowZoomContextVisible: runResults.every((run) => run.filteredLowZoomPan.unmatchedContextVisible),
    filteredLowZoomCanvasSceneReady: runResults.every((run) => run.filteredLowZoomPan.canvasSceneReady),
    filteredLowZoomWheelFrameAverageMs,
    filteredLowZoomWheelFrameP50Ms,
    filteredLowZoomWheelFrameP95Ms: metric((run) => run.filteredLowZoomWheel.p95Ms),
    filteredLowZoomWheelFrameMaxMs: metric((run) => run.filteredLowZoomWheel.maxMs),
    filteredLowZoomWheelFramesOver25Ms: metric((run) => run.filteredLowZoomWheel.framesOver25Ms),
    filteredLowZoomWheelFramesOverNominalFrameInterval: metric((run) => run.filteredLowZoomWheel.framesOverNominalFrameInterval),
    filteredLowZoomWheelFramesOver8Point34Ms: metric((run) => run.filteredLowZoomWheel.framesOver8Point34Ms),
    filteredLowZoomWheelDroppedFrameCount: maximum((run) => run.filteredLowZoomWheel.droppedFrameCount),
    filteredLowZoomWheelRasterSettleMs: maximum((run) => run.filteredLowZoomWheel.rasterSettleMs),
    filteredLowZoomWheelRasterSettled: runResults.every((run) => run.filteredLowZoomWheel.rasterSettled),
    filteredLowZoomWheelAverageFps: rateFromDuration(filteredLowZoomWheelFrameAverageMs),
    filteredLowZoomWheelRefreshHz: rateFromDuration(filteredLowZoomWheelFrameP50Ms),
    filteredLowZoomWheelScaleExcursion: metric((run) => run.filteredLowZoomWheel.scaleExcursion),
    filteredLowZoomWheelFilterActive: runResults.every((run) => run.filteredLowZoomWheel.activeFilter),
    filteredLowZoomWheelVisualsPreserved: runResults.every((run) => (
      run.filteredLowZoomWheel.labelsVisible
      && run.filteredLowZoomWheel.matchedEffectVisible
      && run.filteredLowZoomWheel.unmatchedContextVisible
      && run.filteredLowZoomWheel.canvasSceneReady
      && run.filteredLowZoomWheel.noRuntimeMapSvg
    )),
    filterInteractionFrameAverageMs,
    filterInteractionFrameP50Ms,
    filterInteractionFrameP95Ms: metric((run) => run.filterInteraction.p95Ms),
    filterInteractionFrameMaxMs: metric((run) => run.filterInteraction.maxMs),
    filterInteractionFramesOver25Ms: metric((run) => run.filterInteraction.framesOver25Ms),
    filterInteractionFramesOverNominalFrameInterval: metric((run) => run.filterInteraction.framesOverNominalFrameInterval),
    filterInteractionFramesOver8Point34Ms: metric((run) => run.filterInteraction.framesOver8Point34Ms),
    filterInteractionDroppedFrameCount: maximum((run) => run.filterInteraction.droppedFrameCount),
    filterInteractionAverageFps: rateFromDuration(filterInteractionFrameAverageMs),
    filterInteractionRefreshHz: rateFromDuration(filterInteractionFrameP50Ms),
    filterInteractionActions: metric((run) => run.filterInteraction.filterActions),
    filterInteractionFilterActive: runResults.every((run) => run.filterInteraction.activeFilter),
    filterInteractionVisualsPreserved: runResults.every((run) => (
      run.filterInteraction.labelsVisible
      && run.filterInteraction.matchedEffectVisible
      && run.filterInteraction.unmatchedContextVisible
      && run.filterInteraction.canvasSceneReady
      && run.filterInteraction.noRuntimeMapSvg
    )),
    mobilePanFrameAverageMs: metric((run) => run.mobileGesture.averageMs),
    mobilePanFrameP95Ms: metric((run) => run.mobileGesture.p95Ms),
    mobilePanFrameMaxMs: metric((run) => run.mobileGesture.maxMs),
    mobilePanFramesOver25Ms: metric((run) => run.mobileGesture.framesOver25Ms),
    mobilePanFramesOverNominalFrameInterval: metric((run) => run.mobileGesture.framesOverNominalFrameInterval),
    mobilePanDroppedFrameCount: maximum((run) => run.mobileGesture.droppedFrameCount),
    mobilePinchFrameAverageMs: metric((run) => run.mobilePinch.averageMs),
    mobilePinchFrameP95Ms: metric((run) => run.mobilePinch.p95Ms),
    mobilePinchFrameMaxMs: metric((run) => run.mobilePinch.maxMs),
    mobilePinchFramesOver25Ms: metric((run) => run.mobilePinch.framesOver25Ms),
    mobilePinchFramesOverNominalFrameInterval: metric((run) => run.mobilePinch.framesOverNominalFrameInterval),
    mobilePinchDroppedFrameCount: maximum((run) => run.mobilePinch.droppedFrameCount),
    mobilePinchScaleExcursion: metric((run) => run.mobilePinch.scaleExcursion),
    mobilePinchReachedMaxScale: runResults.every((run) => run.mobilePinch.reachedMaxScale),
    runtimeErrors: runResults.reduce((sum, run) => sum + run.runtimeErrors.length, 0),
  };
}

function requireMaximum(violations, label, actual, maximum) {
  if (!Number.isFinite(actual)) {
    violations.push(`${label} is unavailable; expected a numeric measurement.`);
  } else if (actual > maximum) {
    violations.push(`${label} ${actual.toFixed(2)} exceeds ${maximum}.`);
  }
}

function evaluateArtifactBudget(artifact, violations) {
  const checks = [
    ["artifact.fileCount", artifact.fileCount, budget.artifact.maxFiles],
    ["artifact.totalBytes", artifact.totalBytes, budget.artifact.maxTotalBytes],
    ["artifact.stylesheets.totalBytes", artifact.stylesheets.totalBytes, budget.artifact.maxStylesheetBytes]
  ];
  for (const [label, actual, maximum] of checks) requireMaximum(violations, label, actual, maximum);
  for (const [relativePath, maximum] of Object.entries(budget.artifact.maxFileBytes)) {
    requireMaximum(violations, `artifact.${relativePath}`, artifact.fileBytes[relativePath], maximum);
  }
  const rasterBudget = budget.artifact.raster || {};
  requireMaximum(violations, "artifact.raster.totalBytes", artifact.raster?.totalBytes, rasterBudget.maxTotalBytes);
  requireMaximum(violations, "artifact.raster.initialBytes", artifact.raster?.initialBytes, rasterBudget.maxInitialBytes);
}

const REQUIRED_BROWSER_FLAGS = Object.freeze([
  ["longTaskObserverSupported", "must be true for every run."],
  ["gestureRasterSettled", "the post-gesture raster frame must settle within the measurement timeout."],
  ["highZoomPanAtMaximumScale", "must be true for every run."],
  ["highZoomPanVisualsPreserved", "must be true for every run."],
  ["filteredLowZoomFilterActive", "must be true for every run."],
  ["filteredLowZoomLabelsVisible", "must be true for every run."],
  ["filteredLowZoomMatchedEffectVisible", "must be true for every run."],
  ["filteredLowZoomContextVisible", "must be true for every run."],
  ["filteredLowZoomCanvasSceneReady", "must be true for every run."],
  ["filteredLowZoomWheelFilterActive", "must be true for every run."],
  ["filteredLowZoomWheelRasterSettled", "the filtered wheel raster frame must settle within the measurement timeout."],
  ["filteredLowZoomWheelVisualsPreserved", "must be true for every run."],
  ["filterInteractionFilterActive", "must be true for every run."],
  ["filterInteractionVisualsPreserved", "must be true for every run."],
  ["mobilePinchReachedMaxScale", "must be true for every run."]
]);

function evaluateBrowserFlags(browserMetrics, violations) {
  for (const [key, message] of REQUIRED_BROWSER_FLAGS) {
    if (!browserMetrics[key]) violations.push(`browser.${key} ${message}`);
  }
  if (browserMetrics.filteredLowZoomWheelScaleExcursion < 0.5) {
    violations.push("browser.filteredLowZoomWheelScaleExcursion must cover at least 0.5 scale units.");
  }
  if (browserMetrics.filterInteractionActions < 5) {
    violations.push("browser.filterInteractionActions must include all five filter changes.");
  }
  if (browserMetrics.mobilePinchScaleExcursion < 0.5) {
    violations.push("browser.mobilePinchScaleExcursion must cover at least 0.5 scale units.");
  }
}

const FRAME_DROP_MAXIMUMS = Object.freeze([
  ["gestureDroppedFrameCount", "maxDroppedFrames"],
  ["highZoomPanDroppedFrameCount", "maxDroppedFrames"],
  ["filteredLowZoomPanDroppedFrameCount", "maxDroppedFrames"],
  ["filteredLowZoomWheelDroppedFrameCount", "maxDroppedFrames"],
  ["filterInteractionDroppedFrameCount", "maxDroppedFrames"],
  ["mobilePanDroppedFrameCount", "maxDroppedFrames"],
  ["mobilePinchDroppedFrameCount", "maxDroppedFrames"]
]);

const BROWSER_MAXIMUMS = Object.freeze([
  ["firstContentfulPaintMs", "maxFirstContentfulPaintMs"],
  ["loadEventMs", "maxLoadEventMs"],
  ["treeReadyMs", "maxTreeReadyMs"],
  ["interactiveReadyMs", "maxInteractiveReadyMs"],
  ["renderManifestResponseEndMs", "maxRenderManifestResponseEndMs"],
  ["initialTransferBytes", "maxInitialTransferBytes"],
  ["maxLongTaskMs", "maxLongTaskMs"],
  ["totalBlockingTimeMs", "maxTotalBlockingTimeMs"],
  ...(frameGateEnabled ? FRAME_DROP_MAXIMUMS : []),
  ["gestureRasterSettleMs", "maxRasterSettleMs"],
  ["filteredLowZoomWheelRasterSettleMs", "maxRasterSettleMs"],
  ["runtimeErrors", "maxRuntimeErrors"]
]);

function evaluateBrowserMaximums(browserMetrics, browserBudget, violations) {
  for (const [metricKey, budgetKey] of BROWSER_MAXIMUMS) {
    requireMaximum(violations, `browser.${metricKey}`, browserMetrics[metricKey], browserBudget[budgetKey]);
  }
}

function evaluateBudget(artifact, browserMetrics) {
  const violations = [];
  const browserBudget = effectiveBrowserBudget;
  evaluateArtifactBudget(artifact, violations);
  evaluateBrowserFlags(browserMetrics, violations);
  evaluateBrowserMaximums(browserMetrics, browserBudget, violations);
  return violations;
}

const startedAt = new Date().toISOString();
fs.mkdirSync(reportDir, { recursive: true });
fs.rmSync(reportPath, { force: true });

try {
  validateInputs();
  const artifact = measureArtifact();
  const runResults = await measureBrowserRuns();
  const browserMetrics = aggregateRuns(runResults);
  const violations = evaluateBudget(artifact, browserMetrics);
  const report = {
    schemaVersion: 5,
    profile: `${budget.profile}:${selectedProfile}`,
    startedAt,
    completedAt: new Date().toISOString(),
    siteDir,
    runs,
    aggregation: "median for startup and diagnostic timing; maximum for dropped-frame, lifecycle, and error counts",
    frameGateEnabled,
    frameGateMode: frameGateEnabled ? "hard" : "diagnostic-only",
    scope: evidenceScope,
    artifact,
    browser: browserMetrics,
    runResults,
    budget,
    effectiveBrowserBudget,
    status: violations.length === 0 ? "PASS" : "FAIL",
    violations,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Pages performance profile (${selectedProfile}): ${report.status}`);
  console.log(
    `- artifact: ${artifact.fileCount} files, ${artifact.totalBytes} bytes; `
    + `CSS ${artifact.stylesheets.totalBytes} bytes in ${artifact.stylesheets.fileCount} files`,
  );
  console.log(`- startup median: FCP ${browserMetrics.firstContentfulPaintMs?.toFixed(1)} ms, tree ready ${browserMetrics.treeReadyMs?.toFixed(1)} ms, interactive ${browserMetrics.interactiveReadyMs?.toFixed(1)} ms`);
  console.log(
    `- ${frameGateEnabled ? "hard" : "diagnostic-only"} frame gate: ${browserMetrics.frameDropThresholdMs?.toFixed(2)} ms threshold, `
    + `dropped frames gesture ${browserMetrics.gestureDroppedFrameCount}, `
    + `high-zoom ${browserMetrics.highZoomPanDroppedFrameCount}, `
    + `filtered-pan ${browserMetrics.filteredLowZoomPanDroppedFrameCount}, `
    + `filtered-wheel ${browserMetrics.filteredLowZoomWheelDroppedFrameCount}, `
    + `filter ${browserMetrics.filterInteractionDroppedFrameCount}, `
    + `mobile-pan ${browserMetrics.mobilePanDroppedFrameCount}, `
    + `mobile-pinch ${browserMetrics.mobilePinchDroppedFrameCount}`,
  );
  console.log(
    `- raster settle: gesture ${browserMetrics.gestureRasterSettleMs?.toFixed(1)} ms, `
    + `filtered-wheel ${browserMetrics.filteredLowZoomWheelRasterSettleMs?.toFixed(1)} ms `
    + `(max ${effectiveBrowserBudget.maxRasterSettleMs} ms)`,
  );
  console.log(`- report: ${path.relative(rootDir, reportPath)}`);

  if (violations.length > 0) {
    console.error(`Performance budget violations (${violations.length}):\n- ${violations.join("\n- ")}`);
    if (!reportOnly) process.exitCode = 1;
  }
} catch (error) {
  const failureReport = {
    schemaVersion: 5,
    profile: `${budget.profile}:${selectedProfile}`,
    startedAt,
    completedAt: new Date().toISOString(),
    siteDir,
    runs,
    scope: evidenceScope,
    frameGateEnabled,
    frameGateMode: frameGateEnabled ? "hard" : "diagnostic-only",
    budget,
    effectiveBrowserBudget,
    status: "ERROR",
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(failureReport, null, 2)}\n`, "utf8");
  console.error(`Pages performance measurement failed: ${failureReport.error.message}`);
  console.error(`- report: ${path.relative(rootDir, reportPath)}`);
  process.exitCode = 1;
}
