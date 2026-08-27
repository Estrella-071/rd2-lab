import test from "node:test";
import assert from "node:assert/strict";

import { AppStore } from "../../src/app/store/app_store.js";
import {
  LoadGameDataUseCase,
  SelectNodeUseCase,
  SyncGolemRankUseCase,
  FilterTreeUseCase,
  NavigateViewportUseCase
} from "../../src/app/usecases/index.js";
import { HttpDataRepository } from "../../src/infra/http_data_repository.js";
import { ViewportController } from "../../src/infra/viewport_controller.js";

test("UseCases: LoadGameDataUseCase fetches datasets and initializes store", async () => {
  const store = new AppStore();
  const mockFetch = async (url) => {
    if (url.includes("dice_tree.svg")) {
      return {
        ok: true,
        status: 200,
        text: async () => "<svg><g class='tree-node' data-node-id='101'></g></svg>"
      };
    }
    if (url.includes("dice_tree")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nodes: [{ id: "101", name: "骰子A" }],
          edges: [],
          factions: {}
        })
      };
    }
    if (url.includes("monster_visuals")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          monsters: {
            "monster_1": {
              poster: "icons/monster_1.png",
              spine: { skeleton: "m1.skel", atlas: "m1.atlas", texture: "m1.png", animation: "idle" }
            }
          }
        })
      };
    }
    if (url.includes("locales")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ schema_version: 1, default_locale: "zh-tw", locales: ["zh-tw", "en", "ja", "ko"] })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        events: [{ id: "EV1" }],
        monsters: [{ id: "monster_1", name_zh: "普通怪" }]
      })
    };
  };

  const dataRepo = new HttpDataRepository({ fetchFn: mockFetch });
  const loadUseCase = new LoadGameDataUseCase({ store, dataRepository: dataRepo });

  const result = await loadUseCase.execute();
  assert.equal(result.treeData.nodes.length, 1);
  assert.ok(result.svgText.includes("<svg>"));
  assert.equal(result.bossEvents.events.length, 1);
  assert.equal(result.bossEvents.monsters[0].poster, "icons/monster_1.png");
  assert.equal(result.bossEvents.monsters[0].spine.skeleton, "m1.skel");
  assert.equal(store.getState().isDataLoaded, true);
  assert.equal(store.getState().nodesMap.size, 1);
});

test("UseCases: LoadGameDataUseCase keeps cached boss events immutable during visual enrichment", async () => {
  const store = new AppStore();
  const rawBossEvents = { events: [], monsters: [{ id: "monster_1", name_zh: "普通怪" }] };
  let visuals = {
    monsters: {
      monster_1: {
        poster: "icons/monster_v1.png",
        spine: { skeleton: "v1.skel", atlas: "v1.atlas", texture: "v1.png", animation: "idle" }
      }
    }
  };
  const dataRepository = {
    loadDiceTree: async () => ({ nodes: [], edges: [] }),
    loadDiceTreeSvg: async () => "<svg></svg>",
    loadBossEvents: async () => rawBossEvents,
    loadMonsterVisuals: async () => visuals
  };
  const loadUseCase = new LoadGameDataUseCase({ store, dataRepository });

  const first = await loadUseCase.execute();
  visuals = {
    monsters: {
      monster_1: {
        poster: "icons/monster_v2.png",
        spine: { skeleton: "v2.skel", atlas: "v2.atlas", texture: "v2.png", animation: "idle" }
      }
    }
  };
  const second = await loadUseCase.execute();

  assert.equal(rawBossEvents.monsters[0].poster, undefined);
  assert.equal(rawBossEvents.monsters[0].spine, undefined);
  assert.equal(first.bossEvents.monsters[0].poster, "icons/monster_v1.png");
  assert.equal(second.bossEvents.monsters[0].poster, "icons/monster_v2.png");
  assert.equal(second.bossEvents.monsters[0].spine.skeleton, "v2.skel");
  assert.equal(store.getState().bossEvents.monsters[0].poster, "icons/monster_v2.png");
});

test("UseCases: SelectNodeUseCase selects node and calculates smart avoidance", () => {
  const store = new AppStore();
  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [
        { id: "1", name: "Parent", next_nodes: ["2"] },
        { id: "2", name: "Child", incoming: ["1"] }
      ],
      edges: [{ source: "1", target: "2" }]
    }
  });

  const selectUseCase = new SelectNodeUseCase({ store });

  const nodePositions = new Map([
    ["1", { x: 500, y: 300 }], // Parent above child
    ["2", { x: 500, y: 500 }]  // Child below parent
  ]);

  const res = selectUseCase.execute("2", {
    point: { x: 500, y: 500 },
    nodePositions
  });

  assert.equal(res.selectedNode.name, "Child");
  assert.equal(res.activePrereqs.has("1"), true);
  assert.equal(res.isPlacedBelow, true); // Since parent is above (avg Y < pt.y - 40)

  selectUseCase.deselect();
  assert.equal(store.getState().selectedNodeId, null);
});

test("UseCases: SyncGolemRankUseCase updates golem stats", () => {
  const store = new AppStore();
  const syncUseCase = new SyncGolemRankUseCase({ store });

  const g = syncUseCase.execute("rank", 15);
  assert.equal(g.rank, 15);
  assert.equal(g.lifePercent, 750);
  assert.equal(g.coopSp, 7500);
  assert.equal(g.battleSp, 7500);
});

test("UseCases: FilterTreeUseCase handles search, faction, and node type filters", () => {
  const store = new AppStore();
  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [
        { id: "1", name: "自然骰子", faction: 1, type: "DICE" },
        { id: "2", name: "工學骰子", faction: 2, type: "DICE" },
        { id: "3", name: "自然被動", faction: 1, type: "PLAYER_PASSIVE" }
      ],
      edges: []
    }
  });

  const filterUseCase = new FilterTreeUseCase({ store });

  filterUseCase.toggleFaction(1, true);
  assert.equal(store.getState().matchingNodeIds.size, 2);

  filterUseCase.toggleNodeType("DICE", true);
  assert.equal(store.getState().matchingNodeIds.size, 1);

  filterUseCase.setSearch("自然");
  assert.equal(store.getState().matchingNodeIds.size, 1);

  filterUseCase.clear();
  assert.equal(store.getState().matchingNodeIds.size, 3);
});

test("UseCases: NavigateViewportUseCase coordinates pan and zoom with store", () => {
  const store = new AppStore();
  const vpController = new ViewportController();
  const mockContainer = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  vpController.init(mockContainer, { style: {} });

  const navUseCase = new NavigateViewportUseCase({ store, viewportController: vpController });

  navUseCase.pan(100, 50);
  assert.equal(store.getState().viewport.x, vpController.getState().x);

  navUseCase.zoom(1.1);
  assert.equal(store.getState().viewport.scale, vpController.getState().scale);

  navUseCase.locateNode("1", { x: 500, y: 400 }, 1.5);
  assert.equal(store.getState().viewport.scale, 1.5);

  navUseCase.reset();
  assert.equal(store.getState().viewport.scale, vpController.calculateScaleLimits().baseScale);
});

test("UseCases: NavigateViewportUseCase resets when all nodes match", () => {
  const store = new AppStore();
  store.dispatch({
    type: "SET_GAME_DATA",
    payload: {
      nodes: [{ id: "1" }, { id: "2" }],
      edges: []
    }
  });
  const calls = [];
  const vpController = {
    fitCameraToNodes: () => calls.push("fit"),
    reset: () => calls.push("reset"),
    getState: () => ({ x: 0, y: 0, scale: 1 })
  };
  const navUseCase = new NavigateViewportUseCase({ store, viewportController: vpController });

  navUseCase.fitCameraToNodes(new Set(["1", "2"]), true);
  assert.deepEqual(calls, ["reset"]);
  navUseCase.fitCameraToNodes(new Set(["1"]), true);
  assert.deepEqual(calls, ["reset", "fit"]);
});
