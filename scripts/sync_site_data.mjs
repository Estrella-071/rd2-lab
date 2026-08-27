import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'site', 'data');
const jsonPath = path.join(dataDir, 'dice_tree.json');
const svgPath = path.join(dataDir, 'dice_tree.svg');

if (!fs.existsSync(jsonPath)) {
  console.error('Missing site/data/dice_tree.json');
  process.exit(1);
}
if (!fs.existsSync(svgPath)) {
  console.error('Missing site/data/dice_tree.svg');
  process.exit(1);
}

console.log('Canonical sources site/data/dice_tree.json and site/data/dice_tree.svg are present.');
