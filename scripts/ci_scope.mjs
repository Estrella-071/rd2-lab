import fs from 'node:fs';

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const eventName = process.env.GITHUB_EVENT_NAME || 'local';
const forceFull = process.env.CI_FORCE_FULL === 'true' || (eventName !== 'pull_request' && eventName !== 'local');
const files = [...new Set(
  fs.readFileSync(0, 'utf8')
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(Boolean),
)].sort(compareText);

const documentationOnly = file => [
  /^[^/]+\.(?:md|cff)$/i,
  /^docs\/.*\.(?:md|cff)$/i,
  /^LICENSE$/i,
  /^\.github\/(?:dependabot\.yml|pull_request_template\.md|ISSUE_TEMPLATE\/[^/]+\.(?:md|yml))$/i,
  /^site\/README\.md$/i,
].some(pattern => pattern.test(file));

const browserRelevant = file => (
  file === 'package.json'
  || file === 'package-lock.json'
  || file.startsWith('.github/workflows/')
  // Pages is built from src/; source-only PRs must still exercise the
  // browser gate even though the generated site is not committed.
  || file.startsWith('src/')
  || file.startsWith('functions/')
  || file.startsWith('migrations/')
  || file === 'wrangler.jsonc'
  || file.startsWith('site/') && !file.endsWith('.md')
  || file === 'scripts/build_pages.mjs'
  || file === 'scripts/runtime_asset_paths.mjs'
  || file === 'scripts/measure_pages_performance.mjs'
  || file === 'scripts/ci_scope.mjs'
  || file === 'scripts/ci_scope_test.mjs'
  || file === 'scripts/sync_site_data.mjs'
  || file === 'scripts/verify_local.mjs'
  // Browser suites share the local server/browser/assertion helpers; changing
  // those helpers can invalidate every browser result just like changing a
  // suite itself.
  || file.startsWith('tests/helpers/')
  || file.startsWith('tests/e2e/')
  || file === 'tests/run_all_tests.mjs'
  || file === 'performance-budget.json'
);

const docsOnly = !forceFull && files.length > 0 && files.every(documentationOnly);
const full = forceFull || files.length === 0 || !docsOnly;
const browser = forceFull || files.length === 0 || files.some(browserRelevant);

const outputs = {
  full: String(full),
  browser: String(browser),
  docs_only: String(docsOnly),
  changed_count: String(files.length),
};

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  const outputText = Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(outputPath, `${outputText}\n`);
}

console.log(`CI scope: ${files.length} changed file(s); full=${full}; browser=${browser}; docs-only=${docsOnly}`);
