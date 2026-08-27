import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve("src");
const DOMAIN_DIR = path.join(SRC_DIR, "domain");

const FORBIDDEN_DOM_PATTERNS = [
  { name: "window", regex: /\bwindow\b/ },
  { name: "document", regex: /\bdocument\b/ },
  { name: "document.createElement", regex: /\bdocument\.createElement\b/ },
  { name: "HTMLElement", regex: /\bHTMLElement\b/ },
  { name: "localStorage", regex: /\blocalStorage\b/ },
  { name: "sessionStorage", regex: /\bsessionStorage\b/ },
  { name: "fetch API", regex: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", regex: /\bXMLHttpRequest\b/ },
  { name: "WebGLContext", regex: /\bWebGLRenderingContext\b/ },
  { name: "CanvasElement", regex: /\bHTMLCanvasElement\b/ },
  { name: "requestAnimationFrame", regex: /\brequestAnimationFrame\b/ }
];

const FORBIDDEN_IMPORT_PATTERNS = [
  { name: "import from app", regex: /from\s+['"].*\/app\/.*['"]/ },
  { name: "import from infra", regex: /from\s+['"].*\/infra\/.*['"]/ },
  { name: "import from ui", regex: /from\s+['"].*\/ui\/.*['"]/ }
];

test("structural_integrity: 驗證 src/domain 目錄下所有模組皆無 DOM/瀏覽器依賴", () => {
  assert.ok(fs.existsSync(DOMAIN_DIR), "src/domain 目錄必須存在");

  const files = fs.readdirSync(DOMAIN_DIR).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
  assert.ok(files.length >= 8, `src/domain 應至少有 8 個模組檔案，目前找到 ${files.length} 個`);

  const violations = [];

  for (const file of files) {
    const filePath = path.join(DOMAIN_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");

    // 移除註解以避免 JSDoc 誤判
    const codeOnly = content.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

    for (const pattern of FORBIDDEN_DOM_PATTERNS) {
      if (pattern.regex.test(codeOnly)) {
        violations.push(`${file} 包含禁用的 DOM/瀏覽器 API: ${pattern.name}`);
      }
    }

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push(`${file} 包含非法的向外層引用: ${pattern.name}`);
      }
    }
  }

  assert.equal(violations.length, 0, `發現結構性邊界違規:\n${violations.join("\n")}`);
});

test("structural_integrity: 驗證領域模組與 index.js 匯出完整性", async () => {
  const indexModule = await import("../../src/domain/index.js");

  // 驗證核心函式匯出
  const requiredFunctions = [
    "calculateBonus",
    "calculateFullDiceBonus",
    "calculateGolemStats",
    "deriveRankFromHpPercent",
    "deriveRankFromSp",
    "calculateCoopSp",
    "calculateVersusSp",
    "describeMonsterSp",
    "computeUpstreamTopologyPath",
    "precomputePrerequisiteGraph",
    "validateGraphTopology",
    "filterWaveEvents",
    "generateAugmentTreeStructure",
    "shouldPlaceTooltipBelow",
    "computeTooltipScreenCoordinates",
    "formatGameText",
    "sanitizeGameMarkup",
    "resolveGameText",
    "createSimulationState",
    "evaluateNode",
    "applyNodeRank",
    "planBatchUnlock",
    "planMaxRank",
    "getSimulationNodeView",
    "getDataVersion",
    "serializeSimulationState",
    "decodeSimulationShare",
    "hydrateSimulationShare"
  ];

  for (const fnName of requiredFunctions) {
    assert.equal(typeof indexModule[fnName], "function", `src/domain/index.js 必須匯出函式: ${fnName}`);
  }
});

test("structural_integrity: 驗證分層依賴方向與視圖隔離", () => {
  const violations = [];
  const layerRules = {
    app: [{ name: "infra import", regex: /from\s+["'][^"']*\/infra\// }, { name: "ui import", regex: /from\s+["'][^"']*\/ui\// }],
    infra: [{ name: "ui import", regex: /from\s+["'][^"']*\/ui\// }],
    ui: [{ name: "infra import", regex: /from\s+["'][^"']*\/infra\// }]
  };

  const filesByLayer = {};
  for (const layer of Object.keys(layerRules)) {
    const layerDir = path.join(SRC_DIR, layer);
    filesByLayer[layer] = fs.readdirSync(layerDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => ({ name: entry.name, path: path.join(layerDir, entry.name) }));
  }

  for (const [layer, files] of Object.entries(filesByLayer)) {
    for (const file of files) {
      const content = fs.readFileSync(file.path, "utf8");
      const codeOnly = content.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const rule of layerRules[layer]) {
        if (rule.regex.test(codeOnly)) violations.push(`${layer}/${file.name}: ${rule.name}`);
      }
      if (layer === "ui" && file.name !== "index.js" && /from\s+["'][.]+\/ui\//.test(codeOnly)) {
        violations.push(`${layer}/${file.name}: view-to-view import`);
      }
    }
  }

  assert.equal(violations.length, 0, `發現分層依賴違規:\n${violations.join("\n")}`);
});
