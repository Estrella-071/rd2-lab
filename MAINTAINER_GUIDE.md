# Maintainer guide

This guide records the repository boundaries for maintainers. Read it together with [CONTRIBUTING.md](CONTRIBUTING.md) before changing source, data, or deployment files.

## Layer boundaries

```text
src/domain/  pure domain rules and data shaping
src/app/     store, ports, and use cases
src/infra/   external adapters and asset services
src/ui/      browser views
src/main.js  composition root
```

- Domain modules use plain values and remain independent of browser APIs.
- Application modules depend on domain modules and declared ports.
- Infrastructure modules implement the ports and own I/O, storage, WebGL, and image export.
- UI modules render store state and call use cases.
- Shared asset resolvers live outside view modules, keeping infrastructure independent of UI views.

## Runtime rules

- The Spine pool has one active WebGL context. Every view switch and application teardown releases it through `dispose()`.
- `site/data/dice_tree.json` and `site/data/dice_tree.svg` are the tree source of truth.
- `site/data/locales.json` is the source for all visible UI and runtime content translations.
- `site/runtime-allowlist.json` defines the public Cloudflare Pages surface.
- Refresh `.pages/` with `npm run build:pages`.
- Share payload version `r/1` uses stable node IDs. D1 returns the stored six-character code when the same payload is shared again.

## Data lifecycle

Content updates change the canonical JSON files and pass `npm run validate`. A required schema shape change increments `schema_version`. Add a reversible migration under `schema/migrations/` when an older published dataset must remain readable.

## Locale catalog maintenance

Regenerate `site/data/locales.json` with `npm run generate:locales -- --source <source-table-dir>` after source
text or content mappings change. The generator records the complete source
inventory and the runtime key set. Review the inventory summary, then run
`npm run check:translations` to verify four-locale values, placeholder and
format-marker parity, content mappings, SVG text markers, and widget order.

Keep canonical source fields on localized entities for topology and simulation
logic. UI renderers should resolve visible text through `LocalizationService`;
new static labels use `data-i18n`, `data-i18n-attr`, or
`data-i18n-placeholder` in `site/index.html`.

The language selector uses the disclaimer widget surface and remains directly
to the right of the changelog widget. Changes to its markup or spacing belong
in the localization checker and browser smoke coverage.

## Verification

```bash
npm run test:unit
npm run validate:data
npm run check:provenance
npm run check:assets
npm run check:staging
npm run check:docs
npm run check:translations
npm run test:e2e:smoke
```

Record the commands and observed results in the pull request. Keep generated staging output and local diagnostics out of commits.

## Architecture decisions

- [ADR-001: Layer boundaries](docs/adr/ADR-001-clean-architecture.md)
- [ADR-002: HTTP asset loading](docs/adr/ADR-002-http-asset-loading-and-base64-removal.md)
- [ADR-003: Version lifecycle](docs/adr/ADR-003-dual-track-version-lifecycle.md)
- [ADR-004: Store state](docs/adr/ADR-004-unidirectional-store-state-management.md)
- [ADR-005: Spine lifecycle](docs/adr/ADR-005-webgl-context-pool-and-lifecycle.md)
- [ADR-006: Test safety nets](docs/adr/ADR-006-tiered-test-safety-nets.md)
- [ADR-007: Adapter boundaries](docs/adr/ADR-007-backend-boundary-and-zero-stubs.md)
