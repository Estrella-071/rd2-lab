import test from "node:test";
import assert from "node:assert/strict";

import { DataRepositoryPort } from "../../src/app/ports/data_repository_port.js";
import { buildTreeRenderModel, resolveNodeFrame } from "../../src/domain/tree_render_model.js";
import { getNodeMap } from "../../src/domain/simulation_plan.js";
import { HttpDataRepository, assertSafeDiceTreeSvg } from "../../src/infra/http_data_repository.js";
import { MapTileRepository } from "../../src/infra/map_tile_repository.js";
import { generateSimulationShareImage } from "../../src/infra/share_image_exporter.js";

const MANIFEST_VARIANTS = ["normal", "dice-locked", "rune-locked", "passive-locked"];
const MANIFEST_SCALES = [1, 2, 3];

function makeValidManifest() {
  const viewBox = { x: 0, y: 0, width: 1024, height: 1024 };
  const tileSize = 512;
  const columns = 2;
  const rows = 2;
  const atlas = {};
  const atlasPaths = [];
  for (const scale of MANIFEST_SCALES) {
    for (const variant of MANIFEST_VARIANTS) {
      const key = `${variant}-${scale}x`;
      const path = `map/atlas/${key}.png`;
      atlas[key] = {
        columns: 1,
        rows: 1,
        width: 192 * scale,
        height: 192 * scale,
        pages: [{ path, columns: 1, rows: 1, width: 192 * scale, height: 192 * scale }]
      };
      atlasPaths.push(path);
    }
  }

  const frameKeys = MANIFEST_SCALES.flatMap((scale) => MANIFEST_VARIANTS.map((variant) => `${variant}-${scale}x`));
  const nodes = Array.from({ length: 239 }, (_, index) => ({
    id: String(index),
    x: 100 + index,
    y: 100 + index,
    hitBox: { x: 90 + index, y: 90 + index, width: 122, height: 132 },
    frames: Object.fromEntries(frameKeys.map((key) => {
      const scale = Number.parseInt(key.match(/(\d)x$/)[1], 10);
      return [key, { x: 0, y: 0, width: 192 * scale, height: 192 * scale, page: 0 }];
    }))
  }));
  const tileSets = Object.fromEntries(MANIFEST_SCALES.map((scale) => {
    const key = `${scale}x`;
    const files = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        files.push({
          column,
          row,
          width: tileSize,
          height: tileSize,
          path: `map/tiles/${key}/${column}-${row}.png`
        });
      }
    }
    return [key, { scale, columns, rows, files }];
  }));
  const tilePaths = Object.values(tileSets).flatMap((set) => set.files.map((entry) => entry.path));
  const center = {};
  const centerPaths = [];
  for (const variant of ["normal", "simulation"]) {
    center[variant] = {};
    for (const scale of MANIFEST_SCALES) {
      const key = `${scale}x`;
      const path = `map/center/${variant}-${key}.png`;
      center[variant][key] = { path, width: 280 * scale, height: 220 * scale };
      centerPaths.push(path);
    }
  }

  return {
    schemaVersion: 1,
    assetVersion: "0123456789abcdef",
    viewBox,
    tile: { logicalSize: tileSize, scales: ["1x", "2x", "3x"], columns, rows, tiles: tileSets },
    atlas,
    center,
    centerLinks: Array.from({ length: 5 }, (_, index) => ({
      key: `center-${index + 1}`,
      branch: index + 1,
      from: { x: index, y: index },
      to: { x: index + 1, y: index + 1 },
      d: `M ${index} ${index} L ${index + 1} ${index + 1}`
    })),
    nodes,
    edges: Array.from({ length: 246 }, (_, index) => ({ key: `edge-${index}`, from: "0", to: "1" })),
    generatedFiles: ["map-render-manifest.json", ...tilePaths, ...atlasPaths, ...centerPaths]
  };
}

class FakeImage {
  constructor(mode = "load") {
    this.mode = mode;
    this.decodeCalls = 0;
    this.closed = false;
  }

  set src(value) {
    this.srcValue = value;
    queueMicrotask(() => {
      if (this.mode === "error") this.onerror?.();
      else if (this.mode !== "pending") this.onload?.();
    });
  }

  async decode() {
    this.decodeCalls += 1;
    if (this.mode === "decode-error") throw new Error("decode failed");
  }

  close() {
    this.closed = true;
  }
}

function makeCanvasContext() {
  const calls = [];
  const context = {
    calls,
    beginPath: () => calls.push("beginPath"),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    arcTo: (...args) => calls.push(["arcTo", ...args]),
    arc: (...args) => calls.push(["arc", ...args]),
    closePath: () => calls.push("closePath"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    fillText: (...args) => calls.push(["fillText", ...args]),
    strokeText: (...args) => calls.push(["strokeText", ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    setTransform: (...args) => calls.push(["setTransform", ...args])
  };
  return context;
}

function makeCanvas(context, { contextAvailable = true } = {}) {
  return {
    width: 0,
    height: 0,
    getContext: () => contextAvailable ? context : null,
    toDataURL: () => "data:image/png;base64,ZmFrZQ==",
    toBlob: (callback) => callback({ type: "image/png" })
  };
}

test("MapTileRepository covers manifest loading, decode fallback, and failures", async () => {
  const manifest = makeValidManifest();
  const fetched = [];
  const manifestRepository = new MapTileRepository({
    manifest: null,
    manifestUrl: "render-manifest.json",
    fetchFn: async (url, options) => {
      fetched.push({ url, options });
      return { ok: true, status: 200, json: async () => manifest };
    }
  });
  assert.equal(await manifestRepository.loadManifest(), manifest);
  assert.deepEqual(fetched, [{ url: "render-manifest.json", options: { cache: "no-store" } }]);
  assert.equal(await manifestRepository.loadManifest(), manifest);

  const previousBitmap = globalThis.createImageBitmap;
  try {
    const images = [];
    globalThis.createImageBitmap = async (image) => ({ source: image, close() {} });
    const repository = new MapTileRepository({
      manifest,
      imageFactory: () => {
        const image = new FakeImage();
        images.push(image);
        return image;
      },
      imageTimeoutMs: 50
    });
    const first = repository.loadImage("map/tiles/1x/0-0.png");
    const second = repository.loadImage("map/tiles/1x/0-0.png");
    const bitmap = await first;
    assert.equal(await second, bitmap);
    assert.equal(images.length, 1);
    assert.equal(repository.getCachedImage("map/tiles/1x/0-0.png"), bitmap);
    await assert.rejects(() => repository.loadImage(""), /path is empty/);
    repository.destroy();

    delete globalThis.createImageBitmap;
    const fallbackImages = [];
    const fallbackRepository = new MapTileRepository({
      manifest,
      imageFactory: () => {
        const image = new FakeImage();
        fallbackImages.push(image);
        return image;
      }
    });
    const fallbackImage = await fallbackRepository.loadImage("fallback.png");
    assert.equal(fallbackImage, fallbackImages[0]);
    assert.equal(fallbackImages[0].decodeCalls, 1);
    fallbackRepository.destroy();

    const errorRepository = new MapTileRepository({
      manifest,
      imageFactory: () => new FakeImage("error"),
      imageTimeoutMs: 50
    });
    await assert.rejects(() => errorRepository.loadImage("error.png"), /Failed to load map raster/);
    const timeoutRepository = new MapTileRepository({
      manifest,
      imageFactory: () => new FakeImage("pending"),
      imageTimeoutMs: 1
    });
    await assert.rejects(() => timeoutRepository.loadImage("timeout.png"), /Timed out loading map raster/);
    errorRepository.destroy();
    timeoutRepository.destroy();
  } finally {
    if (previousBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousBitmap;
  }
});

test("MapTileRepository covers prefetch, warm queue, resolution preload, and release", async () => {
  const manifest = makeValidManifest();
  const previousDocument = globalThis.document;
  const previousIdleCallback = globalThis.requestIdleCallback;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  const links = [];
  const head = {
    appendChild(link) {
      link.parentElement = head;
      links.push(link);
    }
  };
  globalThis.document = {
    baseURI: "https://example.test/",
    head,
    createElement: (tag) => {
      assert.equal(tag, "link");
      return {
        dataset: {},
        remove() { this.removed = true; }
      };
    },
    querySelectorAll: () => links
  };
  delete globalThis.requestIdleCallback;
  delete globalThis.requestAnimationFrame;

  try {
    const images = [];
    const repository = new MapTileRepository({
      manifest,
      imageFactory: () => {
        const image = new FakeImage();
        images.push(image);
        return image;
      },
      cacheLimit: 8
    });
    const prefetch = repository.prefetchImage("map/one.png");
    assert.strictEqual(repository.prefetchImage("map/one.png"), prefetch);
    assert.equal(links.length, 1);
    links[0].onload();
    await prefetch;
    const batchPrefetch = repository.prefetchImages(["map/two.png", "map/two.png", "map/three.png"]);
    assert.equal(links.length, 3);
    links[1].onload();
    links[2].onload();
    await batchPrefetch;
    const failedPrefetch = repository.prefetchImage("map/fail.png");
    assert.equal(links.length, 4);
    links[3].onerror();
    await assert.rejects(() => failedPrefetch, /Failed to prefetch map raster/);

    const warmResult = await repository.warmImages(["warm-a.png", "warm-b.png"]);
    assert.equal(warmResult, true);
    let checks = 0;
    const interrupted = await repository.warmImages(["warm-c.png", "warm-d.png"], {
      shouldContinue: () => {
        checks += 1;
        return checks === 1;
      }
    });
    assert.equal(interrupted, false);

    const visible = await repository.preloadVisible({
      scale: 2,
      bounds: { left: 512, top: 512, right: 513, bottom: 513 },
      prefetchRadius: 0
    });
    assert.equal(visible.length, 1);
    assert.equal(repository.currentResolution, 2);
    const all = await repository.preloadAll(3);
    assert.equal(all.length, 4);
    const ensured = await repository.ensureResolution({
      scale: 0.5,
      devicePixelRatio: 1,
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      motion: true,
      prefetchRadius: 0
    });
    assert.equal(ensured.length, 1);
    assert.equal(repository.currentResolution, 3);

    await repository.loadImage("release-me.png");
    assert.equal(repository.releaseImage("release-me.png"), true);
    assert.equal(repository.releaseImage("missing.png"), false);
    repository.destroy();
    assert.equal(repository.cache.size, 0);
    assert.equal(repository.currentResolution, null);
    assert.ok(images.some((image) => image.closed));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousIdleCallback === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = previousIdleCallback;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("HttpDataRepository covers Canvas manifest and optional companion documents", async () => {
  const manifest = makeValidManifest();
  const responses = new Map([
    ["manifest.json", { ok: true, status: 200, json: async () => manifest }],
    ["meta.json", { ok: true, status: 200, json: async () => ({ version: "1.0.3" }) }],
    ["changes.json", { ok: true, status: 200, json: async () => ({ entries: [] }) }],
    ["locales.json", { ok: true, status: 200, json: async () => ({ schema_version: 1, locales: ["zh-tw", "en", "ja", "ko"] }) }]
  ]);
  const calls = [];
  const repository = new HttpDataRepository({
    renderManifestUrl: "manifest.json",
    gameMetadataUrl: "meta.json",
    changelogUrl: "changes.json",
    localesUrl: "locales.json",
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return responses.get(url) || { ok: false, status: 404 };
    }
  });
  assert.equal(await repository.loadRenderManifest(), manifest);
  assert.deepEqual(await repository.loadGameMetadata(), { version: "1.0.3" });
  assert.deepEqual(await repository.loadChangelog(), { entries: [] });
  assert.deepEqual((await repository.loadLocales()).locales, ["zh-tw", "en", "ja", "ko"]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ options }) => options.cache === "no-store"));

  const invalid = new HttpDataRepository({
    renderManifestUrl: "manifest.json",
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ invalid: true }) })
  });
  await assert.rejects(() => invalid.loadRenderManifest(), /Invalid map render manifest/);

  const invalidOptional = new HttpDataRepository({
    gameMetadataUrl: "meta.json",
    changelogUrl: "changes.json",
    localesUrl: "locales.json",
    fetchFn: async (url) => ({
      ok: true,
      status: 200,
      json: async () => url === "locales.json" ? { schema_version: 2, locales: [] } : null
    })
  });
  await assert.rejects(() => invalidOptional.loadGameMetadata(), /Invalid game metadata/);
  await assert.rejects(() => invalidOptional.loadChangelog(), /Invalid changelog/);
  await assert.rejects(() => invalidOptional.loadLocales(), /Invalid locale catalog/);
  assert.throws(() => assertSafeDiceTreeSvg(""), /Invalid dice tree SVG/);
});

test("DataRepositoryPort exposes the Canvas manifest contract", async () => {
  await assert.rejects(() => new DataRepositoryPort().loadRenderManifest(), /must be implemented/);
});

test("Tree render model covers linked runes and frame fallback", () => {
  const nodes = [
    { id: "1", node_type: "DICE", dice_type: "Fire", name_zh: "火骰子", x: 100, y: 100 },
    { id: "2", node_type: "DICE_RUNE", rune_dice: "Fire", name_zh: "火符文", x: 200, y: 100 },
    { id: "3", node_type: "DICE_RUNE", rune_dice: "Ice", name_zh: "冰符文", x: 300, y: 100 }
  ];
  const nodesMap = getNodeMap({ nodes });
  const model = buildTreeRenderModel({
    treeData: { nodes, edges: [] },
    state: {
      selectedNodeId: "1",
      nodesMap,
      filters: { search: "", factions: new Set(), nodeTypes: new Set() },
      matchingNodeIds: new Set(),
      activePrereqIds: new Set(),
      activeEdgeIds: new Set(),
      showPrereqMode: false,
      simulation: { active: false, ranks: {} }
    }
  });
  assert.deepEqual([...model.linkedSelectedIds], ["2"]);
  assert.deepEqual(resolveNodeFrame({ frame: { "normal-1x": { id: "normal" } } }, "dice-locked", 1), { id: "normal" });
  assert.equal(resolveNodeFrame({ frame: {} }, "normal", 1), null);
});

test("Share image renderer produces a high-DPI PNG result and fails closed", async () => {
  const context = makeCanvasContext();
  const canvas = makeCanvas(context);
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1),
    node_type: "DICE",
    dice_type: "Fire",
    name_zh: `火骰子${index + 1}`
  }));
  const simulation = {
    spent: { gold: 50000, core: 10 },
    team: { dice: nodes.map((node) => ({ id: node.id })) }
  };
  const rendered = await generateSimulationShareImage({
    simulation,
    treeData: { nodes, edges: [] },
    canvas,
    width: 1200,
    height: 800,
    scale: 3,
    renderTree: async ({ context: renderContext }) => {
      renderContext.fillRect(0, 0, 10, 10);
      return true;
    }
  });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.layout.width, 3600);
  assert.equal(canvas.width, 3600);
  assert.equal(rendered.blob.type, "image/png");
  assert.ok(context.calls.some((call) => Array.isArray(call) && call[0] === "setTransform"));

  const unavailable = await generateSimulationShareImage({ simulation, treeData: { nodes, edges: [] }, canvas: makeCanvas(context, { contextAvailable: false }) });
  assert.deepEqual(unavailable, {
    ok: false,
    error: "context-unavailable",
    layout: { width: 3200, height: 2000, logicalWidth: 1600, logicalHeight: 1000, scale: 2 }
  });
  const missingRenderer = await generateSimulationShareImage({ simulation, treeData: { nodes, edges: [] }, canvas: makeCanvas(context) });
  assert.equal(missingRenderer.error, "tree-renderer-unavailable");
  const failedRenderer = await generateSimulationShareImage({
    simulation,
    treeData: { nodes, edges: [] },
    canvas: makeCanvas(context),
    renderTree: async () => { throw new Error("renderer failed"); }
  });
  assert.equal(failedRenderer.ok, false);
  assert.equal(failedRenderer.error, "renderer failed");
  const noCanvas = await generateSimulationShareImage({ simulation, treeData: { nodes, edges: [] } });
  assert.equal(noCanvas.error, "canvas-unavailable");
});
