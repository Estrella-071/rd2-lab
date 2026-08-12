#!/usr/bin/env node
/**
 * Random Dice 2 Unified E2E Test Suite Runner
 * 支援 --suite, --browser, --headless 等 CLI 參數
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmokeSuite } from './e2e/smoke.suite.mjs';
import { runTreeInteractionsSuite } from './e2e/tree_interactions.suite.mjs';
import { runCompendiumEventsSuite } from './e2e/compendium_events.suite.mjs';
import { runMobileViewportSuite } from './e2e/mobile_viewport.suite.mjs';
import { runSimulationModeSuite } from './e2e/simulation_mode.suite.mjs';
import { assertRuntimeFreshness } from './helpers/runtime_freshness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactDir = path.resolve(__dirname, '..', 'artifacts', 'test-results');

function assertRuntimeSourceFresh() {
  const rootDir = path.resolve(__dirname, '..');
  const runtimeDir = path.resolve(process.env.VERIFY_SITE_DIR || path.join(rootDir, 'site'));
  const allowedRuntimeDirs = [path.join(rootDir, 'site'), path.join(rootDir, '.pages')].map((directory) => path.resolve(directory));
  if (!allowedRuntimeDirs.includes(runtimeDir)) return;
  assertRuntimeFreshness({ rootDir, runtimeDir });
}

fs.mkdirSync(artifactDir, { recursive: true });

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    suite: 'all',
    browser: 'chromium',
    headless: true,
    bail: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--suite=')) {
      options.suite = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--browser=')) {
      options.browser = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--dir=')) {
      const dirVal = arg.split('=')[1];
      options.dir = dirVal;
      process.env.VERIFY_SITE_DIR = path.resolve(__dirname, '..', dirVal);
    } else if (arg === '--headed' || arg === '--headless=false') {
      options.headless = false;
    } else if (arg === '--bail') {
      options.bail = true;
    }
  }

  return options;
}

function createSuiteMap() {
  return {
    smoke: { name: 'Tier 1 Smoke Suite', fn: runSmokeSuite },
    tree: { name: 'Tier 1/2/3 Tree Interactions Suite', fn: runTreeInteractionsSuite },
    compendium: { name: 'Tier 1/2/3/4 Compendium & Events Suite', fn: runCompendiumEventsSuite },
    mobile: { name: 'Tier 3/4 Mobile Viewport Suite', fn: runMobileViewportSuite },
    simulation: { name: 'Tier 3/4 Simulation Planning Suite', fn: runSimulationModeSuite },
  };
}

function resolveSuiteKeys(options, suiteMap) {
  if (options.suite === 'all') {
    return ['smoke', 'tree', 'compendium', 'mobile', 'simulation'];
  }
  if (suiteMap[options.suite]) return [options.suite];
  console.error(`Unknown suite: "${options.suite}". Available: smoke, tree, compendium, mobile, simulation, all`);
  process.exit(1);
}

async function executeSuites(suitesToRun, suiteMap, options) {
  const results = [];
  let allPassed = true;
  for (const key of suitesToRun) {
    const entry = suiteMap[key];
    console.log(`\n▶ Starting [${entry.name}]...`);
    const res = await entry.fn({
      browser: options.browser,
      headless: options.headless,
    });
    results.push(res);

    if (!res.passed) {
      allPassed = false;
      if (options.bail) {
        console.error(`\n--bail flag enabled. Stopping execution after the first failure.`);
        break;
      }
    }
  }
  return { results, allPassed };
}

function printSummary(results, allPassed, totalDurationMs) {
  const totalAssertions = results.reduce((acc, r) => acc + (r.assertions || 0), 0);
  console.log('\n\n════════════════════════════════════════════════════════════════════');
  console.log('                      TEST EXECUTION SUMMARY                        ');
  console.log('════════════════════════════════════════════════════════════════════');
  for (const r of results) {
    const statusIcon = r.passed ? 'PASS' : 'FAIL';
    const duration = `${(r.durationMs / 1000).toFixed(2)}s`;
    const assertions = `${r.assertions} checks`;
    console.log(` ${statusIcon} | ${r.name.padEnd(42)} | ${duration.padStart(8)} | ${assertions.padStart(10)}`);
    if (r.errors && r.errors.length > 0) {
      for (const err of r.errors) {
        console.log(`        └─ Error: ${err}`);
      }
    }
  }

  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`Total Time: ${(totalDurationMs / 1000).toFixed(2)}s | Total Assertions: ${totalAssertions} | Status: ${allPassed ? 'ALL PASSED' : 'FAILURES OCCURRED'}`);
  console.log('════════════════════════════════════════════════════════════════════\n');
  return totalAssertions;
}

function writeSummary(options, results, allPassed, totalDurationMs, totalAssertions) {
  const reportPath = path.join(artifactDir, 'summary.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalDurationMs,
    totalAssertions,
    allPassed,
    options,
    results,
  }, null, 2), 'utf8');
  console.log(`✓ Test execution summary saved to ${reportPath}\n`);
  return { reportPath, totalAssertions };
}

async function main() {
  const options = parseArgs();
  assertRuntimeSourceFresh();
  const overallStart = Date.now();
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║        RANDOM DICE 2 — UNIFIED 4-TIER E2E TEST SUITE RUNNER        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`[Config] Suite: ${options.suite.toUpperCase()} | Browser: ${options.browser} | Headless: ${options.headless} | Root: ${process.env.VERIFY_SITE_DIR || 'site'}\n`);
  const suiteMap = createSuiteMap();
  const suitesToRun = resolveSuiteKeys(options, suiteMap);
  const { results, allPassed } = await executeSuites(suitesToRun, suiteMap, options);
  const totalDurationMs = Date.now() - overallStart;
  const totalAssertions = printSummary(results, allPassed, totalDurationMs);
  writeSummary(options, results, allPassed, totalDurationMs, totalAssertions);

  process.exit(allPassed ? 0 : 1);
}

try {
  await main();
} catch (err) {
  console.error('Fatal runner error:', err);
  process.exit(1);
}
