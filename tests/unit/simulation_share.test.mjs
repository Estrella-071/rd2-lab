import test from "node:test";
import assert from "node:assert/strict";

import {
  buildShareImageLayout,
  resolveSnapshotImageReferences
} from "../../src/infra/share_image_exporter.js";
import {
  decodeSimulationShare,
  hydrateSimulationShare,
  serializeSimulationState
} from "../../src/domain/simulation_share.js";
import { MAX_SIMULATION_TEAM_DICE, MAX_SIMULATION_TEAM_RUNES_PER_DIE } from "../../src/domain/simulation_plan.js";

const nodes = [
  { id: "1", is_base: true, node_type: "DICE", max_rank: 1 },
  { id: "2", incoming: ["1"], node_type: "DICE", max_rank: 1 },
  { id: "3", incoming: ["2"], node_type: "DICE_RUNE", max_rank: 5 },
  { id: "4", node_type: "PLAYER_PASSIVE", max_rank: 10 },
  { id: "5", node_type: "PERK", max_rank: 3 },
  { id: "6", is_base: true, incoming: ["1"], node_type: "DICE", max_rank: 1 }
];

test("simulation share: URL round-trips ranks, team, runes and common nodes", () => {
  const simulation = {
    active: true,
    dataVersion: "1.0.3",
    ranks: { "1": 1, "2": 1, "3": 4 },
    team: {
      dice: [{ id: "2", runes: [{ id: "3", rank: 4 }] }],
      commonNodes: [{ id: "4", rank: 6 }, { id: "5", rank: 2 }]
    }
  };
  const serialized = serializeSimulationState({ simulation, treeData: { nodes }, origin: "https://example.test", pathname: "/tree" });
  assert.ok(serialized.url.startsWith("https://example.test/tree?s="));
  assert.match(serialized.encoded, /^[0-9A-Za-z]+$/, "share payload should use URL-safe Base62 characters only");
  assert.ok(serialized.url.length < 600, `compact simulation URL should stay short (got ${serialized.url.length})`);
  const decoded = decodeSimulationShare(serialized.url);
  assert.equal(decoded.ok, true);
  assert.equal(decodeSimulationShare(serialized.payload).ok, true);
  assert.equal(decodeSimulationShare(serialized).ok, true);
  assert.equal(decodeSimulationShare(decoded), decoded);
  const forged = { ...decoded, version: 999, payload: { ...decoded.payload, v: 999 } };
  const rejectedForged = decodeSimulationShare(forged);
  assert.equal(rejectedForged.ok, false);
  assert.deepEqual(rejectedForged.warnings, ["unsupported-share-version"]);
  assert.equal(decoded.dataVersion, "1.0.3");
  const hydrated = hydrateSimulationShare(decoded, nodes);
  assert.equal(hydrated.ranks["3"], 4);
  assert.equal(hydrated.ranks["6"], undefined);
  assert.deepEqual(hydrated.team.dice[0].runes[0], { id: "3", rank: 4 });
  assert.deepEqual(hydrated.team.commonNodes[0], { id: "4", rank: 6 });
});

test("simulation share: preserves the three pre-unlocked reward dice despite their graph routes", () => {
  const rewardNodes = [
    { id: "1001", node_type: "DICE", max_rank: 1 },
    { id: "4008", node_type: "DICE", max_rank: 1, incoming: [], unlock_condition: "REWARD_UNLOCKED" },
    { id: "5006", node_type: "DICE", max_rank: 1, incoming: ["5007"], unlock_condition: "COOP_REWARD_UNLOCKED" },
    { id: "5008", node_type: "DICE", max_rank: 1, incoming: ["5009"], unlock_condition: "ARENA_REWARD_UNLOCKED" },
    { id: "5007", node_type: "DICE", max_rank: 1, incoming: ["5002"] },
    { id: "5009", node_type: "DICE", max_rank: 1, incoming: ["5002"] },
    { id: "5002", node_type: "DICE", max_rank: 1, core_costs: [8] }
  ];
  const serialized = serializeSimulationState({ simulation: { ranks: {} }, treeData: { nodes: rewardNodes } });
  const hydrated = hydrateSimulationShare(decodeSimulationShare(serialized.url), rewardNodes);
  assert.deepEqual(hydrated.initialIds.sort(), ["1001", "4008", "5006", "5008"]);
  assert.equal(hydrated.ranks["4008"], 1);
  assert.equal(hydrated.ranks["5006"], 1);
  assert.equal(hydrated.ranks["5008"], 1);
});

test("simulation share: hash links and unsupported input fail cleanly", () => {
  const serialized = serializeSimulationState({ simulation: { ranks: {} }, treeData: { nodes } });
  const encoded = serialized.encoded;
  assert.equal(decodeSimulationShare(`#s=${encoded}`).ok, true);
  assert.equal(decodeSimulationShare(`#sim=${encoded}`).ok, true);
  assert.equal(decodeSimulationShare("?sim=not-valid").ok, false);
  const future = decodeSimulationShare(JSON.stringify({ k: "r", v: 999, d: "x", r: [], t: { d: [], c: [] } }));
  assert.equal(future.ok, false);
  assert.deepEqual(future.warnings, ["unsupported-share-version"]);
});

test("simulation share: stable IDs survive node reordering and insertion", () => {
  const largeNodes = Array.from({ length: 300 }, (_, index) => ({
    id: String(index),
    node_type: "PLAYER_PASSIVE",
    max_rank: 10
  }));
  const sparse = serializeSimulationState({
    simulation: { ranks: { "299": 7 } },
    treeData: { nodes: largeNodes },
    origin: "https://example.test",
    pathname: "/tree"
  });
  assert.equal(sparse.payload.r[0], "i");
  const reorderedNodes = [
    { id: "900", node_type: "PLAYER_PASSIVE", max_rank: 10 },
    ...largeNodes.slice().reverse()
  ];
  assert.equal(hydrateSimulationShare(decodeSimulationShare(sparse.url), reorderedNodes).ranks["299"], 7);

  const dense = serializeSimulationState({
    simulation: { ranks: Object.fromEntries(largeNodes.map((node) => [node.id, 1])) },
    treeData: { nodes: largeNodes }
  });
  assert.equal(dense.payload.r[0], "i");
  assert.equal(hydrateSimulationShare(decodeSimulationShare(dense.url), reorderedNodes).ranks["299"], 1);

  const teamShare = serializeSimulationState({
    simulation: {
      ranks: { "1": 1, "2": 1, "3": 4 },
      team: {
        dice: [{ id: "2", runes: [{ id: "3", rank: 4 }] }],
        commonNodes: [{ id: "4", rank: 6 }]
      }
    },
    treeData: { nodes }
  });
  const reorderedTeamNodes = [
    { id: "99", node_type: "PLAYER_PASSIVE", max_rank: 1 },
    nodes[5],
    nodes[3],
    nodes[1],
    nodes[2],
    nodes[0],
    nodes[4]
  ];
  const hydratedTeam = hydrateSimulationShare(decodeSimulationShare(teamShare.url), reorderedTeamNodes);
  assert.equal(hydratedTeam.team.dice[0].id, "2");
  assert.equal(hydratedTeam.team.dice[0].runes[0].id, "3");
  assert.equal(hydratedTeam.team.commonNodes[0].id, "4");
});

test("simulation share: unknown IDs and impossible prerequisites are warned and omitted", () => {
  const decoded = {
    ok: true,
    version: 1,
    dataVersion: "old",
    ranks: [["3", 4], ["999", 1]],
    team: { dice: [{ id: "999", runes: [{ id: "404", rank: 2 }] }], commonNodes: [] },
    warnings: []
  };
  const hydrated = hydrateSimulationShare(decoded, nodes);
  assert.equal(hydrated.ranks["3"], undefined);
  assert.ok(hydrated.warnings.some((warning) => warning.startsWith("unknown-node:")));
  assert.ok(hydrated.warnings.includes("missing-prerequisite:3"));
  assert.equal(hydrated.team.dice.length, 0);
});

test("simulation share: hostile team payloads are bounded and deduplicated", () => {
  const repeatedCommonNodes = Array.from({ length: 100000 }, () => ({ id: "4", rank: 1 }));
  const hydrated = hydrateSimulationShare({
    ok: true,
    version: 1,
    dataVersion: "1.0.3",
    ranks: [],
    team: { dice: [], commonNodes: repeatedCommonNodes },
    warnings: []
  }, nodes);

  assert.equal(hydrated.team.commonNodes.length, 1);
  assert.deepEqual(hydrated.team.commonNodes[0], { id: "4", rank: 1 });

  const decodedLargePayload = decodeSimulationShare({
    k: "r",
    v: 1,
    d: "1.0.3",
    r: Array.from({ length: 600 }, (_, index) => [String(index), 1]),
    t: {
      d: Array.from({ length: MAX_SIMULATION_TEAM_DICE + 4 }, (_, index) => [String(index + 1), index === 0
        ? Array.from({ length: MAX_SIMULATION_TEAM_RUNES_PER_DIE + 4 }, (_, runeIndex) => [String(runeIndex + 100), 1])
        : []]),
      c: Array.from({ length: 140 }, (_, index) => [String(index + 4), 1])
    }
  });
  assert.equal(decodedLargePayload.ok, true);
  assert.ok(decodedLargePayload.warnings.includes("share-ranks-truncated"));
  assert.ok(decodedLargePayload.warnings.includes("share-team-dice-truncated"));
  assert.ok(decodedLargePayload.warnings.includes("share-team-runes-truncated"));
  assert.ok(decodedLargePayload.warnings.includes("share-team-common-truncated"));
  assert.equal(decodedLargePayload.team.dice[0].runes.length, MAX_SIMULATION_TEAM_RUNES_PER_DIE);

  const oversizedUrl = `?s=${"a".repeat(9000)}`;
  const rejected = decodeSimulationShare(oversizedUrl);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.warnings.includes("share-too-large"));
});

test("share image layout: fixed logical canvas is high-DPI and viewport independent", () => {
  assert.deepEqual(buildShareImageLayout({ scale: 3 }), {
    width: 4800,
    height: 3000,
    logicalWidth: 1600,
    logicalHeight: 1000,
    scale: 3
  });
  assert.equal(buildShareImageLayout({ width: 1200, height: 800, scale: 4 }).width, 4800);
});

test("share image SVG snapshot: external image references survive Blob serialization", () => {
  const attributes = new Map([
    ["href", "icons/Dice_Fire3.png"],
    ["xlink:href", "icons/Dice_Fire3.png"]
  ]);
  const image = {
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    setAttributeNS(_namespace, name, value) {
      attributes.set(name, value);
    }
  };
  const svg = { querySelectorAll: (selector) => selector === "image" ? [image] : [] };

  assert.equal(resolveSnapshotImageReferences(svg, "https://rd2-lab.pages.dev/tree/index.html"), 2);
  assert.equal(attributes.get("href"), "https://rd2-lab.pages.dev/tree/icons/Dice_Fire3.png");
  assert.equal(attributes.get("xlink:href"), "https://rd2-lab.pages.dev/tree/icons/Dice_Fire3.png");
});
