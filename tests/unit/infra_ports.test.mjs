import test from "node:test";
import assert from "node:assert/strict";

import {
  DataRepositoryPort,
  SpineEnginePort,
  ViewportPort,
  StoragePort
} from "../../src/app/ports/index.js";

import {
  HttpDataRepository,
  SpineWebglEngine,
  ViewportController,
  LocalStorageAdapter
} from "../../src/infra/index.js";

test("Ports: Abstract base classes enforce method implementation", async () => {
  const dataRepo = new DataRepositoryPort();
  await assert.rejects(() => dataRepo.loadDiceTree(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadDiceTreeSvg(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadBossEvents(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadMonsterVisuals(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadGameMetadata(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadChangelog(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadLocales(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadAll(), /must be implemented/);
  assert.throws(() => dataRepo.clearCache(), /must be implemented/);

  const spineEngine = new SpineEnginePort();
  await assert.rejects(() => spineEngine.acquireCanvas({}, {}), /must be implemented/);
  assert.throws(() => spineEngine.releaseCanvas({}), /must be implemented/);
  assert.throws(() => spineEngine.disposeAll(), /must be implemented/);
  assert.throws(() => spineEngine.getActiveContextCount(), /must be implemented/);

  const viewport = new ViewportPort();
  assert.throws(() => viewport.init({}, {}), /must be implemented/);
  assert.throws(() => viewport.pan(0, 0), /must be implemented/);
  assert.throws(() => viewport.zoom(1), /must be implemented/);
  assert.throws(() => viewport.centerOn(0, 0), /must be implemented/);
  assert.throws(() => viewport.reset(), /must be implemented/);
  assert.throws(() => viewport.getState(), /must be implemented/);
  assert.throws(() => viewport.subscribe(() => {}), /must be implemented/);
  assert.throws(() => viewport.destroy(), /must be implemented/);

  const storage = new StoragePort();
  assert.throws(() => storage.getItem("k"), /must be implemented/);
  assert.throws(() => storage.setItem("k", "v"), /must be implemented/);
  assert.throws(() => storage.removeItem("k"), /must be implemented/);
  assert.throws(() => storage.clear(), /must be implemented/);
});

test("HttpDataRepository: Loads and caches data via fetch with fallback", async () => {
  let fetchLog = [];
  const mockFetch = async (url) => {
    fetchLog.push(url);
    if (url.includes("locales")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ schema_version: 1, default_locale: "zh-tw", locales: ["zh-tw", "en", "ja", "ko"] })
      };
    }
    if (url.endsWith(".svg") || url.includes("dice_tree.svg")) {
      return {
        ok: true,
        status: 200,
        text: async () => "<svg></svg>"
      };
    }
    if (url.includes("dice_tree")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ nodes: [{ id: "1001", name: "風骰子" }], edges: [] })
      };
    }
    if (url === "boss_event_data.json" || url === "data/boss_event_data.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [{ id: "E01", title: "突襲" }] })
      };
    }
    if (url === "monster_visuals.json" || url === "data/monster_visuals.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ monsters: { monster_1: { poster: "icons/monster_1.png" } } })
      };
    }
    return { ok: false, status: 404 };
  };

  const repo = new HttpDataRepository({ fetchFn: mockFetch });

  // 1. Initial Load
  const tree1 = await repo.loadDiceTree();
  assert.equal(tree1.nodes.length, 1);
  assert.equal(fetchLog.length, 1);

  // 2. Cached Load
  const tree2 = await repo.loadDiceTree();
  assert.equal(tree2, tree1);
  assert.equal(fetchLog.length, 1); // No new network call

  // 3. Boss Events default path
  const events = await repo.loadBossEvents();
  assert.equal(events.events.length, 1);
  assert.equal(fetchLog.length, 2);
  assert.equal(fetchLog[1], "boss_event_data.json");

  // 4. Monster visuals default path
  const visuals = await repo.loadMonsterVisuals();
  assert.ok(visuals.monsters.monster_1);
  assert.equal(fetchLog.length, 3);
  assert.equal(fetchLog[2], "monster_visuals.json");

  // 5. loadAll
  const allData = await repo.loadAll();
  assert.ok(allData.treeData);
  assert.ok(allData.bossEvents);
  assert.ok(allData.monsterVisuals);
  assert.deepEqual(allData.locales.locales, ["zh-tw", "en", "ja", "ko"]);

  // 6. Fallback test: when primary fails, try fallback path
  const failingPrimaryFetch = async (url) => {
    fetchLog.push(`fallback_check:${url}`);
    if (url === "boss_event_data.json" || url === "monster_visuals.json") {
      return { ok: false, status: 404 };
    }
    if (url === "data/boss_event_data.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [{ id: "E02", title: "隕石" }] })
      };
    }
    if (url === "data/monster_visuals.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ monsters: { monster_2: { poster: "icons/monster_2.png" } } })
      };
    }
    return { ok: false, status: 404 };
  };
  const repoFallback = new HttpDataRepository({ fetchFn: failingPrimaryFetch });
  const fallbackEvents = await repoFallback.loadBossEvents("boss_event_data.json");
  assert.equal(fallbackEvents.events[0].id, "E02");
  const fallbackVisuals = await repoFallback.loadMonsterVisuals("monster_visuals.json");
  assert.ok(fallbackVisuals.monsters.monster_2);

  // 7. Clear Cache
  repo.clearCache();
  await repo.loadDiceTree();
  assert.ok(fetchLog.length > 5);
});

test("HttpDataRepository: clearCache invalidates an in-flight response", async () => {
  let fetchCalls = 0;
  const pendingResponses = [];
  const repo = new HttpDataRepository({
    fetchFn: () => {
      fetchCalls += 1;
      return new Promise((resolve) => pendingResponses.push(resolve));
    }
  });

  const staleRequest = repo.loadDiceTree("tree.json");
  repo.clearCache();
  pendingResponses.shift()({ ok: true, status: 200, json: async () => ({ nodes: [{ id: "stale" }] }) });
  await staleRequest;

  const freshRequest = repo.loadDiceTree("tree.json");
  assert.equal(fetchCalls, 2);
  pendingResponses.shift()({ ok: true, status: 200, json: async () => ({ nodes: [{ id: "fresh" }] }) });
  const freshData = await freshRequest;
  assert.equal(freshData.nodes[0].id, "fresh");
});

test("HttpDataRepository: Error handling on HTTP failure or invalid payload", async () => {
  const failingFetch = async () => ({ ok: false, status: 500 });
  const repo1 = new HttpDataRepository({ fetchFn: failingFetch });
  await assert.rejects(() => repo1.loadDiceTree(), /HTTP status 500/);

  const invalidFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ invalid: true }) // Missing nodes array
  });
  const repo2 = new HttpDataRepository({ fetchFn: invalidFetch });
  await assert.rejects(() => repo2.loadDiceTree(), /Invalid dice tree data format/);

  for (const payload of [
    { nodes: [null] },
    { nodes: [{ id: "" }] },
    { nodes: [{ id: "1001" }], edges: [null] },
    { nodes: [{ id: "1001" }], edges: [{ from: "1001" }] }
  ]) {
    const malformedTreeRepo = new HttpDataRepository({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => payload })
    });
    await assert.rejects(() => malformedTreeRepo.loadDiceTree(), /Invalid dice tree data format/);
  }

  for (const payload of [{}, { events: {} }, { events: [null] }, { events: [{ id: "" }] }]) {
    const malformedBossRepo = new HttpDataRepository({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => payload })
    });
    await assert.rejects(() => malformedBossRepo.loadBossEvents(), /Invalid boss event data format/);
  }

  for (const payload of [
    { monsters: [] },
    { monsters: { monster_1: null } },
    { monsters: { monster_1: { poster: "../outside.png" } } },
    { monsters: { monster_1: { spine: { skeleton: "../../outside.skel", atlas: "x.atlas", texture: "x.png", animation: "idle" } } } }
  ]) {
    const malformedVisualRepo = new HttpDataRepository({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => payload })
    });
    await assert.rejects(() => malformedVisualRepo.loadMonsterVisuals(), /Invalid monster visual data format/);
  }

  for (const payload of [
    {},
    { schema_version: 1, locales: ["zh-tw", "en", "ja"] },
    { schema_version: 2, locales: ["zh-tw", "en", "ja", "ko"] }
  ]) {
    const malformedLocaleRepo = new HttpDataRepository({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => payload })
    });
    await assert.rejects(() => malformedLocaleRepo.loadLocales(), /Invalid locale catalog format/);
  }

  const unsafeSvgRepo = new HttpDataRepository({
    fetchFn: async () => ({
      ok: true,
      status: 200,
      text: async () => '<svg><image href="javascript:alert(1)" onload="window.__xss = true" /></svg>'
    })
  });
  await assert.rejects(() => unsafeSvgRepo.loadDiceTreeSvg(), /Unsafe dice tree SVG/);

  for (const href of [
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+',
    'data:image/png;base64,AA==',
    'https://attacker.example/payload.svg',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'icons/../outside.png'
  ]) {
    const unsafeHrefRepo = new HttpDataRepository({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => `<svg><image href="${href}" /></svg>`
      })
    });
    await assert.rejects(() => unsafeHrefRepo.loadDiceTreeSvg(), /Unsafe dice tree SVG/);
  }

  const safeHrefRepo = new HttpDataRepository({
    fetchFn: async () => ({
      ok: true,
      status: 200,
      text: async () => '<svg><use href="#sprite-1" xlink:href="#sprite-1" /><image href="icons/Dice.png" /></svg>'
    })
  });
  assert.match(await safeHrefRepo.loadDiceTreeSvg(), /icons\/Dice\.png/);
});

test("SpineWebglEngine: Spine 4.2 WebGL callbacks, texture binding, straight alpha, and pool capping", async () => {
  let activeContexts = 0;
  let disposedCount = 0;
  let setTexturesCalled = false;
  let clearedColor = false;
  let straightAlphaDrawn = false;

  class MockSpineCanvas {
    constructor(canvas, config) {
      activeContexts++;
      this.canvas = canvas;
      this.config = config;

      // Verify Spine 4.2 WebGL straight alpha configuration
      assert.deepEqual(config.webglConfig, {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true
      });

      this.assetManager = {
        loadBinary: () => {},
        loadText: () => {},
        loadTexture: () => {},
        get: (path) => (path.endsWith(".atlas") ? "atlas data" : "skeleton binary data"),
        dispose: () => {}
      };
      this.renderer = {
        resize: () => {},
        begin: () => {},
        drawSkeleton: (_skeleton, premultipliedAlpha) => {
          if (premultipliedAlpha === false) {
            straightAlphaDrawn = true;
          }
        },
        end: () => {},
        dispose: () => {}
      };

      const api = {
        assetManager: this.assetManager,
        renderer: this.renderer,
        clear: (r, g, b, a) => {
          if (r === 0 && g === 0 && b === 0 && a === 0) {
            clearedColor = true;
          }
        }
      };

      // Verify Spine 4.2 lifecycle methods
      assert.equal(typeof config.app.loadAssets, "function");
      assert.equal(typeof config.app.initialize, "function");
      assert.equal(typeof config.app.update, "function");
      assert.equal(typeof config.app.render, "function");
      assert.equal(typeof config.app.error, "function");

      // Trigger loadAssets & initialize
      config.app.loadAssets(api);
      setTimeout(() => {
        config.app.initialize(api);
        config.app.update(api, 0.016);
        config.app.render(api);
      }, 5);
    }
    dispose() {
      activeContexts--;
      disposedCount++;
    }
  }

  const mockSpineRuntime = {
    SpineCanvas: MockSpineCanvas,
    ResizeMode: { Fit: 0 },
    Physics: { update: 1 },
    Vector2: class { constructor() { this.x = 0; this.y = 0; } },
    TextureAtlas: class {
      constructor() {}
      setTextures() {
        setTexturesCalled = true;
      }
    },
    AtlasAttachmentLoader: class { constructor() {} },
    SkeletonBinary: class {
      constructor() {}
      readSkeletonData() {
        return {
          animations: [{ name: "idle" }],
          findAnimation: (name) => ({ name })
        };
      }
    },
    Skeleton: class {
      constructor() {}
      setToSetupPose() {}
      updateWorldTransform() {}
    },
    AnimationStateData: class { constructor() {} },
    AnimationState: class {
      constructor() {}
      setAnimation() {}
      addAnimation() {}
      update() {}
      apply() {}
    }
  };

  const engine = new SpineWebglEngine({ spineRuntime: mockSpineRuntime });

  const createMockElement = (id) => {
    const el = {
      id,
      dataset: {},
      querySelector: (sel) => {
        if (sel === ".monster-spine-canvas") return { classList: { add: () => {}, remove: () => {} }, width: 0, height: 0 };
        if (sel === ".monster-spine-poster") return { classList: { add: () => {}, remove: () => {} }, setAttribute: () => {} };
        if (sel === ".monster-spine-status") return { textContent: "", classList: { add: () => {} }, hidden: false };
        return null;
      },
      getBoundingClientRect: () => ({ width: 300, height: 300 })
    };
    return el;
  };

  const elemA = createMockElement("elA");
  const elemB = createMockElement("elB");

  const defA = { skeleton: "skelA.skel", atlas: "monsters/atlasA.atlas", texture: "monsters/texA.png", animation: "idle" };
  const defB = { skeleton: "skelB.skel", atlas: "monsters/atlasB.atlas", texture: "monsters/texB.png", animation: "idle" };

  // 1. Acquire for Element A
  const instanceA = await engine.acquireCanvas(elemA, defA);
  assert.ok(instanceA);
  assert.equal(engine.getActiveContextCount(), 1);
  assert.equal(activeContexts, 1);
  assert.equal(setTexturesCalled, true);
  assert.equal(clearedColor, true);
  assert.equal(straightAlphaDrawn, true);

  // 2. Acquire for Element B -> Must dispose Element A first (Pool cap = 1)
  const instanceB = await engine.acquireCanvas(elemB, defB);
  assert.ok(instanceB);
  assert.equal(engine.getActiveContextCount(), 1);
  assert.equal(activeContexts, 1);
  assert.equal(disposedCount, 1);

  // 3. Release B
  engine.releaseCanvas(elemB);
  assert.equal(engine.getActiveContextCount(), 0);
  assert.equal(activeContexts, 0);
  assert.equal(disposedCount, 2);

  // 4. Graceful fallback when spine is disabled
  const elemDisabled = createMockElement("elDisabled");
  elemDisabled.dataset.spineDisabled = "true";
  const res = await engine.acquireCanvas(elemDisabled, defA);
  assert.equal(res, null);
});

test("SpineWebglEngine: disposes a constructor result after synchronous initialize failure", async () => {
  let disposedCount = 0;
  const elementClasses = new Set();
  const element = {
    dataset: {},
    classList: {
      add(value) { elementClasses.add(value); },
      remove(value) { elementClasses.delete(value); },
      toggle(value, enabled) {
        if (enabled) elementClasses.add(value);
        else elementClasses.delete(value);
      }
    },
    querySelector: (selector) => {
      if (selector === ".monster-spine-canvas") return { width: 0, height: 0 };
      if (selector === ".monster-spine-poster") return { setAttribute() {} };
      if (selector === ".monster-spine-status") return { textContent: "", classList: { add() {}, remove() {} } };
      return null;
    },
    getBoundingClientRect: () => ({ width: 100, height: 100 })
  };
  const api = {
    assetManager: {
      loadBinary() {},
      loadText() {},
      loadTexture() {},
      get() { return "asset"; },
      dispose() {}
    },
    renderer: { resize() {}, dispose() {}, begin() {}, drawSkeleton() {}, end() {} },
    clear() {}
  };
  const spineRuntime = {
    SpineCanvas: class {
      constructor(_canvas, config) {
        config.app.loadAssets(api);
        config.app.initialize(api);
        return {
          assetManager: api.assetManager,
          renderer: api.renderer,
          dispose() { disposedCount += 1; }
        };
      }
    },
    TextureAtlas: class { setTextures() {} },
    AtlasAttachmentLoader: class {},
    SkeletonBinary: class { readSkeletonData() { throw new Error("injected initialize failure"); } },
    Skeleton: class {},
    AnimationStateData: class {},
    AnimationState: class {},
    Vector2: class { constructor() { this.x = 1; this.y = 1; } },
    Physics: { update: 1 },
    ResizeMode: { Fit: 0 }
  };

  const engine = new SpineWebglEngine({ spineRuntime });
  const result = await engine.acquireCanvas(element, {
    skeleton: "failed.skel",
    atlas: "failed.atlas",
    texture: "failed.png",
    animation: "idle"
  });

  assert.equal(result, null);
  assert.equal(disposedCount, 1);
  assert.equal(engine.getActiveContextCount(), 0);
  assert.equal(elementClasses.has("is-static"), true);
});

test("ViewportController: Pan, Zoom, CenterOn, limits calculation and boundary safety", () => {
  const controller = new ViewportController({ mapWidth: 4000, mapHeight: 3400 });

  // Mobile vs Desktop scale limits
  const mobileLimits = controller.calculateScaleLimits(390);
  assert.equal(mobileLimits.isMobile, true);
  assert.equal(mobileLimits.baseScale, 0.5);
  assert.equal(mobileLimits.minScale, 0.16);
  assert.equal(mobileLimits.maxScale, 1.4);

  const desktopLimits = controller.calculateScaleLimits(1920);
  assert.equal(desktopLimits.isMobile, false);
  assert.equal(desktopLimits.baseScale, 1.0);
  assert.equal(desktopLimits.minScale, 0.33);
  assert.equal(desktopLimits.maxScale, 2.0);

  // Mock DOM
  const mockSvg = { style: {} };
  const mockContainer = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 })
  };

  let stateSnapshots = [];
  controller.subscribe((state) => {
    stateSnapshots.push(state);
  });

  controller.init(mockContainer, mockSvg, { initialScale: 1.0, initialX: 100, initialY: 50 });
  assert.equal(controller.getState().scale, 1.0);
  assert.equal(controller.getState().x, 100);
  assert.equal(controller.getState().y, 50);
  assert.equal(controller.getState().formattedZoom, "100%");

  // Pan
  controller.pan(50, -30);
  assert.equal(controller.getState().x, 150);
  assert.equal(controller.getState().y, 20);

  // Zoom
  controller.zoom(1.2);
  assert.ok(Math.abs(controller.getState().scale - 1.2) < 0.001);
  assert.equal(controller.getState().formattedZoom, "120%");

  // CenterOn (instant)
  controller.centerOn(2000, 1700, 1.0, false);
  // (1000/2) - 2000*1 = 500 - 2000 = -1500
  // (800/2) - 1700*1 = 400 - 1700 = -1300
  assert.equal(controller.getState().x, -1500);
  assert.equal(controller.getState().y, -1300);

  // Boundary check when scaledWidth <= width
  const smallBounds = controller.getPanBounds(0.2);
  assert.ok(smallBounds.minPanX < smallBounds.maxPanX);
  assert.ok(smallBounds.minPanY < smallBounds.maxPanY);

  // Reset
  controller.reset();
  assert.equal(controller.getState().x, -1500);
  assert.equal(controller.getState().y, -1300);

  controller.destroy();
});

test("ViewportController: destroy followed by init reactivates the controller", () => {
  const mockContainer = {
    clientWidth: 1000,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    addEventListener() {},
    removeEventListener() {}
  };
  const mockSvg = { style: {} };
  const controller = new ViewportController({ mapWidth: 4000, mapHeight: 3400 });

  controller.init(mockContainer, mockSvg, { initialScale: 1.0, initialX: 0, initialY: 0 });
  controller.destroy();
  controller.init(mockContainer, mockSvg, { initialScale: 1.0, initialX: 0, initialY: 0 });
  controller.pan(50, 0);

  assert.equal(controller._isDestroyed, false);
  assert.equal(controller.getState().x, 50);
  assert.equal(mockSvg.style.transform, "translate3d(50px, 0px, 0) scale(1)");
  controller.destroy();
});

test("ViewportController: DOM event dispatching (Pointer drag, Pinch zoom, Wheel zoom)", () => {
  const eventListeners = new Map();
  const mockContainer = {
    addEventListener: (type, handler) => {
      if (!eventListeners.has(type)) eventListeners.set(type, []);
      eventListeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      if (!eventListeners.has(type)) return;
      const list = eventListeners.get(type).filter((h) => h !== handler);
      eventListeners.set(type, list);
    },
    dispatchEvent: (type, event) => {
      const list = eventListeners.get(type) || [];
      list.forEach((h) => h(event));
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 })
  };

  const mockSvg = { style: {} };
  const controller = new ViewportController({ mapWidth: 4000, mapHeight: 3400 });
  controller.init(mockContainer, mockSvg, { initialScale: 1.0, initialX: 0, initialY: 0 });

  // 1. Pointer Drag
  mockContainer.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 200,
    clientY: 200,
    preventDefault: () => {}
  });

  assert.equal(controller.getState().isPanning, true);

  mockContainer.dispatchEvent("pointermove", {
    pointerId: 1,
    clientX: 250,
    clientY: 230,
    preventDefault: () => {}
  });

  assert.equal(controller.getState().x, 50);
  assert.equal(controller.getState().y, 30);

  mockContainer.dispatchEvent("pointerup", {
    pointerId: 1,
    preventDefault: () => {}
  });

  assert.equal(controller.getState().isPanning, false);

  // 2. Wheel Zoom
  const prevScale = controller.getState().scale;
  mockContainer.dispatchEvent("wheel", {
    deltaY: -100, // Zoom in
    clientX: 500,
    clientY: 400,
    preventDefault: () => {}
  });

  assert.ok(controller.getState().scale > prevScale);

  // 3. Destroy removes event listeners
  controller.destroy();
  assert.equal(eventListeners.get("pointerdown").length, 0);
  assert.equal(eventListeners.get("wheel").length, 0);
});

test("LocalStorageAdapter: Key-value persistence with memory fallback", () => {
  const adapter = new LocalStorageAdapter("test_rd2_");
  adapter.clear();

  assert.equal(adapter.getItem("theme"), null);

  adapter.setItem("theme", "dark");
  assert.equal(adapter.getItem("theme"), "dark");

  adapter.setItem("zoom", "150");
  assert.equal(adapter.getItem("zoom"), "150");

  adapter.removeItem("theme");
  assert.equal(adapter.getItem("theme"), null);
  assert.equal(adapter.getItem("zoom"), "150");

  adapter.clear();
  assert.equal(adapter.getItem("zoom"), null);
});

test("LocalStorageAdapter: Reads values written after a localStorage failure", () => {
  const previousWindow = globalThis.window;
  const backing = new Map();
  let failWrites = false;
  globalThis.window = {
    localStorage: {
      get length() {
        return backing.size;
      },
      key(index) {
        return [...backing.keys()][index] ?? null;
      },
      getItem(key) {
        return backing.has(key) ? backing.get(key) : null;
      },
      setItem(key, value) {
        if (failWrites && !String(key).startsWith("__test_")) {
          throw new Error("quota");
        }
        backing.set(String(key), String(value));
      },
      removeItem(key) {
        backing.delete(String(key));
      }
    }
  };

  try {
    const adapter = new LocalStorageAdapter("quota_rd2_");
    failWrites = true;
    adapter.setItem("theme", "dark");

    assert.equal(adapter.getItem("theme"), "dark");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
