# Random Dice 2 Lab site runtime

`site/` contains the runtime published by Cloudflare Pages. `npm run build:pages` copies the root `src/` modules and the files listed in [runtime-allowlist.json](runtime-allowlist.json) into `.pages/`.

## Runtime files

- `index.html`, the ordered `styles.css` / `styles-features.css` / `styles-overlays.css` cascade, and `src/` provide the application shell and views. `scripts/stylesheet_contract.mjs` is the shared load-order contract for source checks and Pages builds.
- `_headers` defines the static response policy, and `_routes.json` sends `/api/*` requests to Pages Functions.
- `data/dice_tree.json` and `data/dice_tree.svg` define the tree.
- `boss_event_data.json` and `monster_visuals.json` define the compendium and Spine presentation.
- `data/game_data_metadata.json`, `data/changelog.json`, and `data/official_update_notices.json` define version display and update records.
- `data/locales.json` supplies the four-locale UI and runtime content catalog used by the language selector beside the changelog widget.
- `icons/` and the allowlisted Spine files provide the public visual assets.

The site reads JSON and SVG over HTTP. Planning shares store an opaque compact payload in D1, while the interface remains account-free. The published data files are versioned snapshots reviewed by the repository checks.

The language selector updates document labels, tree and compendium content,
planning controls, share images, and update entries from the same catalog. The
catalog is generated with `npm run generate:locales -- --source <source-table-dir>`
and checked with `npm run check:translations` before a Pages build.

## Local preview

```bash
npm ci
npm run setup:browser
npm run verify
npm run d1:migrate:local
npm run pages:dev
```

Open the local URL printed by Wrangler to view the generated artifact and exercise the share API. Browser diagnostics remain in the ignored `artifacts/` directory.

## Scope

The public site includes the tree, compendium, planning mode, changelog, and share tools. Rights and usage boundaries for game-derived material are documented in [NOTICE.md](../NOTICE.md).
