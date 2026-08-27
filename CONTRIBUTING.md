# Contributing

Random Dice 2 Lab welcomes focused fixes to the public data, runtime, and documentation.

## Useful contribution types

- Data corrections with a version, affected ID, observed value, proposed value, and source.
- UI changes with a clear user-visible result and a matching unit or browser check.
- Improvements to schemas, generators, validation, accessibility, and performance.
- Documentation updates that keep names, links, counts, and usage steps current.

## Verification by change type

| change | local checks |
| --- | --- |
| Documentation or templates | `npm run check:docs` |
| Data or generated files | `npm run validate` and `npm run build:pages` |
| Runtime, UI, scripts, or tests | `npm run verify` |
| Images or other public assets | `npm run audit:assets`, `npm run build:pages`, `npm run check:staging` |
| Dependencies | `npm run audit:deps` and `npm run verify` |

## Data corrections

Include the node, monster, event, or notice ID; the affected version; the current and proposed values; and the evidence used for the correction. A screenshot, official notice, reproducible calculation, or a clear in-game observation helps reviewers reproduce the change.

Canonical tree and compendium files live under `site/data/` and `site/`. Repository scripts produce the generated output.

## Localization

Visible interface text and published game content use the catalog in
`site/data/locales.json`. Add or revise the source entry in
`scripts/generate_locales.mjs`, keep the stable content mapping for each node,
event, monster, tag, or faction, then regenerate the catalog. Values for
`zh-tw`, `en`, `ja`, and `ko` must preserve positional placeholders and game
format markers such as `<tag>` and `<color>`.

Run the focused checks after a catalog or visible-text change:

```bash
npm run generate:locales -- --source <source-table-dir>
npm run check:translations
npm run test:unit
```

`<source-table-dir>` is a maintainer-provided directory containing the locale
and entity source tables for catalog generation.

The browser smoke suite covers language switching, document language updates,
localized placeholders, and the selector geometry beside the changelog widget.

## Pull requests

Use a focused branch and describe the visible behavior, affected files, validation commands, and any remaining review item. Keep credentials and temporary test material out of commits.

The MIT license covers repository code and documentation. Game-derived names, text, art, and trademarks follow the boundaries in [NOTICE.md](NOTICE.md).
