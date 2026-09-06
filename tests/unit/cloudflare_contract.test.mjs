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
    include: [
      "/api/*",
      "/simulation/*",
      "/zh-tw/simulation/*",
      "/en/simulation/*",
      "/ja/simulation/*",
      "/ko/simulation/*"
    ],
    exclude: []
  });
  assert(allowlist.staticFiles.includes("_routes.json"));
  assert(allowlist.staticFiles.includes("_headers"));
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /\/\*\s+Cache-Control: public, max-age=0, must-revalidate/s);
  assert.match(headers, /\/data\/\*\s+Cache-Control: public, max-age=0, must-revalidate/s);
  assert.match(headers, /\/styles\*\.css\s+Cache-Control: public, max-age=0, must-revalidate/s);
  assert.match(headers, /\/src\/\*\s+Cache-Control: public, max-age=0, must-revalidate/s);
  assert.match(headers, /\/icons\/\*\s+Cache-Control: public, max-age=31536000, immutable/s);
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

test("Cloudflare contract: simulation share SEO metadata and locale handler rewrite HTML correctly", async () => {
  const {
    SIMULATION_SEO_METADATA,
    getSimulationSeoMetadata,
    handleSimulationShareRequest
  } = await import("../../functions/_shared/share_api.js");

  // 驗證 4 國語言的 SEO 標題與描述字典
  assert.equal(SIMULATION_SEO_METADATA["zh-tw"].title, "模擬配點｜Random Dice 2 Lab");
  assert.equal(SIMULATION_SEO_METADATA["zh-tw"].description, "規劃 Random Dice 2 配點、比較解鎖消耗，並分享建構結果。");

  assert.equal(SIMULATION_SEO_METADATA.en.title, "Build simulation | Random Dice 2 Lab");
  assert.equal(SIMULATION_SEO_METADATA.en.description, "Plan a Random Dice 2 build, compare unlock costs, and share the result.");

  assert.equal(SIMULATION_SEO_METADATA.ja.title, "ビルドシミュレーション｜Random Dice 2 Lab");
  assert.equal(SIMULATION_SEO_METADATA.ja.description, "Random Dice 2 のビルドを計画し、解放コストを比較して結果を共有できます。");

  assert.equal(SIMULATION_SEO_METADATA.ko.title, "빌드 시뮬레이션 | Random Dice 2 Lab");
  assert.equal(SIMULATION_SEO_METADATA.ko.description, "Random Dice 2 빌드를 계획하고 해금 비용을 비교하며 결과를 공유하세요.");

  // 驗證 fallback
  assert.deepEqual(getSimulationSeoMetadata("fr"), SIMULATION_SEO_METADATA["zh-tw"]);
  assert.deepEqual(getSimulationSeoMetadata("EN"), SIMULATION_SEO_METADATA.en);

  // 模擬 HTMLRewriter
  class MockHTMLRewriter {
    constructor() {
      this.handlers = [];
    }

    on(selector, handler) {
      this.handlers.push({ selector, handler });
      return this;
    }

    transform(response) {
      const transformed = {
        _isTransformed: true,
        handlers: this.handlers,
        response
      };
      return transformed;
    }
  }

  const originalRewriter = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = MockHTMLRewriter;

  try {
    const mockEnv = {
      ASSETS: {
        fetch: async (url) => new Response("<html><head><title>Original</title></head><body></body></html>", { status: 200 })
      }
    };

    // 1. 測試合法代碼帶 en 語系
    const reqEn = new Request("https://rd2-lab.pages.dev/en/simulation/Ab1234");
    const resultEn = await handleSimulationShareRequest({
      request: reqEn,
      params: { code: "Ab1234" },
      env: mockEnv,
      locale: "en"
    });

    assert.equal(resultEn._isTransformed, true);

    // 模擬執行各個 handler
    const appliedAttrs = {};
    let titleContent = "";
    const mockElement = (tag, currentAttrs = {}) => ({
      setAttribute(name, val) {
        appliedAttrs[`${tag}[${name}]`] = val;
      },
      setInnerContent(val) {
        titleContent = val;
      }
    });

    for (const { selector, handler } of resultEn.handlers) {
      if (typeof handler.element === "function") {
        handler.element(mockElement(selector));
      }
    }

    assert.equal(appliedAttrs["html[lang]"], "en");
    assert.equal(titleContent, "Build simulation | Random Dice 2 Lab");
    assert.equal(appliedAttrs["meta[name=\"description\"][content]"], "Plan a Random Dice 2 build, compare unlock costs, and share the result.");
    assert.equal(appliedAttrs["meta[property=\"og:title\"][content]"], "Build simulation | Random Dice 2 Lab");
    assert.equal(appliedAttrs["meta[property=\"og:description\"][content]"], "Plan a Random Dice 2 build, compare unlock costs, and share the result.");
    assert.equal(appliedAttrs["meta[name=\"twitter:title\"][content]"], "Build simulation | Random Dice 2 Lab");
    assert.equal(appliedAttrs["meta[name=\"twitter:description\"][content]"], "Plan a Random Dice 2 build, compare unlock costs, and share the result.");
    assert.equal(appliedAttrs["meta[property=\"og:image\"][content]"], "https://rd2-lab.pages.dev/api/shares/Ab1234/image?locale=en");
    assert.equal(appliedAttrs["meta[name=\"twitter:image\"][content]"], "https://rd2-lab.pages.dev/api/shares/Ab1234/image?locale=en");
    assert.equal(appliedAttrs["meta[property=\"og:url\"][content]"], "https://rd2-lab.pages.dev/en/simulation/Ab1234");
    assert.equal(appliedAttrs["link[rel=\"canonical\"], link[id=\"seo-canonical\"][href]"], "https://rd2-lab.pages.dev/en/simulation/Ab1234");

    // 2. 測試無語系相容模式 (locale: null)
    const reqLegacy = new Request("https://rd2-lab.pages.dev/simulation/Ab1234");
    const resultLegacy = await handleSimulationShareRequest({
      request: reqLegacy,
      params: { code: "Ab1234" },
      env: mockEnv,
      locale: null
    });
    assert.equal(resultLegacy._isTransformed, true);

    const legacyAttrs = {};
    for (const { selector, handler } of resultLegacy.handlers) {
      if (typeof handler.element === "function") {
        handler.element({
          setAttribute(name, val) {
            legacyAttrs[`${tagOrSelector(selector)}[${name}]`] = val;
          },
          setInnerContent() {}
        });
      }
    }
    function tagOrSelector(s) {
      return s;
    }
    assert.equal(legacyAttrs["html[lang]"], "zh-tw");
    assert.equal(legacyAttrs["meta[property=\"og:url\"][content]"], "https://rd2-lab.pages.dev/simulation/Ab1234");
    assert.equal(legacyAttrs["link[rel=\"canonical\"], link[id=\"seo-canonical\"][href]"], "https://rd2-lab.pages.dev/simulation/Ab1234");

    // 3. 測試無效代碼 (非 6 碼) 不進行改寫
    const reqInvalid = new Request("https://rd2-lab.pages.dev/simulation/invalid-code");
    const resultInvalid = await handleSimulationShareRequest({
      request: reqInvalid,
      params: { code: "invalid-code" },
      env: mockEnv,
      locale: null
    });
    assert.equal(resultInvalid._isTransformed, undefined);
  } finally {
    globalThis.HTMLRewriter = originalRewriter;
  }
});
