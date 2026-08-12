/**
 * Keep the reviewed CSS readable in source while serving a compact equivalent
 * from the Pages staging artifact.
 */
function consumeCssCommentCharacter(state, char, next) {
  if (char === '*' && next === '/') {
    state.output += ' ';
    state.inComment = false;
    return 1;
  }
  return 0;
}

function consumeCssQuotedCharacter(state, char, next) {
  state.output += char;
  if (char === '\\' && next !== undefined) {
    state.output += next;
    return 1;
  }
  if (char === state.quote) state.quote = null;
  return 0;
}

function stripCssComments(source) {
  const state = { output: '', quote: null, inComment: false };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state.inComment) {
      index += consumeCssCommentCharacter(state, char, next);
      continue;
    }
    if (state.quote) {
      index += consumeCssQuotedCharacter(state, char, next);
      continue;
    }
    if (char === '/' && next === '*') {
      state.inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") state.quote = char;
    state.output += char;
  }
  return state.output;
}

export function minifyCssForStaging(source) {
  const withoutComments = stripCssComments(source);
  return `${withoutComments
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')}\n`;
}
