import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectPublicPathReferences,
  validatePublicPathReferences,
} from '../../scripts/public_path_contract.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

test('public path contract: every canonical *_path is allowlisted and present in site', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'data', 'game_data_metadata.json'), 'utf8'));
  const allowlist = JSON.parse(fs.readFileSync(path.join(rootDir, 'site', 'runtime-allowlist.json'), 'utf8'));
  const references = collectPublicPathReferences(metadata);
  const allowlisted = new Set([
    ...(allowlist.staticFiles || []),
    ...(allowlist.assetFiles || []),
    ...(allowlist.iconFiles || []),
  ]);

  assert(references.length > 0, 'canonical metadata must expose at least one public path');
  for (const { keyPath, relativePath } of references) {
    assert.equal(typeof relativePath, 'string', `${keyPath} must be a string`);
    assert.equal(allowlisted.has(relativePath), true, `${keyPath} must be in the runtime allowlist`);
  }

  const result = validatePublicPathReferences({
    metadata,
    publicRoot: path.join(rootDir, 'site'),
    allowedPaths: allowlisted,
  });
  assert.deepEqual(result.errors, []);
});

test('public path contract: nested, missing, non-string, and unsafe references are reported', () => {
  const publicRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rd2-public-paths-'));
  try {
    fs.mkdirSync(path.join(publicRoot, 'data'), { recursive: true });
    fs.writeFileSync(path.join(publicRoot, 'data', 'present.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(publicRoot, 'data', 'undeclared.json'), '{}\n', 'utf8');

    const result = validatePublicPathReferences({
      publicRoot,
      metadata: {
        canonical: {
          present_path: 'data/present.json',
          missing_path: 'data/missing.json',
          non_string_path: null,
          nested: [{ unsafe_path: '../private.json' }],
          windows_path: 'C:\\private.json',
          undeclared_path: 'data/undeclared.json',
        },
      },
      allowedPaths: [
        'data/present.json',
        'data/missing.json',
        '../private.json',
        'C:\\private.json',
      ],
    });

    assert.equal(result.references.length, 6);
    assert(result.errors.some(error => error.includes('missing_path') && error.includes('missing public file')));
    assert(result.errors.some(error => error.includes('non_string_path') && error.includes('non-empty public path')));
    assert(result.errors.some(error => error.includes('unsafe_path') && error.includes('unsafe public path')));
    assert(result.errors.some(error => error.includes('windows_path') && error.includes('relative POSIX public path')));
    assert(result.errors.some(error => error.includes('undeclared_path') && error.includes('not declared in the public manifest')));
  } finally {
    fs.rmSync(publicRoot, { recursive: true, force: true });
  }
});
