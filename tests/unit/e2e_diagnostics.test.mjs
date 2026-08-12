import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertNoUnexpectedBrowserDiagnostics, captureFailureArtifacts } from "../helpers/test_utils.mjs";

test("browser-cancelled requests are not reported as network failures", () => {
  assert.doesNotThrow(() => assertNoUnexpectedBrowserDiagnostics({
    diagnostics: {
      console: [],
      pageErrors: [],
      requestFailures: [
        { method: "GET", url: "http://127.0.0.1/icons/pending.png", failure: "net::ERR_ABORTED" },
        { method: "GET", url: "http://127.0.0.1/icons/pending-firefox.png", failure: "NS_BINDING_ABORTED" }
      ]
    }
  }));
});

test("E2E failure diagnostics persist context, screenshot, and trace", async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd2-e2e-diagnostics-"));
  const page = {
    url: () => "http://127.0.0.1:43210/index.html?case=diagnostic",
    viewportSize: () => ({ width: 390, height: 844 }),
    screenshot: async ({ path: screenshotPath }) => fs.writeFileSync(screenshotPath, "png-placeholder")
  };
  const browserInstance = {
    page,
    diagnostics: {
      console: [{ type: "error", text: "fixture console error" }],
      pageErrors: [{ message: "fixture page error", stack: null }],
      requestFailures: [{ method: "GET", url: "http://127.0.0.1:43210/missing", failure: "net::ERR_FAILED" }]
    },
    saveTrace: async (tracePath) => {
      fs.writeFileSync(tracePath, "trace-placeholder");
      return true;
    }
  };

  try {
    const result = await captureFailureArtifacts({
      suiteName: "Mobile Viewport",
      error: new Error("fixture assertion failed"),
      browser: "chromium",
      browserInstance,
      baseUrl: "http://127.0.0.1:43210",
      artifactDir
    });

    const failureDir = path.join(artifactDir, "failures");
    const files = fs.readdirSync(failureDir);
    const reportFile = files.find((file) => file.endsWith(".json"));
    const report = JSON.parse(fs.readFileSync(path.join(failureDir, reportFile), "utf8"));

    assert.match(result.message, /browser=chromium/);
    assert.match(result.message, /diagnostics=.*\.json/);
    assert.equal(report.url, "http://127.0.0.1:43210/index.html?case=diagnostic");
    assert.deepEqual(report.viewport, { width: 390, height: 844 });
    assert.equal(report.console[0].text, "fixture console error");
    assert.ok(report.screenshot.endsWith(".png"));
    assert.ok(report.trace.endsWith(".zip"));
    assert.ok(fs.existsSync(path.join(failureDir, path.basename(report.screenshot))));
    assert.ok(fs.existsSync(path.join(failureDir, path.basename(report.trace))));
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});
