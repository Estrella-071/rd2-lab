import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { diffGameData } from "../../scripts/diff_game_version.mjs";
import { buildChangelog } from "../../scripts/generate_changelog.mjs";
import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(".");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

test("version data: canonical metadata, public snapshots, and generated changelog agree", () => {
  const metadata = readJson("site/data/game_data_metadata.json");
  const tree = readJson("site/data/dice_tree.json");
  const compendium = readJson("site/boss_event_data.json");
  const posters = readJson("site/monster_posters.json");
  const changelog = readJson("site/data/changelog.json");
  const officialNotices = readJson("site/data/official_update_notices.json");

  assert.equal(metadata.canonical.game_version, "1.0.3");
  assert.equal(metadata.canonical.snapshot_id, "random-dice-2-1.0.3");
  assert.equal(metadata.canonical.public_schema_versions.monster_posters, 1);
  assert.equal(metadata.canonical.posters_path, "monster_posters.json");
  assert.equal(metadata.canonical.official_notices_path, "data/official_update_notices.json");
  assert.deepEqual(metadata.versions.map((entry) => entry.version), ["1.0.0", "1.0.2", "1.0.3"]);
  assert.equal(metadata.versions[1].date, "2026-08-20T05:00:00+08:00");
  assert.equal(metadata.versions[2].date, "2026-08-22T07:00:00+08:00");
  assert.deepEqual(metadata.versions.map((entry) => entry.text_asset_count), [47, 126, 126]);
  assert.deepEqual(metadata.versions.map((entry) => entry.table_count), [47, 47, 47]);
  assert.match(metadata.versions[0].completeness_zh, /部分視覺內容/);
  assert.equal(tree.metadata_ref, "data/game_data_metadata.json");
  assert.equal(tree.summary.node_count, 239);
  assert.equal(tree.summary.edge_count, 246);
  assert.equal(metadata.source.tree_edge_count, 246);
  assert.equal(metadata.source.raw_tree_edge_count, 248);
  assert.equal(metadata.source.topology_correction_count, 2);
  assert.equal(compendium.meta.game_data_version, metadata.canonical.game_version);
  assert.equal(posters.snapshot.snapshot_id, metadata.canonical.snapshot_id);
  assert.equal(posters.snapshot.metadata_ref, "data/game_data_metadata.json");
  assert.equal(changelog.canonical_version, metadata.canonical.game_version);
  assert.equal(changelog.entries.at(-1).version, "1.0.3");
  assert.ok(changelog.entries.at(-1).categories.schema_changes.some((item) => item.table === "MinionTable"));
  assert.equal(changelog.official_notices_source, "data/official_update_notices.json");
  assert.deepEqual(officialNotices.notices.map((notice) => notice.id), [
    "WEBVIEW_NOTICE_F7bzEtRKyYGxA1BYb3IGK",
    "WEBVIEW_NOTICE_GM1DuyxliHVN_EKqomJoo"
  ]);
  assert.match(officialNotices.notices[0].version_basis_zh, /未明示版本/);
  assert.equal(changelog.entries.find((entry) => entry.version === "1.0.2").official_notices[0].id, officialNotices.notices[0].id);
  assert.ok(changelog.entries.find((entry) => entry.version === "1.0.3").categories.modified.some((item) => item.entity === "combo"));
  assert.equal(compendium.events.length, 55);
  assert.deepEqual(compendium.historical_events, []);
});

test("version diff: stable IDs classify add, modify, remove, rename, and schema changes", () => {
  const oldData = {
    nodes: [
      { id: "a", name: "Alpha", cost: 1, requires: [] },
      { id: "b", name: "Beta", cost: 2, requires: ["a"] },
      { id: "rename-old", name: "Gamma", cost: 3 }
    ]
  };
  const newData = {
    nodes: [
      { id: "a", name: "Alpha", cost: 5, requires: [] },
      { id: "c", name: "Charlie", cost: 2, requires: ["a"] },
      { id: "rename-new", name: "Gamma 2", cost: 3 },
      { id: "schema", name: "Schema", cost: 4, new_field: true }
    ]
  };
  const diff = diffGameData(oldData, newData);
  assert.ok(diff.changes.some((change) => change.kind === "modify" && change.id === "a" && change.field === "cost"));
  assert.ok(diff.changes.some((change) => change.kind === "add" && change.id === "c"));
  assert.ok(diff.changes.some((change) => change.kind === "remove" && change.id === "b"));
  assert.ok(diff.changes.some((change) => change.kind === "rename" && change.from_id === "rename-old"));
  assert.equal(diff.isSchemaChange, false);

  const schemaDiff = diffGameData({ nodes: [{ id: "a", cost: 1 }] }, { nodes: [{ id: "a", cost: 1, new_field: true }] });
  assert.equal(schemaDiff.isSchemaChange, true);
  assert.ok(schemaDiff.changes.some((change) => change.kind === "schema_change" && change.fields_added.includes("new_field")));
});

test("changelog generator: future pair entries remain data-driven", () => {
  const document = buildChangelog({
    pairs: [{ from_version: "1.0.3", to_version: "1.0.4", date: null, added: [{ category: "nodes", ids: ["9001"], summary_zh: "新增節點" }], modified: [], removed: [], schema_changes: [], important_values: [], notes_zh: "測試" }]
  });
  assert.equal(document.canonical_version, "1.0.4");
  assert.equal(document.entries.at(-1).categories.added[0].id, "9001");
  assert.equal(document.entries.at(-1).date, null);
});

test("removed event contract: historical records are valid and excluded from active IDs", () => {
  const schema = readJson("schema/boss-event-data.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const fixture = {
    meta: {
      schema_version: 4,
      snapshot: { snapshot_id: "random-dice-2-1.0.3", metadata_ref: "data/game_data_metadata.json", verified_at: "2026-08-23" },
      metadata_ref: "data/game_data_metadata.json",
      game_data_version: "1.0.3",
      event_counts: {}
    },
    monsters: [],
    monster_types: [],
    modes: {},
    events: [{ id: "event_current", name_zh: "目前事件", eventKind: "Fixture" }],
    historical_events: [{
      id: "event_old",
      name_zh: "舊事件",
      status: "removed",
      is_removed: true,
      last_seen_version: "1.0.2",
      removed_in_version: "1.0.3"
    }],
    raw_lineage: {
      snapshot_id: "random-dice-2-1.0.3",
      generator: "fixture",
      source_manifest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      unlock_supplement_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      unlock_supplement_count: 4,
      official_notice_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      official_coop_override_count: 3,
      path: "data/raw_snapshot_1.0.3.json"
    }
  };
  assert.equal(validate(fixture), true);
  assert.equal(fixture.events.some((event) => event.id === fixture.historical_events[0].id), false);
});
