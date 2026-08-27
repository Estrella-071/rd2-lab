# Random Dice 2 Lab

Versioned data, compendium, and planning tools for Random Dice 2.

[Open the site](https://rd2-lab.pages.dev/) · [Report a data issue](https://github.com/Estrella-071/rd2-lab/issues/new?template=data_correction.md) · [Suggest an improvement](https://github.com/Estrella-071/rd2-lab/issues/new?template=feature_request.md) · [Contributing](CONTRIBUTING.md)

Random Dice 2 Lab is an independent community reference project. It has no commercial relationship, endorsement, or official authorization from 111 Percent Inc. Game names, artwork, text, and balance data remain subject to their respective rights holders. The MIT license covers the repository code and documentation.

## What is included

- Interactive five-faction tree with prerequisite paths, costs, search, filters, pan, zoom, and minimap navigation.
- Dice, monster, boss, and event compendium with searchable cards, sorting, mode filters, and Spine presentations.
- Planning mode for ranks, costs, faction levels, batch actions, revoke actions, and team setup.
- Shareable planning URLs and fixed-size PNG exports.
- Version badges, structured changelog entries, official notice records, and data provenance checks.
- A language selector beside the changelog widget with complete runtime catalogs for `zh-tw`, `en`, `ja`, and `ko`.
- Responsive layouts, keyboard navigation, reduced-motion support, and browser smoke coverage.

## Current data snapshot

The public data snapshot is version 1.0.3.

- 239 visible tree nodes and 248 directed edges.
- 41 dice, 123 tree runes, 70 player passives, and 5 support perks.
- 153 rune catalog records, including 30 supplemental records outside the visible tree.
- 15 monsters and 55 active events.

Canonical files live in [`site/data/`](site/data/):

- [`dice_tree.json`](site/data/dice_tree.json) and [`dice_tree.svg`](site/data/dice_tree.svg) define the tree.
- [`boss_event_data.json`](site/boss_event_data.json) defines compendium monsters and events.
- [`game_data_metadata.json`](site/data/game_data_metadata.json) defines the public version contract.
- [`changelog.json`](site/data/changelog.json) and [`official_update_notices.json`](site/data/official_update_notices.json) drive the update views.
- [`locales.json`](site/data/locales.json) contains the UI and runtime content catalog for all four supported locales.

The catalog covers 298 interface keys and 842 runtime content keys. Every key
used by the published tree, compendium, planning mode, share image, and update
views has a value in each locale. The source inventory records 28 incomplete
rows outside the runtime entity set for follow-up.

## Localization

Use the language widget to switch the interface without reloading the page.
Locale choice is stored in the browser and applies to tree labels, tooltips,
compendium cards, planning controls, share images, status messages, and
structured update entries. On a first visit without a stored choice, the site
uses the browser's preferred language list and maps it to the supported
catalogs; Chinese variants use `zh-tw`. The published `zh-tw` locale remains
the fallback when no supported browser language is available.

When updating source data or visible UI text, regenerate the catalog and run
the translation checks:

```bash
npm run generate:locales -- --source <source-table-dir>
npm run check:translations
```

`<source-table-dir>` is a maintainer-provided directory containing the locale
and entity source tables used to regenerate the catalog.

The checks require values in all four locales, matching placeholders and
format markers, complete runtime mappings, and the language widget placement.

## Local development

```bash
git clone https://github.com/Estrella-071/rd2-lab.git
cd rd2-lab
npm ci
npm run setup:browser
npm run verify
python -m http.server 3000 --bind 127.0.0.1 --directory .pages
```

The Cloudflare Pages build copies the allowlisted runtime into `.pages/`. The generated directory is a deployment artifact and is recreated by `npm run build:pages`.

For the Cloudflare Pages deployment, the share panel stores its compact payload
through the D1-backed Pages Functions under `/api/shares`. Use the local Pages
runtime when testing that path instead of the static Python server:

```bash
npm run d1:migrate:local
npm run pages:dev
```

The six-character share code, D1 binding, and payload limit are defined in
[`wrangler.jsonc`](wrangler.jsonc). Apply pending remote migrations with
`npm run d1:migrate:remote`.

`npm run package:monster-assets` creates `rd2-lab-monster-assets.zip` next to the repository with the public monster presentation files and a standalone viewer.

## Contributing

Data corrections should include the affected ID, version, observed value, proposed value, and a clear source. Runtime changes should include the relevant unit or browser command. Read [CONTRIBUTING.md](CONTRIBUTING.md), [DATA_MODEL.md](DATA_MODEL.md), [TESTING.md](TESTING.md), [PERFORMANCE.md](PERFORMANCE.md), and [NOTICE.md](NOTICE.md) before opening a pull request.

## Rights-holder contact

If you represent 111 Percent Inc. and would like a game-derived asset removed, email [itsestrella71@gmail.com](mailto:itsestrella71@gmail.com). The request will be reviewed promptly.

## License

Repository code and documentation are released under the [MIT License](LICENSE). Game-derived assets, names, text, and trademarks follow their own rights and usage boundaries described in [NOTICE.md](NOTICE.md).
