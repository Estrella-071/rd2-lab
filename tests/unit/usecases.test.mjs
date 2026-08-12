import test from "node:test";
import assert from "node:assert/strict";

import { AppStore } from "../../src/app/store/app_store.js";
import {
  LoadGameDataUseCase,
  SelectNodeUseCase,
  SyncGolemRankUseCase,
  FilterTreeUseCase,
  NavigateViewportUseCase,
  SimulationPlanUseCase
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
    if (url.includes("monster_posters")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          monsters: {
            "monster_1": {
              poster: "icons/monster_1.png"
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
  assert.equal(store.getState().isDataLoaded, true);
  assert.equal(store.getState().nodesMap.size, 1);
});

test("UseCases: LoadGameDataUseCase keeps cached boss events immutable during poster enrichment", async () => {
  const store = new AppStore();
  const rawBossEvents = { events: [], monsters: [{ id: "monster_1", name_zh: "普通怪" }] };
  let posters = {
    monsters: {
      monster_1: {
        poster: "icons/monster_v1.png"
      }
    }
  };
  const dataRepository = {
    loadDiceTree: async () => ({ nodes: [], edges: [] }),
    loadDiceTreeSvg: async () => "<svg></svg>",
    loadBossEvents: async () => rawBossEvents,
    loadMonsterPosters: async () => posters
  };
  const loadUseCase = new LoadGameDataUseCase({ store, dataRepository });

  const first = await loadUseCase.execute();
  posters = {
    monsters: {
      monster_1: {
        poster: "icons/monster_v2.png"
      }
    }
  };
  const second = await loadUseCase.execute();

  assert.equal(rawBossEvents.monsters[0].poster, undefined);
  assert.equal(first.bossEvents.monsters[0].poster, "icons/monster_v1.png");
  assert.equal(second.bossEvents.monsters[0].poster, "icons/monster_v2.png");
  assert.equal(store.getState().bossEvents.monsters[0].poster, "icons/monster_v2.png");
});

test("UseCases: SimulationPlanUseCase orchestrates planning, sharing, and image export", async () => {
  const store = new AppStore();
  const treeData = {
    meta: { data_version: "fixture-v1" },
    nodes: [
      { id: "1", node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [0] },
      { id: "2", incoming: ["1"], node_type: "PLAYER_PASSIVE", max_rank: 2, gold_costs: [10, 20], core_costs: [1, 2] },
      { id: "3", incoming: ["2"], node_type: "DICE", max_rank: 1, gold_costs: [30], core_costs: [3] }
    ],
    edges: [{ from: "1", to: "2" }, { from: "2", to: "3" }]
  };
  store.dispatch({ type: "SET_GAME_DATA", payload: treeData });
  store.dispatch({ type: "SET_DATA_METADATA", payload: { canonical: { game_version: "fixture-v1" } } });

  const useCase = new SimulationPlanUseCase({ store });
  assert.equal(useCase.state, store.getState());
  assert.equal(useCase.enter().active, true);
  assert.equal(useCase.toggle().active, false);
  assert.equal(useCase.toggle().active, true);
  assert.equal(useCase.inspect("2").canUnlock, true);
  assert.deepEqual(useCase.previewBatch("3").nodeIds, ["2", "3"]);
  assert.equal(useCase.previewMax("2").ok, true);

  assert.equal(useCase.unlock("2").ranks["2"], 1);
  assert.equal(useCase.upgrade("2").ranks["2"], 2);
  assert.equal(useCase.maxRank("3").ranks["3"], 1);
  assert.equal(useCase.previewRevoke("2").ok, true);
  assert.equal(useCase.revoke("2").ranks["2"], undefined);
  assert.equal(useCase.batchUnlock("3").ranks["3"], 1);
  assert.deepEqual(useCase.setTeam({
    dice: [{ id: "3", runes: [] }],
    commonNodes: [{ id: "2", rank: 1 }]
  }), {
    dice: [{ id: "3", runes: [] }],
    commonNodes: [{ id: "2", rank: 1 }]
  });

  const serialized = useCase.serialize({ origin: "https://example.test" });
  assert.match(serialized.url, /^https:\/\/example\.test\/simulation\/state\//);
  assert.deepEqual(await useCase.createShareLink({ serialized }), serialized);
  assert.deepEqual(await useCase.loadShareCode("ABC123"), { ok: false, error: "share-api-unavailable" });
  assert.equal(useCase.importShare("not-a-share").ok, false);
  const imported = useCase.importShare({ payload: { ...serialized.payload, d: "fixture-v0" } });
  assert.equal(imported.ok, true);
  assert.equal(imported.simulation.warnings.includes("data-version-mismatch"), true);
  assert.deepEqual(await useCase.generateShareImage(), { ok: false, error: "image-exporter-unavailable" });
  useCase.reset();

  const shareRepository = {
    createShare: async () => ({ ok: true, code: "Ab1234" }),
    loadShare: async (code) => ({ ok: true, code })
  };
  const remoteUseCase = new SimulationPlanUseCase({
    store,
    shareRepository,
    shareImageExporter: {
      generate: async (payload) => ({ ok: true, payload })
    }
  });
  const remoteShare = await remoteUseCase.createShareLink({ serialized, origin: "https://example.test" });
  assert.equal(remoteShare.remote, true);
  assert.equal(remoteShare.url, "https://example.test/simulation/Ab1234");
  assert.deepEqual(await remoteUseCase.loadShareCode("Ab1234"), { ok: true, code: "Ab1234" });
  const image = await remoteUseCase.generateShareImage({ format: "png" });
  assert.equal(image.ok, true);
  assert.equal(image.payload.treeData, treeData);

  const failedShareUseCase = new SimulationPlanUseCase({
    store,
    shareRepository: { createShare: async () => ({ ok: false, error: "offline" }) }
  });
  const failedShare = await failedShareUseCase.createShareLink({ serialized });
  assert.deepEqual({ remote: failedShare.remote, remoteError: failedShare.remoteError }, { remote: false, remoteError: "offline" });
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
