import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..', '..');
const defaultArtifactDir = path.resolve(__dirname, '..', '..', 'artifacts', 'test-results');

fs.mkdirSync(defaultArtifactDir, { recursive: true });

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`[ASSERTION FAILED] ${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  }
}

export function assertIncludes(actual, expectedSub, message = '') {
  if (typeof actual === 'string' && !actual.includes(expectedSub)) {
    throw new Error(`[ASSERTION FAILED] ${message} - Expected "${actual}" to include "${expectedSub}"`);
  }
  if (Array.isArray(actual) && !actual.includes(expectedSub)) {
    throw new Error(`[ASSERTION FAILED] ${message} - Expected array to contain "${expectedSub}"`);
  }
}

export function assertInRange(value, min, max, message = '') {
  if (value < min || value > max) {
    throw new Error(`[ASSERTION FAILED] ${message} - Expected ${value} to be within [${min}, ${max}]`);
  }
}

function isBrowserCancelledRequest(entry) {
  return /(?:ERR_ABORTED|NS_BINDING_ABORTED)/i.test(String(entry?.failure || ''));
}

export function assertNoUnexpectedBrowserDiagnostics(browserInstance, context = 'browser', options = {}) {
  const diagnostics = browserInstance?.diagnostics || {};
  const pageErrors = diagnostics.pageErrors || [];
  const requestFailures = (diagnostics.requestFailures || []).filter((entry) => !isBrowserCancelledRequest(entry));
  const allowedConsoleErrors = Array.isArray(options.allowedConsoleErrors) ? options.allowedConsoleErrors : [];
  const matchesAllowedConsoleError = (text) => allowedConsoleErrors.some((matcher) => {
    if (matcher instanceof RegExp) return matcher.test(text || '');
    if (typeof matcher === 'function') return matcher(text || '');
    return String(text || '').includes(String(matcher));
  });
  const consoleErrors = (diagnostics.console || []).filter((entry) => {
    if (entry.type !== 'error') return false;
    // The smoke suite intentionally exercises bootstrap failure and records
    // that expected message while checking the visible recovery state.
    return !/Application bootstrap failed/i.test(entry.text || '')
      && !matchesAllowedConsoleError(entry.text || '');
  });
  const issues = [
    ...pageErrors.map((entry) => `pageerror: ${entry.message}`),
    ...requestFailures.map((entry) => `requestfailed: ${entry.method} ${entry.url} (${entry.failure || 'unknown'})`),
    ...consoleErrors.map((entry) => `console.error: ${entry.text}`)
  ];
  assert(issues.length === 0, `${context} emitted unexpected diagnostics:\n${issues.join('\n')}`);
}

export function getScreenshotPath(filename, suiteName = '') {
  const dir = suiteName ? path.join(defaultArtifactDir, suiteName) : defaultArtifactDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function safeArtifactStem(value) {
  const source = String(value || 'e2e-failure');
  let result = '';
  let separatorPending = false;
  for (const character of source) {
    const code = character.codePointAt(0);
    const valid = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || character === '_' || character === '.' || character === '-';
    if (valid) {
      if (separatorPending && result) result += '-';
      result += character.toLowerCase();
      separatorPending = false;
    } else if (result) {
      separatorPending = true;
    }
  }
  return result || 'e2e-failure';
}

function relativeArtifactPath(filePath) {
  return path.relative(websiteDir, filePath).replaceAll("\\", '/');
}

/**
 * Persist actionable failure evidence before a suite closes its browser.
 * The returned message remains compact for the console while the JSON file
 * contains the full error, URL, viewport, browser events, screenshot, and
 * Playwright trace paths.
 */
export async function captureFailureArtifacts({
  suiteName,
  error,
  browser = process.env.TEST_BROWSER || 'chromium',
  browserInstance = null,
  baseUrl = null,
  artifactDir = defaultArtifactDir
} = {}) {
  const failureDir = path.join(artifactDir, 'failures');
  fs.mkdirSync(failureDir, { recursive: true });
  const stem = `${safeArtifactStem(suiteName)}-${Date.now()}-${process.pid}`;
  const screenshotPath = path.join(failureDir, `${stem}.png`);
  const tracePath = path.join(failureDir, `${stem}.zip`);
  const reportPath = path.join(failureDir, `${stem}.json`);
  const page = browserInstance?.page || null;
  const details = {
    suite: suiteName || 'unknown',
    browser,
    baseUrl,
    url: null,
    viewport: null,
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null
    },
    console: browserInstance?.diagnostics?.console || [],
    pageErrors: browserInstance?.diagnostics?.pageErrors || [],
    requestFailures: browserInstance?.diagnostics?.requestFailures || [],
    screenshot: null,
    trace: null,
    captureErrors: []
  };

  if (page) {
    try { details.url = page.url(); } catch (captureError) { details.captureErrors.push(`url: ${captureError.message}`); }
    try { details.viewport = page.viewportSize(); } catch (captureError) { details.captureErrors.push(`viewport: ${captureError.message}`); }
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      details.screenshot = relativeArtifactPath(screenshotPath);
    } catch (captureError) {
      details.captureErrors.push(`screenshot: ${captureError.message}`);
    }
  }

  if (browserInstance?.saveTrace) {
    try {
      if (await browserInstance.saveTrace(tracePath)) details.trace = relativeArtifactPath(tracePath);
    } catch (captureError) {
      details.captureErrors.push(`trace: ${captureError.message}`);
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(details, null, 2), 'utf8');
  const reportRelative = relativeArtifactPath(reportPath);
  const location = details.url || baseUrl || 'unavailable';
  const evidence = [reportRelative];
  if (details.screenshot) evidence.push(details.screenshot);
  if (details.trace) evidence.push(details.trace);
  return {
    ...details,
    report: reportRelative,
    message: `${details.error.message} [suite=${details.suite}; browser=${browser}; url=${location}; diagnostics=${evidence.join(', ')}]`
  };
}

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
