import test from "node:test";
import assert from "node:assert/strict";

import { MigrationRunner } from "../../schema/migrations/migration_runner.mjs";

const migrationV1ToV2 = {
  fromVersion: 1,
  toVersion: 2,
  description: "Normalize record envelope",
  up: (data) => ({ ...data, normalized: true }),
  down(data) {
    const clone = { ...data };
    delete clone.normalized;
    return clone;
  }
};

const migrationV2ToV3 = {
  fromVersion: 2,
  toVersion: 3,
  description: "Add record index",
  up: (data) => ({
    ...data,
    record_ids: Array.isArray(data.nodes) ? data.nodes.map((node) => node.id) : []
  }),
  down(data) {
    const clone = { ...data };
    delete clone.record_ids;
    return clone;
  }
};

test("SchemaMigrations - Test 1: Multi-step pipeline v1 -> v2 -> v3 executes in sequence", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  runner.register(migrationV2ToV3);

  const v1Data = {
    schema_version: "1",
    nodes: [
      { id: "1001", name: "風骰子" },
      { id: "1002", name: "火骰子", tags: ["BURN"] }
    ]
  };

  const { migratedData, applied } = runner.migrate(v1Data, 3);
  assert.equal(migratedData.schema_version, "3");
  assert.equal(applied.length, 2);
  assert.ok(applied[0].startsWith("1->2:"));
  assert.ok(applied[1].startsWith("2->3:"));

  // v1 -> v2 guarantees
  assert.equal(migratedData.normalized, true);
  assert.equal(migratedData.nodes[1].tags[0], "BURN");

  // v2 -> v3 guarantees
  assert.deepEqual(migratedData.record_ids, ["1001", "1002"]);
});

test("SchemaMigrations - Test 2: TargetVersion cutoff halts at specified version", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  runner.register(migrationV2ToV3);
  runner.register({
    fromVersion: 3,
    toVersion: 4,
    description: "Add v4 feature flags",
    up(data) {
      const clone = structuredClone(data);
      clone.v4_enabled = true;
      return clone;
    }
  });

  const v1Data = {
    schema_version: "1",
    nodes: [{ id: "1001", name: "風骰子" }]
  };

  // Cutoff at v2
  const resV2 = runner.migrate(v1Data, 2);
  assert.equal(resV2.migratedData.schema_version, "2");
  assert.equal(resV2.applied.length, 1);
  assert.equal(resV2.migratedData.normalized, true);
  assert.equal(resV2.migratedData.record_ids, undefined);
  assert.equal(resV2.migratedData.v4_enabled, undefined);

  // Cutoff at v3
  const resV3 = runner.migrate(v1Data, 3);
  assert.equal(resV3.migratedData.schema_version, "3");
  assert.equal(resV3.applied.length, 2);
  assert.deepEqual(resV3.migratedData.record_ids, ["1001"]);
  assert.equal(resV3.migratedData.v4_enabled, undefined);
});

test("SchemaMigrations - Test 3: Missing intermediate migration / broken chain throws informative error", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  // Missing 2->3, register 3->4 directly
  runner.register({
    fromVersion: 3,
    toVersion: 4,
    description: "v3 to v4 jump",
    up: (d) => d
  });

  const v1Data = {
    schema_version: "1",
    nodes: [{ id: "1001", name: "風骰子" }]
  };

  // Explicit target 4 with gap at 2->3
  assert.throws(
    () => runner.migrate(v1Data, 4),
    /Broken migration chain: missing migration from version 2 to target version 4/
  );

  // Infinity target with broken intermediate gap
  assert.throws(
    () => runner.migrate(v1Data),
    /Broken migration chain: missing intermediate migration from version 2/
  );

  // Unregistered starting version
  const isolatedRunner = new MigrationRunner();
  isolatedRunner.register(migrationV2ToV3);
  assert.throws(
    () => isolatedRunner.migrate(v1Data, 3),
    /Broken migration chain: missing migration from version 1/
  );

  // Duplicate registration validation
  assert.throws(
    () => isolatedRunner.register({ fromVersion: 2, toVersion: 4, up: (d) => d }),
    /Duplicate migration registered for version 2/
  );

  // Invalid registration version order
  assert.throws(
    () => isolatedRunner.register({ fromVersion: 3, toVersion: 2, up: (d) => d }),
    /strictly less than toVersion/
  );

  // Missing up function
  assert.throws(
    () => isolatedRunner.register({ fromVersion: 4, toVersion: 5 }),
    /missing 'up' function/
  );

  // A target inside a single version jump cannot be reached transactionally;
  // the runner must reject it instead of silently returning the wrong version.
  const jumpRunner = new MigrationRunner();
  jumpRunner.register({
    fromVersion: 1,
    toVersion: 3,
    up: (data) => ({ ...data, jumped: true }),
    down: (data) => ({ ...data, jumped: false })
  });
  assert.throws(
    () => jumpRunner.migrate({ schema_version: 1 }, 2),
    /Migration step 1->3 overshoots target version 2/
  );
  assert.throws(
    () => jumpRunner.rollback({ schema_version: 3, jumped: true }, 2),
    /Rollback step 3->1 overshoots target version 2/
  );
});

test("SchemaMigrations - Test 4: Throws and propagates error when step up() fails without corrupting original snapshot", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  runner.register({
    fromVersion: 2,
    toVersion: 3,
    description: "Failing step",
    up(data) {
      throw new Error("Simulated transform error in v2->v3 step");
    }
  });

  const originalV1Data = {
    schema_version: "1",
    nodes: [
      { id: "1001", name: "風骰子" }
    ],
    config: { active: true }
  };

  const snapshotBefore = structuredClone(originalV1Data);

  assert.throws(
    () => runner.migrate(originalV1Data, 3),
    /Migration step 2->3 failed: Simulated transform error in v2->v3 step/
  );

  // Verify the input snapshot is unchanged.
  assert.deepEqual(originalV1Data, snapshotBefore);
  assert.equal(originalV1Data.schema_version, "1");
  assert.equal(originalV1Data.nodes[0].tags, undefined);
});

test("SchemaMigrations - Test 5: Rollback / down() executes reverse transformations cleanly", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  runner.register(migrationV2ToV3);

  const v1Data = {
    schema_version: "1",
    nodes: [
      { id: "1001", name: "風骰子" }
    ]
  };

  const { migratedData: v3Data } = runner.migrate(v1Data, 3);
  assert.equal(v3Data.schema_version, "3");
  assert.equal(v3Data.normalized, true);
  assert.deepEqual(v3Data.record_ids, ["1001"]);

  // Rollback v3 -> v1
  const { rolledBackData: v1Restored, reverted } = runner.rollback(v3Data, 1);
  assert.equal(v1Restored.schema_version, "1");
  assert.equal(reverted.length, 2);
  assert.deepEqual(v1Restored, v1Data);

  // Rollback with cutoff v3 -> v2
  const { rolledBackData: v2Restored, reverted: revertedV2 } = runner.rollback(v3Data, 2);
  assert.equal(v2Restored.schema_version, "2");
  assert.equal(revertedV2.length, 1);
  assert.equal(v2Restored.record_ids, undefined);
  assert.equal(v2Restored.normalized, true);

  // Rollback error when down() is missing
  const noDownRunner = new MigrationRunner();
  noDownRunner.register({
    fromVersion: 1,
    toVersion: 2,
    description: "One way up",
    up: (d) => ({ ...d, schema_version: "2" })
  });
  const dataV2 = { schema_version: "2" };
  assert.throws(
    () => noDownRunner.rollback(dataV2, 1),
    /does not support rollback/
  );
});

test("SchemaMigrations - Test 6: Idempotent execution skips already applied migrations", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);
  runner.register(migrationV2ToV3);

  const v3Data = {
    schema_version: "3",
    normalized: true,
    record_ids: ["1001"],
    nodes: [{ id: "1001", name: "風骰子" }]
  };

  // Migrate on already up-to-date data
  const resMigrate = runner.migrate(v3Data, 3);
  assert.equal(resMigrate.migratedData.schema_version, "3");
  assert.equal(resMigrate.applied.length, 0);

  // Migrate with lower target
  const resLower = runner.migrate(v3Data, 2);
  assert.equal(resLower.migratedData.schema_version, "3");
  assert.equal(resLower.applied.length, 0);

  // Rollback on already base version
  const v1Data = { schema_version: "1", nodes: [{ id: "1001", name: "風骰子" }] };
  const resRollback = runner.rollback(v1Data, 1);
  assert.equal(resRollback.rolledBackData.schema_version, "1");
  assert.equal(resRollback.reverted.length, 0);
});

test("SchemaMigrations - Test 7: Handles missing or invalid schema_version safely (defaults or throws)", () => {
  const runner = new MigrationRunner();
  runner.register(migrationV1ToV2);

  // Missing schema_version defaults to 1
  const noVersionData = {
    nodes: [{ id: "1001", name: "風骰子" }]
  };
  const res1 = runner.migrate(noVersionData, 2);
  assert.equal(res1.migratedData.schema_version, "2");
  assert.equal(res1.applied.length, 1);

  // null / undefined schema_version defaults to 1
  const nullVersionData = {
    schema_version: null,
    nodes: [{ id: "1001", name: "風骰子" }]
  };
  const res2 = runner.migrate(nullVersionData, 2);
  assert.equal(res2.migratedData.schema_version, "2");

  // Invalid schema_version throws informative error
  assert.throws(
    () => runner.migrate({ schema_version: "invalid" }),
    /Invalid schema_version: invalid/
  );
  assert.throws(
    () => runner.migrate({ schema_version: -5 }),
    /Invalid schema_version: -5/
  );
  assert.throws(
    () => runner.migrate({ schema_version: 0 }),
    /Invalid schema_version: 0/
  );
  assert.throws(
    () => runner.migrate({ schema_version: 1.5 }),
    /Invalid schema_version: 1.5/
  );

  // Invalid data object throws
  assert.throws(
    () => runner.migrate(null),
    /Invalid data: expected a non-null object/
  );
  assert.throws(
    () => runner.migrate("string"),
    /Invalid data: expected a non-null object/
  );

  // Invalid targetVersion throws
  assert.throws(
    () => runner.migrate(noVersionData, "invalid_target"),
    /Invalid targetVersion: invalid_target/
  );
});
