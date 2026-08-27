import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..", "..");

test("Cloudflare contract: static traffic bypasses Functions and API routes are explicit", () => {
  const routes = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "_routes.json"), "utf8"));
  const headers = fs.readFileSync(path.join(rootDir, "site", "_headers"), "utf8");
  const allowlist = JSON.parse(fs.readFileSync(path.join(rootDir, "site", "runtime-allowlist.json"), "utf8"));

  assert.deepEqual(routes, {
    version: 1,
    include: ["/api/*"],
    exclude: []
  });
  assert(allowlist.staticFiles.includes("_routes.json"));
  assert(allowlist.staticFiles.includes("_headers"));
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test("Cloudflare contract: D1 binding and schema constraints use the production resources", () => {
  const configText = fs.readFileSync(path.join(rootDir, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(configText);
  const migration = fs.readFileSync(
    path.join(rootDir, "migrations", "0002_harden_simulation_shares.sql"),
    "utf8"
  );
  const database = config.d1_databases?.[0];
  assert.equal(config.name, "rd2-lab");
  assert.equal(config.pages_build_output_dir, ".pages");
  assert.equal(database?.binding, "DB");
  assert.equal(database?.database_name, "rd2-lab-shares");
  assert.equal(database?.database_id, "64954abd-6289-41fb-af8f-8e1b3aa6cac2");
  assert.match(migration, /payload TEXT NOT NULL UNIQUE/);
  assert.match(migration, /length\(payload\) BETWEEN 1 AND 4096/);
});
