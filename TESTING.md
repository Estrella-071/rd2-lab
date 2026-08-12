# Testing

## Quick verification

```bash
npm ci
npm run audit:deps
npm run setup:browser
npm run verify
```

`npm run verify` runs the unit and data checks, builds `.pages/`, verifies staging, enforces the Chromium performance budget, and runs the Chromium smoke suite against the generated artifact.

## Check layers

| layer | command | coverage |
| --- | --- | --- |
| Unit and domain | `npm run test:unit` | domain rules, store, ports, use cases, views, share payloads, and migrations |
| Data and provenance | `npm run validate:data`, `npm run check:provenance` | tree topology, compendium shape, version metadata, hashes, and public paths |
| Assets and staging | `npm run check:assets`, `npm run check:staging` | PNG inventory, ESM graph, static poster files, allowlist, and runtime manifest |
| Documentation | `npm run check:docs` | required files and relative links |
| Localization | `npm run generate:locales -- --source <source-table-dir>`, `npm run check:translations` | four-locale values, runtime key mappings, placeholders, format markers, SVG text markers, and widget order |
| Browser smoke | `npm run test:e2e:smoke` | loading, tree interaction, compendium, planning mode, mobile layout, and lifecycle cleanup |
| Full browser suite | `npm run test:e2e` | all modular Chromium suites |
| Pages performance | `npm run check:performance` | artifact size, startup, long tasks, zoom, emulated mobile pan, and runtime budgets |

The performance command requires a current `.pages/` build. Its methodology,
thresholds, report format, and evidence boundary are documented in
[PERFORMANCE.md](PERFORMANCE.md).

The CI workflow uses the same `.pages/` artifact for static, browser, and
performance jobs. Chromium, Firefox, and WebKit run for pushes, pull requests,
scheduled checks, and manual runs. Pages deployment waits for all three browser
jobs.

## Translation coverage

`site/data/locales.json` is generated from the source catalog and records the
supported locales `zh-tw`, `en`, `ja`, and `ko`. The translation check requires
every UI key and every runtime entity key to have a non-empty value in all four
locales. It also compares positional placeholders and `<tag>`/`<color>` format
markers, verifies the localized SVG marker classes, and confirms that the
language widget follows the changelog widget in the document.

The current catalog contains 298 UI keys and 842 runtime source keys. The
source inventory retains 28 incomplete rows outside the runtime entity set;
the checker reports them so future content additions can be reviewed before
they enter the public runtime.

## Diagnostics

Browser failures write JSON, screenshots, and traces under the ignored `artifacts/` directory. Those files help local debugging and remain outside commits.

Screen-reader, physical-device, production-performance, and live deployment checks are separate release activities. Record their results with the release notes when they are run.
