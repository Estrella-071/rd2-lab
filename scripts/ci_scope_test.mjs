import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const scriptPath = path.join(process.cwd(), 'scripts', 'ci_scope.mjs');

function assertScope(name, files, environment, expected) {
  for (const file of files) {
    if (!fs.existsSync(path.join(process.cwd(), file))) {
      throw new Error(`${name} uses a missing repository path: ${file}`);
    }
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd2-ci-scope-'));
  const outputPath = path.join(tempDir, 'github-output');
  const env = { ...process.env, ...environment };
  env.GITHUB_OUTPUT = outputPath;
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      input: `${files.join('\n')}\n`,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`${name} exited ${result.status}: ${result.stderr}`);
    }
    const expectedText = `full=${expected.full}; browser=${expected.browser}; docs-only=${expected.docsOnly}`;
    if (!result.stdout.includes(expectedText)) {
      throw new Error(`${name} expected ${expectedText}, got: ${result.stdout.trim()}`);
    }
    const outputs = Object.fromEntries(
      fs.readFileSync(outputPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map(line => line.split('=')),
    );
    if (outputs.full !== String(expected.full) || outputs.browser !== String(expected.browser) || outputs.docs_only !== String(expected.docsOnly)) {
      throw new Error(`${name} wrote unexpected GitHub outputs: ${JSON.stringify(outputs)}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

assertScope('docs-only', ['README.md', 'CONTRIBUTING.md'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: false, browser: false, docsOnly: true });

assertScope('nested-docs-only', ['docs/adr/ADR-006-tiered-test-safety-nets.md', 'docs/adr/ADR-007-backend-boundary-and-zero-stubs.md'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: false, browser: false, docsOnly: true });

assertScope('runtime', ['site/index.html'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('data', ['site/data/dice_tree.json'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('source', ['src/main.js'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('pages-function', ['functions/api/shares.js'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('cloudflare-config', ['wrangler.jsonc'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('browser-test', ['tests/e2e/compendium_events.suite.mjs'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('browser-helper', ['tests/helpers/test_server.mjs'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('browser-build-helper', ['scripts/runtime_asset_paths.mjs'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('performance-script', ['scripts/measure_pages_performance.mjs'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('performance-budget', ['performance-budget.json'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('published-data', ['data/provenance.json'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: false, docsOnly: false });

assertScope('workflow', ['.github/workflows/ci.yml'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: true, docsOnly: false });

assertScope('codeowners', ['.github/CODEOWNERS'], {
  GITHUB_EVENT_NAME: 'pull_request',
  CI_FORCE_FULL: 'false',
}, { full: true, browser: false, docsOnly: false });

assertScope('push', ['README.md'], {
  GITHUB_EVENT_NAME: 'push',
  CI_FORCE_FULL: 'true',
}, { full: true, browser: true, docsOnly: false });

console.log('CI scope classification tests passed.');
