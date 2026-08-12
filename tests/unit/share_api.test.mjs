import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../../functions/api/shares.js";
import { onRequestGet } from "../../functions/api/shares/[code].js";
import { HttpShareRepository } from "../../src/infra/http_share_repository.js";

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("HttpShareRepository: creates and loads six-character D1 share codes", async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return responseJson({ ok: true, code: "0Ab9Zx" }, 201);
    return responseJson({ ok: true, code: "0Ab9Zx", encoded: "payload62" });
  };
  const repository = new HttpShareRepository({ fetchFn });

  const created = await repository.createShare("payload62");
  assert.deepEqual(created, { ok: true, code: "0Ab9Zx" });
  const loaded = await repository.loadShare(created.code);
  assert.deepEqual(loaded, { ok: true, code: "0Ab9Zx", encoded: "payload62" });
  assert.equal(calls[0].url, "/api/shares");
  assert.equal(calls[1].url, "/api/shares/0Ab9Zx");
});
test("HttpShareRepository: rejects malformed payloads and API codes", async () => {
  const repository = new HttpShareRepository({
    fetchFn: async () => responseJson({ ok: true, code: "short" }, 201)
  });
  assert.equal((await repository.createShare("not-url-safe!" )).ok, false);
  assert.equal((await repository.createShare("a".repeat(4097))).error, "invalid-share-payload");
  assert.equal((await repository.createShare("payload62")).error, "share-api-http-201");
  assert.equal((await repository.loadShare("short")).error, "invalid-share-code");
});

function createD1Mock() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (!sql.startsWith("INSERT OR IGNORE")) throw new Error("unexpected run query");
              const [code, payload, createdAt] = values;
              if (rows.has(code) || [...rows.values()].some((row) => row.payload === payload)) {
                return { meta: { changes: 0 } };
              }
              rows.set(code, { code, payload, created_at: createdAt });
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("WHERE payload")) {
                return [...rows.values()].find((row) => row.payload === values[0]) || null;
              }
              if (sql.includes("WHERE code")) return rows.get(values[0]) || null;
              throw new Error("unexpected first query");
            }
          };
        }
      };
    }
  };
}

test("Pages share Functions: validates, stores, and retrieves a D1 payload", async () => {
  const db = createD1Mock();
  const payload = "0AAbc123";
  const post = await onRequestPost({
    request: new Request("https://example.test/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoded: payload })
    }),
    env: { DB: db }
  });
  assert.equal(post.status, 201);
  const created = await post.json();
  assert.equal(created.ok, true);
  assert.match(created.code, /^[0-9A-Za-z]{6}$/);
  assert.equal(db.rows.get(created.code).payload, payload);

  assert.equal(post.headers.get("x-content-type-options"), "nosniff");
  assert.match(post.headers.get("content-security-policy"), /default-src 'none'/);

  const get = await onRequestGet({
    request: new Request(`https://example.test/api/shares/${created.code}`),
    params: { code: created.code },
    env: { DB: db }
  });
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), {
    ok: true,
    code: created.code,
    encoded: payload,
    createdAt: db.rows.get(created.code).created_at
  });

  const repeated = await onRequestPost({
    request: new Request("https://example.test/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoded: payload })
    }),
    env: { DB: db }
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ok: true, code: created.code });
  assert.equal(db.rows.size, 1);
});

test("Pages share Functions: reject invalid payloads and codes", async () => {
  const db = createD1Mock();
  const invalidPayload = await onRequestPost({
    request: new Request("https://example.test/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoded: "bad-payload!" })
    }),
    env: { DB: db }
  });
  assert.equal(invalidPayload.status, 400);
  const invalidCode = await onRequestGet({
    request: new Request("https://example.test/api/shares/short"),
    params: { code: "short" },
    env: { DB: db }
  });
  assert.equal(invalidCode.status, 400);
});

test("Pages share Functions: enforce media type and body limits", async () => {
  const db = createD1Mock();
  const unsupported = await onRequestPost({
    request: new Request("https://example.test/api/shares", {
      method: "POST",
      body: JSON.stringify({ encoded: "payload62" })
    }),
    env: { DB: db }
  });
  assert.equal(unsupported.status, 415);

  const oversized = await onRequestPost({
    request: new Request("https://example.test/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoded: "a".repeat(5000) })
    }),
    env: { DB: db }
  });
  assert.equal(oversized.status, 413);

  assert.equal(db.rows.size, 0);
});
