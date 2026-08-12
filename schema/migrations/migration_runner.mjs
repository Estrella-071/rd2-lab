/**
 * Schema Migration Runner
 * 
 * Executes sequential declarative schema migration scripts for dataset structures.
 * Supports forward migrations, safe rollbacks, failure isolation, and chain validation.
 */

function parseVersion(val, isTarget = false) {
  if (val === undefined || val === null || val === "") {
    return isTarget ? Infinity : 1;
  }
  if (typeof val === "boolean" || typeof val === "object") {
    throw new TypeError(`Invalid ${isTarget ? "targetVersion" : "schema_version"}: ${val}`);
  }
  const num = Number(val);
  if (!Number.isInteger(num) || num <= 0) {
    throw new TypeError(`Invalid ${isTarget ? "targetVersion" : "schema_version"}: ${val}`);
  }
  return num;
}

function findForwardMigration(migrations, currentStep, target) {
  const migration = migrations.find((candidate) => candidate.fromVersion === currentStep);
  if (migration) return migration;
  if (target !== Infinity) {
    throw new TypeError(
      `Broken migration chain: missing migration from version ${currentStep} to target version ${target}.`
    );
  }
  const hasHigherMigrations = migrations.some((candidate) => candidate.fromVersion > currentStep);
  if (hasHigherMigrations) {
    throw new TypeError(`Broken migration chain: missing intermediate migration from version ${currentStep}.`);
  }
  return null;
}

function applyForwardMigration(currentData, migration) {
  const stepSnapshot = structuredClone(currentData);
  try {
    const nextData = migration.up(stepSnapshot);
    if (!nextData || typeof nextData !== "object") {
      throw new TypeError("Migration 'up' must return an object.");
    }
    nextData.schema_version = String(migration.toVersion);
    return {
      data: nextData,
      label: `${migration.fromVersion}->${migration.toVersion}: ${migration.description || ""}`.trim()
    };
  } catch (err) {
    throw new TypeError(`Migration step ${migration.fromVersion}->${migration.toVersion} failed: ${err.message}`);
  }
}

function validateMigrationDescriptor(migration) {
  if (!migration || typeof migration !== "object") {
    throw new TypeError("Migration must be an object.");
  }
  if (!Number.isInteger(migration.fromVersion) || migration.fromVersion <= 0) {
    throw new TypeError("Migration fromVersion must be a positive integer.");
  }
  if (!Number.isInteger(migration.toVersion) || migration.toVersion <= 0) {
    throw new TypeError("Migration toVersion must be a positive integer.");
  }
  if (migration.fromVersion >= migration.toVersion) {
    throw new TypeError(`Migration fromVersion (${migration.fromVersion}) must be strictly less than toVersion (${migration.toVersion}).`);
  }
  if (typeof migration.up !== "function") {
    throw new TypeError(`Migration ${migration.fromVersion}->${migration.toVersion} missing 'up' function.`);
  }
  if (migration.down !== undefined && typeof migration.down !== "function") {
    throw new TypeError(`Migration ${migration.fromVersion}->${migration.toVersion} 'down' must be a function if provided.`);
  }
}

function ensureMigrationIsUnique(migrations, migration) {
  if (migrations.some((candidate) => candidate.fromVersion === migration.fromVersion)) {
    throw new TypeError(`Duplicate migration registered for version ${migration.fromVersion}.`);
  }
}

export class MigrationRunner {
  constructor() {
    this.migrations = [];
  }

  /**
   * Register a migration script.
   * @param {object} migration
   * @param {number} migration.fromVersion
   * @param {number} migration.toVersion
   * @param {string} [migration.description]
   * @param {Function} migration.up
   * @param {Function} [migration.down]
   */
  register(migration) {
    validateMigrationDescriptor(migration);
    ensureMigrationIsUnique(this.migrations, migration);
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.fromVersion - b.fromVersion);
  }

  /**
   * Run all eligible migrations on dataset sequentially.
   * @param {object} data
   * @param {number|string} [targetVersion=Infinity]
   * @returns {{ migratedData: object, applied: string[] }}
   */
  migrate(data, targetVersion = Infinity) {
    if (!data || typeof data !== "object") {
      throw new TypeError("Invalid data: expected a non-null object.");
    }

    const currentVersion = parseVersion(data.schema_version, false);
    const target = targetVersion === Infinity ? Infinity : parseVersion(targetVersion, true);

    if (currentVersion >= target) {
      return {
        migratedData: structuredClone(data),
        applied: []
      };
    }

    let currentData = structuredClone(data);
    let currentStep = currentVersion;
    const applied = [];

    while (currentStep < target) {
      const migration = findForwardMigration(this.migrations, currentStep, target);
      if (!migration) break;
      if (migration.toVersion > target) {
        throw new TypeError(
          `Migration step ${migration.fromVersion}->${migration.toVersion} overshoots target version ${target}.`
        );
      }
      const result = applyForwardMigration(currentData, migration);
      currentData = result.data;
      currentStep = migration.toVersion;
      applied.push(result.label);
    }

    return { migratedData: currentData, applied };
  }

  /**
   * Roll back dataset migrations sequentially using 'down' functions.
   * @param {object} data
   * @param {number|string} [targetVersion=1]
   * @returns {{ rolledBackData: object, migratedData: object, reverted: string[], applied: string[] }}
   */
  rollback(data, targetVersion = 1) {
    if (!data || typeof data !== "object") {
      throw new TypeError("Invalid data: expected a non-null object.");
    }

    const currentVersion = parseVersion(data.schema_version, false);
    const target = parseVersion(targetVersion, true);

    if (currentVersion <= target) {
      const cloned = structuredClone(data);
      return {
        rolledBackData: cloned,
        migratedData: cloned,
        reverted: [],
        applied: []
      };
    }

    let currentData = structuredClone(data);
    let currentStep = currentVersion;
    const reverted = [];

    while (currentStep > target) {
      const mig = this.migrations
        .slice()
        .reverse()
        .find((m) => m.toVersion === currentStep);

      if (!mig) {
        throw new TypeError(
          `Broken rollback chain: missing migration to downgrade from version ${currentStep} to target version ${target}.`
        );
      }

      if (typeof mig.down !== "function") {
        throw new TypeError(`Migration step ${mig.fromVersion}->${mig.toVersion} does not support rollback (missing 'down' function).`);
      }

      if (mig.fromVersion < target) {
        throw new TypeError(
          `Rollback step ${mig.toVersion}->${mig.fromVersion} overshoots target version ${target}.`
        );
      }

      const stepSnapshot = structuredClone(currentData);
      try {
        const prevData = mig.down(stepSnapshot);
        if (!prevData || typeof prevData !== "object") {
          throw new TypeError("Migration 'down' must return an object.");
        }
        currentData = prevData;
        currentData.schema_version = String(mig.fromVersion);
        currentStep = mig.fromVersion;
        reverted.push(`${mig.toVersion}->${mig.fromVersion}: ${mig.description || "Rollback"}`.trim());
      } catch (err) {
        throw new TypeError(`Rollback step ${mig.toVersion}->${mig.fromVersion} failed: ${err.message}`);
      }
    }

    return {
      rolledBackData: currentData,
      migratedData: currentData,
      reverted,
      applied: reverted
    };
  }
}
