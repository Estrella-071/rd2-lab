import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCssColorLiteralCounts,
  findCrossFileSelectors,
  findSameScopePropertyOverrides,
  validateStylesheetContract,
} from './stylesheet_contract.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesheetContract = validateStylesheetContract({
  siteDir: path.join(rootDir, 'site'),
});
const css = stylesheetContract.css;
const errors = [...stylesheetContract.errors];
const cssComments = [...css.matchAll(/\/\*[\s\S]*?\*\//g)].map(match => match[0]).join('\n');
const cssWithoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const commentWarnings = new Map([
  [/\bDRY\b/i, 'DRY'],
  [/\b60\s*fps\b/i, 'frame-rate promise'],
  [/100%\s*(?:相同|完整)/, 'absolute percentage'],
  [/(?:完美|絕不|永遠|杜絕|徹底)/, 'absolute wording'],
]);
for (const [pattern, label] of commentWarnings) {
  if (pattern.test(cssComments)) {
    errors.push(`CSS comment contains an unverifiable claim: ${label}`);
  }
}

const governedTokens = new Map([
  ['--ink-primary', '#f8fafc'],
  ['--gold-currency', '#f5d358'],
  ['--core-currency', '#4cd5ff'],
  ['--positive', '#7ee352'],
  ['--surface-deep', '#1e172e'],
  ['--accent-violet', '#5a3fa2'],
  ['--accent-violet-bright', '#8c67e8'],
  ['--ink-violet-soft', '#d1c8e8'],
  ['--action-outline', '#221226'],
  ['--action-gold-border', '#eedb8d'],
  ['--action-gold-fill', '#ffcc19'],
  ['--white', '#ffffff'],
  ['--white-a05', 'rgba(255, 255, 255, 0.05)'],
  ['--white-a06', 'rgba(255, 255, 255, 0.06)'],
  ['--white-a08', 'rgba(255, 255, 255, 0.08)'],
  ['--white-a10', 'rgba(255, 255, 255, 0.1)'],
  ['--white-a12', 'rgba(255, 255, 255, 0.12)'],
  ['--white-a14', 'rgba(255, 255, 255, 0.14)'],
  ['--white-a15', 'rgba(255, 255, 255, 0.15)'],
  ['--white-a16', 'rgba(255, 255, 255, 0.16)'],
  ['--white-a22', 'rgba(255, 255, 255, 0.22)'],
  ['--white-a35', 'rgba(255, 255, 255, 0.35)'],
  ['--black-a40', 'rgba(0, 0, 0, 0.4)'],
  ['--black-a50', 'rgba(0, 0, 0, 0.5)'],
  ['--black-a60', 'rgba(0, 0, 0, 0.6)'],
  ['--black-a65', 'rgba(0, 0, 0, 0.65)'],
  ['--black-a70', 'rgba(0, 0, 0, 0.7)'],
  ['--black-a72', 'rgba(0, 0, 0, 0.72)'],
  ['--black-a80', 'rgba(0, 0, 0, 0.8)'],
  ['--black-a85', 'rgba(0, 0, 0, 0.85)'],
  ['--accent-violet-a25', 'rgba(140, 103, 232, 0.25)'],
  ['--accent-violet-a30', 'rgba(140, 103, 232, 0.3)'],
  ['--ink-violet-muted', '#9789ae'],
  ['--ink-violet-dim', '#a497bd'],
  ['--accent-gold-bright', '#ffd859'],
]);

for (const [token, literal] of governedTokens) {
  const definition = new RegExp(String.raw`${escapeRegExp(token)}\s*:\s*${escapeRegExp(literal)}`, 'i');
  if (!definition.test(cssWithoutComments)) {
    errors.push(`Missing governed token definition: ${token}: ${literal}`);
  }
  const literalCount = [...cssWithoutComments.matchAll(new RegExp(escapeRegExp(literal), 'gi'))].length;
  if (literalCount !== 1) {
    errors.push(`${literal} must appear only in ${token}; found ${literalCount} occurrences`);
  }
}

if (css.includes('var(--font-number')) {
  errors.push('Use the declared --font-numeric token instead of --font-number');
}

const sameScopePropertyOverrideAllowlist = new Map();
const sameScopePropertyOverrides = findSameScopePropertyOverrides(stylesheetContract.files);
const observedOverrideKeys = new Set();
for (const override of sameScopePropertyOverrides) {
  const key = [
    override.relativePath,
    override.atRuleScope,
    override.selector,
    override.property,
  ].join('\u0000');
  observedOverrideKeys.add(key);
  if (!sameScopePropertyOverrideAllowlist.has(key)) {
    const scopeLabel = override.atRuleScope ? ` in ${override.atRuleScope}` : '';
    const lineLabel = override.occurrences.map(entry => entry.line).join(', ');
    errors.push(
      `Unapproved same-scope property override: ${override.relativePath} `
      + `${override.selector}${scopeLabel} -> ${override.property} (lines ${lineLabel})`,
    );
  }
}
for (const [key, reason] of sameScopePropertyOverrideAllowlist) {
  if (!reason.trim()) {
    errors.push(`Same-scope property override allowlist entry needs a reason: ${key}`);
  } else if (!observedOverrideKeys.has(key)) {
    errors.push(`Stale same-scope property override allowlist entry: ${key}`);
  }
}

const highFrequencyColorThreshold = 5;
const highFrequencyColorAllowlist = new Map([
  [
    '#6c461b',
    'Component-local eight-direction gold text outline repeats one stroke color within two outline rules.',
  ],
  [
    '#3b0e17',
    'Component-local eight-direction red text outline repeats one stroke color within one outline rule.',
  ],
]);
const colorLiteralCounts = collectCssColorLiteralCounts(stylesheetContract.files);
for (const [literal, count] of colorLiteralCounts) {
  if (count < highFrequencyColorThreshold || highFrequencyColorAllowlist.has(literal)) continue;
  errors.push(
    `High-frequency color literal must use a governed token or documented allowlist entry: `
    + `${literal} (${count} occurrences)`,
  );
}
for (const [literal, reason] of highFrequencyColorAllowlist) {
  const count = colorLiteralCounts.get(literal) || 0;
  if (!reason.trim()) {
    errors.push(`High-frequency color allowlist entry needs a reason: ${literal}`);
  } else if (count < highFrequencyColorThreshold) {
    errors.push(
      `Stale high-frequency color allowlist entry: ${literal} `
      + `(${count}/${highFrequencyColorThreshold} occurrences)`,
    );
  }
}

const crossFileSelectors = findCrossFileSelectors(stylesheetContract.files);
for (const { selector, relativePaths } of crossFileSelectors) {
  errors.push(`Selector must have one stylesheet owner: ${selector} (${relativePaths.join(', ')})`);
}

// Keep this as a limit; lower it when possible.
const importantBudget = 220;
const importantCount = cssWithoutComments.match(/!important\b/gi)?.length || 0;
if (importantCount > importantBudget) {
  errors.push(`!important budget exceeded: ${importantCount} declarations (maximum ${importantBudget})`);
}

if (errors.length > 0) {
  console.error(`CSS quality check failed (${errors.length} issue(s)):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `CSS quality check passed across ${stylesheetContract.files.length} ordered files `
  + `(${stylesheetContract.totalBytes} bytes): ${governedTokens.size} governed tokens, `
  + `${sameScopePropertyOverrides.length} same-scope property override(s), `
  + `${sameScopePropertyOverrideAllowlist.size} documented override exception(s), `
  + `${highFrequencyColorAllowlist.size} documented high-frequency color exception(s), `
  + `${importantCount}/${importantBudget} !important declarations, single-owner selectors, `
  + 'no unverifiable claims.',
);
