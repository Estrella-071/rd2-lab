# Random Dice 2 Lab site runtime

`site/` contains the runtime published by Cloudflare Pages. `npm run build:pages` copies the root `src/` modules and the files listed in [runtime-allowlist.json](runtime-allowlist.json) into `.pages/`.

## Runtime files

- `index.html`, the ordered `styles.css` / `styles-features.css` / `styles-overlays.css` cascade, and `src/` provide the application shell and views. `scripts/stylesheet_contract.mjs` is the shared load-order contract for source checks and Pages builds.
- `_headers` defines the static response policy, and `_routes.json` sends `/api/*` requests to Pages Functions.
- `data/dice_tree.json` and `data/dice_tree.svg` define the effective public tree; the raw 248-edge client projection and two owner-confirmed reward-root corrections remain in the repository lineage.
- `boss_event_data.json` and `monster_posters.json` define the compendium and its static monster illustrations.
- `data/game_data_metadata.json`, `data/changelog.json`, and `data/official_update_notices.json` define version display and update records.
- `data/locales.json` supplies the four-locale UI and runtime content catalog used by the language selector beside the changelog widget.
- `icons/` provides the public visual assets, including the monster poster PNGs.

The site reads JSON and SVG over HTTP. Planning shares store an opaque compact payload in D1, while the interface remains account-free. The published data files are versioned snapshots reviewed by the repository checks.

The application shell, source modules, styles, and canonical data are served with revalidation headers. The HTTP data adapter also requests canonical payloads with `cache: "no-store"`, so a new deployment is not hidden behind an older browser data cache. Long-lived immutable caching is reserved for reviewed visual assets.

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
