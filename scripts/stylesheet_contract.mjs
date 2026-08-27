import fs from 'node:fs';
import path from 'node:path';

/**
 * Canonical browser cascade order for every local runtime stylesheet.
 *
 * Keep this list small and explicit. The Pages build, CSS quality gate, source
 * HTML, and runtime allowlist must all agree with this order.
 */
export const orderedStylesheets = Object.freeze([
  'styles.css',
  'styles-features.css',
  'styles-overlays.css',
]);

function readHtmlAttribute(tag, attributeName) {
  const match = tag.match(new RegExp(
    String.raw`\b${attributeName}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`,
    'i',
  ));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function hasHtmlAttribute(tag, attributeName) {
  return new RegExp(String.raw`\s${attributeName}(?:\s*=|\s|/?>)`, 'i').test(tag);
}

function collectLocalStylesheetLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = readHtmlAttribute(tag, 'rel');
    const relTokens = rel?.split(/\s+/).filter(Boolean).map(value => value.toLowerCase()) || [];
    if (!relTokens.includes('stylesheet')) continue;

    const href = readHtmlAttribute(tag, 'href');
    if (!href || /^(?:https?:)?\/\//i.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    links.push({
      href: href.split(/[?#]/, 1)[0].replace(/^\.\//, ''),
      relTokens,
      media: readHtmlAttribute(tag, 'media'),
      disabled: hasHtmlAttribute(tag, 'disabled'),
      onload: hasHtmlAttribute(tag, 'onload'),
    });
  }
  return links;
}

export function collectLocalStylesheetHrefs(html) {
  return collectLocalStylesheetLinks(html).map(link => link.href);
}

function stripCssComments(source) {
  return source.replaceAll(
    /\/\*[\s\S]*?\*\//g,
    comment => comment.replaceAll(/[^\r\n]/g, ' '),
  );
}

function createCssStructureState() {
  return {
    quote: null,
    parenthesisDepth: 0,
    bracketDepth: 0,
  };
}

function consumeCssStructureCharacter(source, index, state) {
  const char = source[index];
  if (state.quote) {
    if (char === '\\') return 1;
    if (char === state.quote) state.quote = null;
    return 0;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    return 0;
  }
  if (char === '(') {
    state.parenthesisDepth += 1;
    return 0;
  }
  if (char === ')') {
    state.parenthesisDepth = Math.max(0, state.parenthesisDepth - 1);
    return 0;
  }
  if (char === '[') {
    state.bracketDepth += 1;
    return 0;
  }
  if (char === ']') {
    state.bracketDepth = Math.max(0, state.bracketDepth - 1);
    return 0;
  }
  return null;
}

function isTopLevelCssStructure(state) {
  return state.parenthesisDepth === 0 && state.bracketDepth === 0;
}

function splitTopLevelTokens(source, delimiter) {
  const tokens = [];
  const state = createCssStructureState();
  let tokenStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const skippedCharacters = consumeCssStructureCharacter(source, index, state);
    if (skippedCharacters !== null) {
      index += skippedCharacters;
      continue;
    }
    if (source[index] !== delimiter || !isTopLevelCssStructure(state)) continue;
    tokens.push(source.slice(tokenStart, index).trim());
    tokenStart = index + 1;
  }

  tokens.push(source.slice(tokenStart).trim());
  return tokens.filter(Boolean);
}

function findTopLevelDelimiter(source, delimiter) {
  const state = createCssStructureState();
  for (let index = 0; index < source.length; index += 1) {
    const skippedCharacters = consumeCssStructureCharacter(source, index, state);
    if (skippedCharacters !== null) {
      index += skippedCharacters;
      continue;
    }
    if (source[index] === delimiter && isTopLevelCssStructure(state)) return index;
  }
  return -1;
}

function splitCssSelectorList(header) {
  return splitTopLevelTokens(header, ',');
}

function parseCssDeclaration(token) {
  const colonIndex = findTopLevelDelimiter(token, ':');
  if (colonIndex <= 0) return null;

  const property = token.slice(0, colonIndex).trim().toLowerCase();
  const value = token.slice(colonIndex + 1).trim();
  if (!property || !value) return null;
  return {
    property,
    value,
    important: /!\s*important\s*$/i.test(value),
  };
}

function splitCssDeclarations(source) {
  return splitTopLevelTokens(source, ';')
    .map(parseCssDeclaration)
    .filter(Boolean);
}

function createCssRuleEntry(clean, stack, tokenStart, headerEnd, ruleIndex) {
  const rawHeader = clean.slice(tokenStart, headerEnd);
  const header = rawHeader.trim().replaceAll(/\s+/g, ' ');
  const atRuleScope = stack
    .map(entry => entry.header)
    .filter(entry => entry.startsWith('@'))
    .join(' > ');
  const insideKeyframes = stack.some(entry => /^@(?:-webkit-)?keyframes\b/i.test(entry.header));
  const isRule = Boolean(header && !header.startsWith('@') && !insideKeyframes);
  const leadingWhitespace = rawHeader.search(/\S/);
  const headerStart = leadingWhitespace >= 0 ? tokenStart + leadingWhitespace : tokenStart;
  return {
    header,
    atRuleScope,
    bodyStart: headerEnd + 1,
    isRule,
    line: clean.slice(0, headerStart).split('\n').length,
    ruleIndex: isRule ? ruleIndex : null,
    selectors: isRule ? splitCssSelectorList(header) : [],
  };
}

function appendCssEntryRules(rules, entry, body) {
  if (!entry?.isRule) return;
  const declarations = splitCssDeclarations(body);
  for (const selector of entry.selectors) {
    rules.push({
      selector,
      atRuleScope: entry.atRuleScope,
      declarations,
      line: entry.line,
      ruleIndex: entry.ruleIndex,
    });
  }
}

export function collectCssDeclarationRules(source) {
  const clean = stripCssComments(source);
  const stack = [];
  const rules = [];
  const state = createCssStructureState();
  let tokenStart = 0;
  let nextRuleIndex = 0;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const skippedCharacters = consumeCssStructureCharacter(clean, index, state);
    if (skippedCharacters !== null) {
      index += skippedCharacters;
      continue;
    }
    if (!isTopLevelCssStructure(state)) continue;
    if (char === ';') {
      tokenStart = index + 1;
      continue;
    }
    if (char === '{') {
      const entry = createCssRuleEntry(clean, stack, tokenStart, index, nextRuleIndex);
      stack.push(entry);
      if (entry.isRule) nextRuleIndex += 1;
      tokenStart = index + 1;
      continue;
    }
    if (char === '}') {
      const entry = stack.pop();
      appendCssEntryRules(rules, entry, clean.slice(entry?.bodyStart || index, index));
      tokenStart = index + 1;
    }
  }

  return rules;
}

export function collectCssRuleSelectors(source) {
  return collectCssDeclarationRules(source).map(({ selector, atRuleScope }) => ({
    selector,
    atRuleScope,
  }));
}

export function findSameScopePropertyOverrides(files) {
  const groups = new Map();

  for (const file of files) {
    const rules = collectCssDeclarationRules(file.source);
    for (const rule of rules) {
      for (const declaration of rule.declarations) {
        const key = [
          file.relativePath,
          rule.atRuleScope,
          rule.selector,
          declaration.property,
        ].join('\u0000');
        if (!groups.has(key)) {
          groups.set(key, {
            relativePath: file.relativePath,
            selector: rule.selector,
            atRuleScope: rule.atRuleScope,
            property: declaration.property,
            occurrences: [],
          });
        }
        groups.get(key).occurrences.push({
          line: rule.line,
          ruleIndex: rule.ruleIndex,
          value: declaration.value,
          important: declaration.important,
        });
      }
    }
  }

  return [...groups.values()]
    .filter(group => new Set(group.occurrences.map(entry => entry.ruleIndex)).size > 1)
    .sort((left, right) => (
      left.relativePath.localeCompare(right.relativePath)
      || left.occurrences[0].line - right.occurrences[0].line
      || left.selector.localeCompare(right.selector)
      || left.property.localeCompare(right.property)
    ));
}

export function normalizeCssColorLiteral(literal) {
  let normalized = literal
    .toLowerCase()
    .replaceAll(/\s+/g, ' ');
  normalized = normalized
    .split(',')
    .map(part => part.trim())
    .join(', ')
    .replaceAll('( ', '(')
    .replaceAll(' )', ')');
  const shortHex = /^#([0-9a-f]{3}|[0-9a-f]{4})$/.exec(normalized);
  if (shortHex) {
    const expandedHex = [...shortHex[1]].map(character => character.repeat(2)).join('');
    normalized = `#${expandedHex}`;
  }
  return normalized;
}

export function collectCssColorLiteralCounts(files) {
  const counts = new Map();
  const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;

  for (const file of files) {
    const seenRuleIndexes = new Set();
    for (const rule of collectCssDeclarationRules(file.source)) {
      if (seenRuleIndexes.has(rule.ruleIndex)) continue;
      seenRuleIndexes.add(rule.ruleIndex);
      for (const declaration of rule.declarations) {
        for (const match of declaration.value.matchAll(colorPattern)) {
          const literal = normalizeCssColorLiteral(match[0]);
          counts.set(literal, (counts.get(literal) || 0) + 1);
        }
      }
    }
  }
  return counts;
}

export function findCrossFileSelectors(files) {
  const ownersBySelector = new Map();

  for (const file of files) {
    const selectorsInFile = new Set(
      collectCssRuleSelectors(file.source).map(rule => rule.selector),
    );
    for (const selector of selectorsInFile) {
      if (!ownersBySelector.has(selector)) {
        ownersBySelector.set(selector, []);
      }
      ownersBySelector.get(selector).push(file.relativePath);
    }
  }

  return [...ownersBySelector.entries()]
    .filter(([, relativePaths]) => relativePaths.length > 1)
    .map(([selector, relativePaths]) => ({ selector, relativePaths }));
}

function listsMatch(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isSafeStylesheetPath(relativePath) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  return normalizedPath === relativePath
    && !path.posix.isAbsolute(relativePath)
    && !relativePath.split('/').includes('..')
    && relativePath.endsWith('.css');
}

function readOrderedStylesheets(siteDir, errors) {
  const files = [];
  const uniqueStylesheets = new Set(orderedStylesheets);

  if (uniqueStylesheets.size !== orderedStylesheets.length) {
    errors.push('Ordered stylesheet contract contains duplicate paths.');
  }

  for (const relativePath of orderedStylesheets) {
    if (!isSafeStylesheetPath(relativePath)) {
      errors.push(`Unsafe stylesheet contract path: ${relativePath}`);
      continue;
    }

    const absolutePath = path.join(siteDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      errors.push(`Missing ordered stylesheet: ${relativePath}`);
      continue;
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    if (!source.endsWith('\n')) {
      errors.push(`Ordered stylesheet must end with a newline: ${relativePath}`);
    }
    if (/@import\b/i.test(stripCssComments(source))) {
      errors.push(`Runtime @import is forbidden in ordered stylesheet: ${relativePath}`);
    }
    files.push({
      relativePath,
      absolutePath,
      source,
      bytes: Buffer.byteLength(source),
    });
  }
  return files;
}

function validateStylesheetLinks(siteDir, errors) {
  const indexPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    errors.push('Missing site/index.html for stylesheet order validation.');
    return;
  }

  const stylesheetLinks = collectLocalStylesheetLinks(fs.readFileSync(indexPath, 'utf8'));
  const linkedStylesheets = stylesheetLinks.map(link => link.href);
  if (!listsMatch(linkedStylesheets, orderedStylesheets)) {
    errors.push(
      `Local stylesheet link order mismatch: expected ${orderedStylesheets.join(' -> ')}, `
      + `found ${linkedStylesheets.join(' -> ') || '(none)'}.`,
    );
  }
  for (const link of stylesheetLinks) {
    if (
      link.relTokens.length !== 1
      || link.relTokens[0] !== 'stylesheet'
      || link.media !== null
      || link.disabled
      || link.onload
    ) {
      errors.push(
        `Ordered stylesheet must use an unconditional static link: ${link.href}`,
      );
    }
  }
}

function validateRuntimeAllowlist(siteDir, errors) {
  const allowlistPath = path.join(siteDir, 'runtime-allowlist.json');
  if (!fs.existsSync(allowlistPath)) {
    errors.push('Missing site/runtime-allowlist.json for stylesheet deployment validation.');
    return;
  }

  try {
    const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    const allowlistedStylesheets = (allowlist.staticFiles || [])
      .filter(relativePath => typeof relativePath === 'string' && relativePath.endsWith('.css'));
    if (!listsMatch(allowlistedStylesheets, orderedStylesheets)) {
        errors.push(
          `Runtime stylesheet allowlist order mismatch: expected ${orderedStylesheets.join(' -> ')}, `
          + `found ${allowlistedStylesheets.join(' -> ') || '(none)'}.`,
        );
    }
  } catch (error) {
    errors.push(`Invalid site/runtime-allowlist.json: ${error.message}`);
  }
}

export function validateStylesheetContract({ siteDir }) {
  const errors = [];
  const files = readOrderedStylesheets(siteDir, errors);
  validateStylesheetLinks(siteDir, errors);
  validateRuntimeAllowlist(siteDir, errors);

  return {
    errors,
    files,
    css: files.map(file => file.source).join(''),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}
