# Reproducing a local build

Random Dice 2 Lab is a static site. A clean checkout builds the Pages artifact and runs the validation commands from the repository.

## Requirements

- Node.js 24 LTS or newer
- npm 10 or newer
- Chromium for browser checks

## Build and verify

```bash
git clone https://github.com/Estrella-071/rd2-lab.git
cd rd2-lab
npm ci
npm run audit:deps
npm run setup:browser
npm run generate:locales -- --source <source-table-dir>
npm run check:translations
npm run validate
npm run build:pages
npm run check:staging
npm run test:e2e:smoke
```

The build places the deployable files in `.pages/`. Run a local preview with:

```bash
python -m http.server 3000 --bind 127.0.0.1 --directory .pages
```

Open `http://127.0.0.1:3000` in a browser. The tree, compendium, planning mode, and share panel read the same files that the Pages workflow publishes.

## Data changes

Canonical data is stored under `site/data/`. Run `npm run validate` after a data change, regenerate and check the locale catalog after source text changes, then rebuild `.pages/`. The validation output records node and edge counts, asset inventory, provenance hashes, documentation links, and CI scope.

## Generated output

`.pages/` is the deployable artifact. Browser diagnostics are written under the ignored `artifacts/` directory and stay outside the Pages artifact.
