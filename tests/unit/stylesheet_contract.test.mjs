import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectCssColorLiteralCounts,
  collectCssDeclarationRules,
  collectCssRuleSelectors,
  collectLocalStylesheetHrefs,
  findCrossFileSelectors,
  findSameScopePropertyOverrides,
  orderedStylesheets,
  validateStylesheetContract,
} from '../../scripts/stylesheet_contract.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

function writeFixtureSite({ indexStylesheets, allowlistStylesheets, sources }) {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd2-stylesheet-contract-'));
  const links = [
    '<link rel="stylesheet" href="https://fonts.example.test/font.css">',
    ...indexStylesheets.map(href => `<link rel="stylesheet" href="${href}">`),
  ];
  fs.writeFileSync(
    path.join(siteDir, 'index.html'),
    `<!doctype html><html><head>${links.join('')}</head><body></body></html>\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(siteDir, 'runtime-allowlist.json'),
    `${JSON.stringify({ staticFiles: ['index.html', ...allowlistStylesheets] }, null, 2)}\n`,
    'utf8',
  );
  for (const [relativePath, source] of Object.entries(sources)) {
    fs.writeFileSync(path.join(siteDir, relativePath), source, 'utf8');
  }
  return siteDir;
}

test('stylesheet contract: canonical source links, files, and allowlist share one order', () => {
  const result = validateStylesheetContract({
    siteDir: path.join(rootDir, 'site'),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.files.map(file => file.relativePath),
    orderedStylesheets,
  );
  assert.equal(
    result.totalBytes,
    result.files.reduce((sum, file) => sum + file.bytes, 0),
  );
  assert.equal(Buffer.byteLength(result.css), result.totalBytes);
  assert.deepEqual(findCrossFileSelectors(result.files), []);
});

test('stylesheet contract: local links are collected in document order', () => {
  const hrefs = collectLocalStylesheetHrefs(`
    <link rel="stylesheet" href="https://fonts.example.test/font.css">
    <link href="./styles.css?v=1" rel="stylesheet">
    <link rel='stylesheet' href='styles-features.css#current'>
    <link rel="stylesheet" href="styles-overlays.css">
  `);

  assert.deepEqual(hrefs, orderedStylesheets);
});

test('stylesheet contract: reordered links and deployment files fail closed', () => {
  const reversed = [...orderedStylesheets].reverse();
  const siteDir = writeFixtureSite({
    indexStylesheets: reversed,
    allowlistStylesheets: reversed,
    sources: Object.fromEntries(orderedStylesheets.map(name => [name, `.${name} {}\n`])),
  });

  try {
    const result = validateStylesheetContract({ siteDir });
    assert(result.errors.some(error => error.startsWith('Local stylesheet link order mismatch:')));
    assert(result.errors.some(error => error.startsWith('Runtime stylesheet allowlist order mismatch:')));
  } finally {
    fs.rmSync(siteDir, { recursive: true, force: true });
  }
});

test('stylesheet contract: conditional or event-driven loading fails closed', () => {
  const sources = Object.fromEntries(orderedStylesheets.map(name => [name, `.${name} {}\n`]));
  const siteDir = writeFixtureSite({
    indexStylesheets: orderedStylesheets,
    allowlistStylesheets: orderedStylesheets,
    sources,
  });
  const indexPath = path.join(siteDir, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8').replace(
    '<link rel="stylesheet" href="styles-features.css">',
    '<link rel="preload stylesheet" href="styles-features.css" media="print" onload="this.media=\'all\'">',
  );
  fs.writeFileSync(indexPath, indexHtml, 'utf8');

  try {
    const result = validateStylesheetContract({ siteDir });
    assert(result.errors.includes(
      'Ordered stylesheet must use an unconditional static link: styles-features.css',
    ));
  } finally {
    fs.rmSync(siteDir, { recursive: true, force: true });
  }
});

test('stylesheet contract: runtime imports and unsafe file boundaries fail closed', () => {
  const sources = Object.fromEntries(orderedStylesheets.map(name => [name, `.${name} {}\n`]));
  sources['styles-features.css'] = '@import url("late.css");\n.feature {}\n';
  sources['styles-overlays.css'] = '.overlay {}';
  const siteDir = writeFixtureSite({
    indexStylesheets: orderedStylesheets,
    allowlistStylesheets: orderedStylesheets,
    sources,
  });

  try {
    const result = validateStylesheetContract({ siteDir });
    assert(result.errors.includes(
      'Runtime @import is forbidden in ordered stylesheet: styles-features.css',
    ));
    assert(result.errors.includes(
      'Ordered stylesheet must end with a newline: styles-overlays.css',
    ));
  } finally {
    fs.rmSync(siteDir, { recursive: true, force: true });
  }
});

test('stylesheet ownership: selectors have one file owner across responsive scopes', () => {
  const files = [
    {
      relativePath: 'styles.css',
      source: '.shared { color: white; }\n.base-only { display: block; }\n',
    },
    {
      relativePath: 'styles-features.css',
      source: [
        '.feature-only { display: grid; }',
        '@media (max-width: 768px) { .feature-only { grid-template-columns: 1fr; } }',
        '',
      ].join('\n'),
    },
    {
      relativePath: 'styles-overlays.css',
      source: '@media (prefers-reduced-motion: reduce) { .shared { animation: none; } }\n',
    },
  ];

  assert.deepEqual(findCrossFileSelectors(files), [
    {
      selector: '.shared',
      relativePaths: ['styles.css', 'styles-overlays.css'],
    },
  ]);
});

test('stylesheet ownership: functional and attribute selector commas stay intact', () => {
  assert.deepEqual(
    collectCssRuleSelectors([
      '.control:is(.is-open, .is-active),',
      '[data-label="rank, level"] { color: white; }',
      '',
    ].join('\n')),
    [
      { selector: '.control:is(.is-open, .is-active)', atRuleScope: '' },
      { selector: '[data-label="rank, level"]', atRuleScope: '' },
    ],
  );
});

test('stylesheet declarations: selectors retain scope, source line, and parsed values', () => {
  const rules = collectCssDeclarationRules([
    '.control:is(.is-open, .is-active),',
    '[data-label="rank, level"] {',
    '  color: rgba(255, 255, 255, 0.8);',
    '  background: linear-gradient(90deg, #111, #222) !important;',
    '}',
    '@media (max-width: 768px) {',
    '  .control:is(.is-open, .is-active) { color: white; }',
    '}',
    '',
  ].join('\n'));

  assert.deepEqual(rules, [
    {
      selector: '.control:is(.is-open, .is-active)',
      atRuleScope: '',
      declarations: [
        { property: 'color', value: 'rgba(255, 255, 255, 0.8)', important: false },
        { property: 'background', value: 'linear-gradient(90deg, #111, #222) !important', important: true },
      ],
      line: 1,
      ruleIndex: 0,
    },
    {
      selector: '[data-label="rank, level"]',
      atRuleScope: '',
      declarations: [
        { property: 'color', value: 'rgba(255, 255, 255, 0.8)', important: false },
        { property: 'background', value: 'linear-gradient(90deg, #111, #222) !important', important: true },
      ],
      line: 1,
      ruleIndex: 0,
    },
    {
      selector: '.control:is(.is-open, .is-active)',
      atRuleScope: '@media (max-width: 768px)',
      declarations: [
        { property: 'color', value: 'white', important: false },
      ],
      line: 7,
      ruleIndex: 1,
    },
  ]);
});

test('stylesheet declarations: same-scope property overrides are reported across rule blocks', () => {
  const files = [{
    relativePath: 'styles.css',
    source: [
      '.shared { color: white; background: #111; background: linear-gradient(#111, #222); }',
      '.other { color: white; }',
      '.shared { color: black !important; border: 0; }',
      '@media (max-width: 768px) { .shared { color: blue; } }',
      '',
    ].join('\n'),
  }];

  assert.deepEqual(findSameScopePropertyOverrides(files), [
    {
      relativePath: 'styles.css',
      selector: '.shared',
      atRuleScope: '',
      property: 'color',
      occurrences: [
        { line: 1, ruleIndex: 0, value: 'white', important: false },
        { line: 3, ruleIndex: 2, value: 'black !important', important: true },
      ],
    },
  ]);
});

test('stylesheet colors: counts declaration literals once per rule and normalizes short hex', () => {
  const counts = collectCssColorLiteralCounts([{
    relativePath: 'styles.css',
    source: [
      ':root { --white: #ffffff; }',
      '.alpha, .beta { color: #FFF; box-shadow: 0 0 1px #6c461b, 0 0 2px #6C461B; }',
      '#fade { background: rgba( 0 , 0 , 0 , 0.5 ); }',
      '',
    ].join('\n'),
  }]);

  assert.deepEqual([...counts], [
    ['#ffffff', 2],
    ['#6c461b', 2],
    ['rgba(0, 0, 0, 0.5)', 1],
  ]);
});
