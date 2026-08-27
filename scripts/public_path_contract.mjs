import fs from 'node:fs';
import path from 'node:path';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function collectPublicPathReferences(value, trail = []) {
  const references = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      references.push(...collectPublicPathReferences(entry, [...trail, String(index)]));
    });
    return references;
  }

  if (!isPlainObject(value)) return references;

  for (const [key, entry] of Object.entries(value)) {
    const entryTrail = [...trail, key];
    if (key.endsWith('_path')) {
      references.push({
        keyPath: entryTrail.join('.'),
        relativePath: entry,
      });
    }
    if (Array.isArray(entry) || isPlainObject(entry)) {
      references.push(...collectPublicPathReferences(entry, entryTrail));
    }
  }

  return references;
}

export function validatePublicPathReferences({ metadata, publicRoot, allowedPaths = null }) {
  const root = path.resolve(publicRoot);
  const references = collectPublicPathReferences(metadata);
  const errors = [];
  const allowed = allowedPaths ? new Set(allowedPaths) : null;

  for (const reference of references) {
    if (typeof reference.relativePath !== 'string' || reference.relativePath.trim() === '') {
      errors.push(`${reference.keyPath} must be a non-empty public path`);
      continue;
    }

    if (
      reference.relativePath.includes('\\')
      || /^[A-Za-z]:[\\/]/.test(reference.relativePath)
      || reference.relativePath.startsWith('\\\\')
    ) {
      errors.push(`${reference.keyPath} must use a relative POSIX public path: ${reference.relativePath}`);
      continue;
    }

    const relativePath = reference.relativePath;
    const segments = relativePath.split('/');
    if (
      path.isAbsolute(reference.relativePath)
      || relativePath.startsWith('/')
      || segments.includes('..')
    ) {
      errors.push(`${reference.keyPath} contains an unsafe public path: ${reference.relativePath}`);
      continue;
    }

    const resolved = path.resolve(root, ...segments);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      errors.push(`${reference.keyPath} escapes the public root: ${reference.relativePath}`);
      continue;
    }
    if (allowed && !allowed.has(relativePath)) {
      errors.push(`${reference.keyPath} is not declared in the public manifest: ${relativePath}`);
      continue;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      errors.push(`${reference.keyPath} points to a missing public file: ${reference.relativePath}`);
    }
  }

  return { references, errors };
}
