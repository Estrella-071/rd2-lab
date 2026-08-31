import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { selectMapResolution } from "../../src/domain/map_resolution.js";
import { buildTreeRenderModel } from "../../src/domain/tree_render_model.js";
import { createSimulationState, getNodeMap } from "../../src/domain/simulation_plan.js";
import { assertMapRenderManifestShape } from "../../src/infra/http_data_repository.js";
import { LruCache, MapTileRepository } from "../../src/infra/map_tile_repository.js";
import { buildCurrencyLabelLayout, getNodeOcclusionGeometry, getSimulationRankBadgeText } from "../../src/ui/canvas_tree_renderer.js";
import { extractCostBadgeAnchor, extractNodeArtworkBounds, extractRankBadgeAnchor, getNodeVariantCss } from "../../scripts/build_map_raster.mjs";

const root = path.resolve(".");
const treeData = JSON.parse(fs.readFileSync(path.join(root, "site/data/dice_tree.json"), "utf8"));

function makeFrame(scale) {
  return { x: 0, y: 0, width: 192 * scale, height: 192 * scale };
}

function makeLabelContext() {
  return {
    font: "",
    save() {},
    restore() {},
    measureText(text) { return { width: String(text).length * 3.5 }; }
  };
}

function makeRenderManifest() {
  const viewBox = { x: 0, y: 0, width: 4000, height: 3400 };
  const tileSize = 512;
  const columns = Math.ceil(viewBox.width / tileSize);
  const rows = Math.ceil(viewBox.height / tileSize);
  const variants = ["normal", "dice-locked", "rune-locked", "passive-locked"];
  const scales = [1, 2, 3];
  const nodes = treeData.nodes.map((node, index) => {
    const x = 100 + (index % 30) * 125;
    const y = 100 + Math.floor(index / 30) * 400;
    const frames = {};
    for (const scale of scales) {
      for (const variant of variants) frames[`${variant}-${scale}x`] = { ...makeFrame(scale), page: 0 };
    }
    return {
      id: String(node.id),
      x,
      y,
      geometry: { width: 122, height: 132, shape: "small-passive" },
      hitBox: { x: x - 61, y: y - 66, width: 122, height: 132 },
      frames
    };
  });
  const tiles = Object.fromEntries(scales.map((scale) => {
    const key = `${scale}x`;
    const files = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        files.push({
          column,
          row,
          path: `map/tiles/${key}/${column}-${row}.png`,
          width: Math.min(tileSize, viewBox.width - column * tileSize),
          height: Math.min(tileSize, viewBox.height - row * tileSize)
        });
      }
    }
    return [key, { scale, columns, rows, files }];
  }));
  const atlas = {};
  for (const scale of scales) {
    for (const variant of variants) {
      const key = `${variant}-${scale}x`;
      atlas[key] = {
        columns: 1,
        rows: 1,
        width: 192 * scale,
        height: 192 * scale,
        pages: [{
          path: `map/atlas/${key}-0.png`,
          columns: 1,
          rows: 1,
          width: 192 * scale,
          height: 192 * scale
        }]
      };
    }
  }
  const center = {};
  for (const variant of ["normal", "simulation"]) {
    center[variant] = {};
    for (const scale of scales) {
      center[variant][scale + "x"] = {
        path: "map/center/" + variant + "-" + scale + "x.png",
        width: 280 * scale,
        height: 220 * scale
      };
    }
  }
  const centerLinks = [
    { key: "center-1", branch: 1, from: { x: 2000, y: 1658 }, to: { x: 2000, y: 1460 }, d: "M 2000 1658 L 2000 1460" },
    { key: "center-2", branch: 2, from: { x: 1965, y: 1736 }, to: { x: 1840, y: 1940 }, d: "M 1965 1736 L 1840 1940" },
    { key: "center-3", branch: 3, from: { x: 2035, y: 1736 }, to: { x: 2160, y: 1940 }, d: "M 2035 1736 L 2160 1940" },
    { key: "center-4", branch: 4, from: { x: 1951, y: 1680 }, to: { x: 1720, y: 1620 }, d: "M 1951 1680 L 1720 1620" },
    { key: "center-5", branch: 5, from: { x: 2049, y: 1680 }, to: { x: 2280, y: 1620 }, d: "M 2049 1680 L 2280 1620" }
  ];
  return {
    schemaVersion: 1,
    assetVersion: "0123456789abcdef",
    viewBox,
    tile: { logicalSize: tileSize, scales: ["1x", "2x", "3x"], columns, rows, tiles },
    atlas,
    center,
    centerLinks,
    nodes,
    edges: treeData.edges.map((edge) => ({
      key: `${edge.from}->${edge.to}`,
      from: String(edge.from),
      to: String(edge.to)
    })),
    generatedFiles: [
      "map-render-manifest.json",
      ...Object.values(tiles).flatMap((tileSet) => tileSet.files.map((entry) => entry.path)),
      ...Object.values(atlas).flatMap((entry) => entry.pages.map((page) => page.path)),
      ...Object.values(center).flatMap((variants) => Object.values(variants).map((entry) => entry.path))
    ]
  };
}

function makeState(overrides = {}) {
  return {
    selectedNodeId: null,
    nodesMap: getNodeMap(treeData),
    filters: { search: "", factions: new Set(), nodeTypes: new Set() },
    matchingNodeIds: new Set(),
    activePrereqIds: new Set(),
    activeEdgeIds: new Set(),
    showPrereqMode: false,
    simulation: { active: false, ranks: {} },
    ...overrides
  };
}

test("Canvas map resolution selects the next available bucket without exceeding the maximum", () => {
  assert.equal(selectMapResolution({ scale: 0.5, devicePixelRatio: 1 }), 1);
  assert.equal(selectMapResolution({ scale: 0.5, devicePixelRatio: 3 }), 2);
  assert.equal(selectMapResolution({ scale: 0.16, devicePixelRatio: 3 }), 1);
  assert.equal(selectMapResolution({ scale: 0.9, devicePixelRatio: 2 }), 2);
  assert.equal(selectMapResolution({ scale: 1, devicePixelRatio: 1 }), 1);
  assert.equal(selectMapResolution({ scale: 1.1, devicePixelRatio: 2 }), 3);
  assert.equal(selectMapResolution({ scale: 2, devicePixelRatio: 2 }), 3);
});

test("Canvas locked silhouettes cover the source art footprint", () => {
  const dice = getNodeOcclusionGeometry("dice");
  const perk = getNodeOcclusionGeometry("perk");
  const largePassive = getNodeOcclusionGeometry("large-passive");
  const smallPassive = getNodeOcclusionGeometry("small-passive");
  const rune = getNodeOcclusionGeometry("rune");

  assert.deepEqual(dice, { kind: "roundedRect", x: -48.24, y: -50.4, width: 96.48, height: 100.8, radius: 11.52 });
  assert.deepEqual(perk, { kind: "roundedRect", x: -48.96, y: -27.36, width: 97.92, height: 54.72, radius: 10.08 });
  assert.deepEqual(largePassive, { kind: "rotatedRoundedRect", size: 68, radius: 14 });
  assert.deepEqual(smallPassive, { kind: "circle", radius: 38 });
  assert.deepEqual(rune, { kind: "ellipse", x: 0, y: 4, radiusX: 27, radiusY: 30 });
});

test("Canvas map LRU cache evicts the least recently used tile", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("Canvas tile repository returns the visible tile plus one prefetch ring", () => {
  const manifest = makeRenderManifest();
  const repository = new MapTileRepository({ manifest });
  const entries = repository.getTileEntries(2, { left: 512, top: 512, right: 513, bottom: 513 });
  assert.equal(entries.length, 9);
  assert.deepEqual(
    entries.map((entry) => `${entry.column},${entry.row}`).sort(),
    ["0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "2,0", "2,1", "2,2"]
  );
  assert.equal(repository.getTileEntries(2, { left: 0, top: 0, right: 1, bottom: 1 }).length, 4);
});

test("Canvas render manifest validates node frames, tile boundaries, and safe generated paths", () => {
  const manifest = makeRenderManifest();
  assert.equal(assertMapRenderManifestShape(manifest), manifest);
  assert.equal(manifest.nodes.length, 239);
  assert.equal(manifest.edges.length, 246);
  assert.equal(manifest.centerLinks.length, 5);

  const unsafe = structuredClone(manifest);
  unsafe.atlas["normal-1x"].pages[0].path = "../outside.png";
  assert.throws(() => assertMapRenderManifestShape(unsafe), /Invalid map render manifest/);
});

test("Raster manifest keeps the canonical currency badge anchor geometry", () => {
  const anchor = extractCostBadgeAnchor(`
    <g transform="scale(0.56)">
      <g class="cost-badge">
        <rect x="-85.3" y="-84" width="170.6" height="28" rx="10" />
      </g>
    </g>
  `);
  assert.deepEqual(anchor, {
    offsetX: 0,
    offsetY: -47.04,
    width: 95.536,
    height: 15.68,
    scale: 0.56
  });
  assert.deepEqual(extractNodeArtworkBounds(`
    <g transform="scale(0.72)">
      <g class="node-body">
        <rect x="-67" y="-70" width="134" height="140" />
        <use class="dice-shadow" x="-87" y="-52" width="138" height="133" />
        <use class="node-icon" x="-63.72" y="-88.76" width="127.44" height="158.76" />
      </g>
    </g>
  `), {
    x: -45.878,
    y: -63.907,
    width: 91.757,
    height: 114.307,
    scale: 0.72
  });

  const manifest = makeRenderManifest();
  manifest.nodes[0].labelAnchor = anchor;
  manifest.nodes[0].artworkBounds = extractNodeArtworkBounds(`
    <g transform="scale(0.72)"><g class="node-body"><use class="node-icon" x="-63.72" y="-88.76" width="127.44" height="158.76" /></g></g>
  `);
  assert.equal(assertMapRenderManifestShape(manifest), manifest);
  const invalid = structuredClone(manifest);
  invalid.nodes[0].labelAnchor.offsetX = "not-a-number";
  assert.throws(() => assertMapRenderManifestShape(invalid), /Invalid map render manifest/);
  const invalidArtwork = structuredClone(manifest);
  invalidArtwork.nodes[0].artworkBounds.width = 0;
  assert.throws(() => assertMapRenderManifestShape(invalidArtwork), /Invalid map render manifest/);
});

test("Raster manifest keeps canonical rank badge geometry and only upgradeable nodes receive it", () => {
  const rankAnchor = extractRankBadgeAnchor(`
    <g transform="scale(0.56)">
      <g class="rank-badge">
        <rect x="-30" y="54" width="60" height="22" rx="5.5" />
        <text class="rank-value" x="0" y="69.5">1/50</text>
      </g>
    </g>
  `);
  assert.deepEqual(rankAnchor, {
    offsetX: 0,
    offsetY: 30.24,
    width: 33.6,
    height: 12.32,
    radius: 3.08,
    textOffsetX: 0,
    textOffsetY: 38.92,
    textSize: 7.84,
    strokeWidth: 0.84,
    scale: 0.56
  });
  assert.equal(extractRankBadgeAnchor(`
    <g transform="scale(0.72)"><g class="node-body"><rect /></g></g>
  `), null);

  const manifest = makeRenderManifest();
  manifest.nodes[0].rankAnchor = rankAnchor;
  assert.equal(assertMapRenderManifestShape(manifest), manifest);
  const invalid = structuredClone(manifest);
  invalid.nodes[0].rankAnchor.textSize = 0;
  assert.throws(() => assertMapRenderManifestShape(invalid), /Invalid map render manifest/);
});

test("Canvas rank labels match the canonical upgradeable-node contract", () => {
  assert.equal(getSimulationRankBadgeText({ maxRank: 1, rank: 0 }, true), null);
  assert.equal(getSimulationRankBadgeText({ maxRank: 1, rank: 1 }, false), null);
  assert.equal(getSimulationRankBadgeText({ maxRank: 50, rank: 0 }, true), "0/50");
  assert.equal(getSimulationRankBadgeText({ maxRank: 50, rank: 50 }, true), "50/50");
  assert.equal(getSimulationRankBadgeText({ maxRank: 100, rank: 100 }, true), "100/100");
  assert.equal(getSimulationRankBadgeText({ maxRank: 50, rank: 50 }, false), "1/50");
});

test("Currency label layout uses compact source geometry and avoids adjacent node collisions", () => {
  const context = makeLabelContext();
  const nodes = [
    {
      id: "left",
      x: 100,
      y: 200,
      node: { gold_costs: [50000], core_costs: [10] },
      labelAnchor: { offsetX: 0, offsetY: -47.04, width: 95.536, height: 15.68, scale: 0.56 },
      hitBox: { x: 50, y: 150, width: 100, height: 100 }
    },
    {
      id: "right",
      x: 180,
      y: 200,
      node: { gold_costs: [100000], core_costs: [20] },
      labelAnchor: { offsetX: 0, offsetY: -47.04, width: 101, height: 15.68, scale: 0.56 },
      hitBox: { x: 130, y: 150, width: 100, height: 100 }
    }
  ];
  const layout = buildCurrencyLabelLayout(context, nodes, { getIntlLocale: () => "zh-TW" });
  const left = layout.get("left");
  const right = layout.get("right");
  assert.ok(left && right);
  assert.ok(left.width <= 101 && left.height <= 16, "labels should use the compact raster scale");
  assert.ok(right.y < right.height + nodes[1].y - 47.04, "the colliding label should move to a nearby free lane");
  assert.ok(
    left.x - left.width / 2 >= right.x + right.width / 2
      || right.x - right.width / 2 >= left.x + left.width / 2
      || left.y + left.height <= right.y
      || right.y + right.height <= left.y,
    "adjacent currency labels must not overlap"
  );
  assert.ok(Number.isFinite(left.metrics.contentCenter), "currency content should expose a centered group anchor");
  assert.ok(Number.isFinite(right.metrics.contentCenter), "currency content should expose a centered group anchor");
});

test("Canvas render model includes the five central prerequisite highlight links", () => {
  const manifest = makeRenderManifest();
  const fixture = {
    nodes: [
      { id: "1", name_zh: "Nature", node_type: "PLAYER_PASSIVE", branch: 1 },
      { id: "2", name_zh: "Engineering", node_type: "PLAYER_PASSIVE", branch: 2 },
      { id: "3", name_zh: "Magic", node_type: "PLAYER_PASSIVE", branch: 3 }
    ],
    edges: []
  };
  const nodesMap = getNodeMap(fixture);
  const model = buildTreeRenderModel({
    treeData: fixture,
    state: makeState({
      nodesMap,
      activePrereqIds: new Set(["1", "2"]),
      showPrereqMode: true
    }),
    renderManifest: manifest
  });

  assert.equal(model.centerLinks.length, 5);
  assert.equal(model.centerLinks.find((link) => link.branch === 1).isPrereqActive, true);
  assert.equal(model.centerLinks.find((link) => link.branch === 2).isPrereqActive, true);
  assert.equal(model.centerLinks.find((link) => link.branch === 3).isPrereqActive, false);
});

test("Canvas render manifest rejects atlas pages that exceed the safe texture size", () => {
  const oversized = makeRenderManifest();
  oversized.atlas["normal-3x"].pages[0] = {
    ...oversized.atlas["normal-3x"].pages[0],
    columns: 8,
    width: 8 * 192 * 3
  };
  assert.throws(() => assertMapRenderManifestShape(oversized), /Invalid map render manifest/);
});

test("Canvas render model preserves topology, localization, and simulation lock variants", () => {
  const manifest = makeRenderManifest();
  const localizedTreeData = {
    ...treeData,
    nodes: treeData.nodes.map((node) => String(node.id) === "1001"
      ? { ...node, _nameKey: "node.1001.name" }
      : node)
  };
  const localization = {
    getLocale: () => "en",
    t: (key, _tokens, fallback) => key === "node.1001.name" ? "Localized Fire" : fallback
  };
  const normal = buildTreeRenderModel({
    treeData: localizedTreeData,
    state: makeState(),
    renderManifest: manifest,
    localization
  });
  assert.equal(normal.nodes.length, 239);
  assert.equal(normal.edges.length, 246);
  assert.equal(normal.nodesById.get("1001").label, "Localized Fire");
  assert.equal(normal.nodesById.get("1001").x, manifest.nodes[0].x);
  assert.equal(normal.nodesById.get("1001").hitBox.width, 122);

  const simulation = createSimulationState(treeData, { active: true });
  const levelGateNode = treeData.nodes.find((node) => ["LV_Nature", "LV_Engineering", "LV_Magic"].includes(node.unlock_condition));
  assert.ok(levelGateNode, "canonical data must include a faction-level gate");
  const locked = buildTreeRenderModel({
    treeData,
    state: makeState({ simulation }),
    renderManifest: manifest,
    localization
  });
  const lockedNode = locked.nodesById.get(String(levelGateNode.id));
  assert.equal(lockedNode.simulationView.isSpecial, true);
  assert.equal(lockedNode.simulationVariant, "passive-locked");

  const rewardRoot = buildTreeRenderModel({
    treeData,
    state: makeState({
      simulation,
      renderUnlockState: { preUnlockedIds: new Set(["5008"]), renderUnlockedIds: new Set() }
    }),
    renderManifest: manifest,
    localization
  });
  const hiddenRewardRoot = rewardRoot.nodesById.get("5008");
  assert.equal(hiddenRewardRoot.rank, 0);
  assert.equal(hiddenRewardRoot.simulationView.isVisible, false);
  assert.equal(hiddenRewardRoot.simulationVariant, "dice-locked");
});

test("Simulation topology stops at visible but locked gates", () => {
  const fixture = {
    nodes: [
      { id: "1", name_zh: "Root", node_type: "DICE", branch: 1, gold_costs: [0], core_costs: [0] },
      { id: "2", name_zh: "Gate", node_type: "PLAYER_PASSIVE", branch: 1, unlock_condition: "LV_Nature", unlock_condition_value: 2 },
      { id: "3", name_zh: "Locked", node_type: "PLAYER_PASSIVE", branch: 1 }
    ],
    edges: [
      { from: "1", to: "2" },
      { from: "2", to: "3" }
    ]
  };
  const nodesMap = getNodeMap(fixture);
  const simulation = createSimulationState(fixture, { active: true, ranks: { "1": 1 } });
  const model = buildTreeRenderModel({
    treeData: fixture,
    state: makeState({ nodesMap, simulation })
  });
  const gate = model.nodesById.get("2");

  assert.equal(gate.simulationView.isVisible, true);
  assert.equal(gate.simulationView.isUnlocked, false);
  assert.equal(model.edges.find((edge) => edge.key === "1->2").isSimulationActive, false);
  assert.equal(model.edges.find((edge) => edge.key === "2->3").isSimulationActive, false);
});

test("Locked dice atlas filters icon art without filtering the node frame", () => {
  const css = getNodeVariantCss("dice-locked");

  assert.match(css, /\.node-body \.node-icon/);
  assert.match(css, /\.node-body \.node-icon-flat/);
  assert.match(css, /\.node-body \.node-icon-deep/);
  assert.doesNotMatch(css, /\.node-body\{[^}]*filter/);
  assert.doesNotMatch(css, /\.node-body (?:image|use)/);
});

test("Locked passive atlas dims the node without grayscale filtering its frame", () => {
  const css = getNodeVariantCss("passive-locked");

  assert.match(css, /\.node\{opacity:\.52;filter:none!important\}/);
  assert.match(css, /\.node-body>circle\{fill:#5c4d83!important\}/);
  assert.doesNotMatch(css, /grayscale/);
  assert.doesNotMatch(css, /\.node-body \.node-icon/);
});

test("Canvas render model keeps prerequisite dimming after tooltip close", () => {
  const fixture = {
    nodes: [
      { id: "1", name_zh: "Root", node_type: "PLAYER_PASSIVE", branch: 1 },
      { id: "2", name_zh: "Path", node_type: "PLAYER_PASSIVE", branch: 1 },
      { id: "3", name_zh: "Selected", node_type: "PLAYER_PASSIVE", branch: 1 },
      { id: "4", name_zh: "Unrelated", node_type: "PLAYER_PASSIVE", branch: 1 }
    ],
    edges: [
      { from: "1", to: "2" },
      { from: "2", to: "3" }
    ]
  };
  const nodesMap = getNodeMap(fixture);
  const pathIds = new Set(["1", "2", "3"]);
  const pathEdges = new Set(["1->2", "2->3"]);
  const selected = buildTreeRenderModel({
    treeData: fixture,
    state: makeState({
      nodesMap,
      selectedNodeId: "3",
      activePrereqIds: pathIds,
      activeEdgeIds: pathEdges,
      showPrereqMode: true
    }),
    renderManifest: { viewBox: { x: 0, y: 0, width: 4000, height: 3400 } }
  });
  const afterTooltipClose = buildTreeRenderModel({
    treeData: fixture,
    state: makeState({
      nodesMap,
      selectedNodeId: null,
      activePrereqIds: pathIds,
      activeEdgeIds: pathEdges,
      showPrereqMode: true
    }),
    renderManifest: { viewBox: { x: 0, y: 0, width: 4000, height: 3400 } }
  });

  assert.equal(selected.nodesById.get("4").isDimmed, true);
  assert.equal(afterTooltipClose.nodesById.get("1").isDimmed, false);
  assert.equal(afterTooltipClose.nodesById.get("4").isDimmed, true);
  assert.equal(afterTooltipClose.edges.find((edge) => edge.key === "1->2").isDimmed, false);
  assert.equal(afterTooltipClose.edges.find((edge) => edge.key === "2->3").isDimmed, false);
});
