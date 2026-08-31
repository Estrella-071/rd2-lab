import test from "node:test";
import assert from "node:assert/strict";

import {
  DataRepositoryPort,
  ViewportPort,
  StoragePort
} from "../../src/app/ports/index.js";

import {
  HttpDataRepository,
  ViewportController,
  LocalStorageAdapter
} from "../../src/infra/index.js";

test("Ports: Abstract base classes enforce method implementation", async () => {
  const dataRepo = new DataRepositoryPort();
  await assert.rejects(() => dataRepo.loadDiceTree(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadDiceTreeSvg(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadBossEvents(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadMonsterPosters(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadGameMetadata(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadChangelog(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadLocales(), /must be implemented/);
  await assert.rejects(() => dataRepo.loadAll(), /must be implemented/);
  assert.throws(() => dataRepo.clearCache(), /must be implemented/);

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
  const requestOptions = [];
  const mockFetch = async (url, options) => {
    fetchLog.push(url);
    requestOptions.push(options);
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
    if (url === "monster_posters.json" || url === "data/monster_posters.json") {
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

  // 4. Monster posters default path
  const posters = await repo.loadMonsterPosters();
  assert.ok(posters.monsters.monster_1);
  assert.equal(fetchLog.length, 3);
  assert.equal(fetchLog[2], "monster_posters.json");

  // 5. loadAll
  const allData = await repo.loadAll();
  assert.ok(allData.treeData);
  assert.ok(allData.bossEvents);
  assert.ok(allData.monsterPosters);
  assert.deepEqual(allData.locales.locales, ["zh-tw", "en", "ja", "ko"]);
  assert.ok(requestOptions.length > 0);
  assert.ok(requestOptions.every(options => options?.cache === "no-store"));

  // 6. Fallback test: when primary fails, try fallback path
  const failingPrimaryFetch = async (url) => {
    fetchLog.push(`fallback_check:${url}`);
    if (url === "boss_event_data.json" || url === "monster_posters.json") {
      return { ok: false, status: 404 };
    }
    if (url === "data/boss_event_data.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [{ id: "E02", title: "隕石" }] })
      };
    }
    if (url === "data/monster_posters.json") {
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
  const fallbackPosters = await repoFallback.loadMonsterPosters("monster_posters.json");
  assert.ok(fallbackPosters.monsters.monster_2);

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
    { monsters: { monster_1: { poster: "../outside.png" } } },
    { monsters: { monster_1: {} } }
  ]) {
    const malformedPosterRepo = new HttpDataRepository({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => payload })
    });
    await assert.rejects(() => malformedPosterRepo.loadMonsterPosters(), /Invalid monster poster data format/);
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
  assert.equal(mockSvg.style.transform, "translate(50px, 0px) scale(1)");
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

test("ViewportController: pinch zoom reuses the cached container offset", () => {
  let rectReads = 0;
  const mockContainer = {
    clientWidth: 390,
    clientHeight: 844,
    getBoundingClientRect: () => {
      rectReads += 1;
      return { left: 12, top: 24, width: 390, height: 844 };
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const controller = new ViewportController({ mapWidth: 4000, mapHeight: 3400 });
  controller.init(mockContainer, { style: {} }, { initialScale: 0.5, initialX: 0, initialY: 0 });

  const initialReads = rectReads;
  controller.zoom(1.05, 200, 400);
  controller.zoom(1.05, 200, 400);

  assert.equal(rectReads, initialReads);
  controller.destroy();
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
