# ADR-006: Layered verification

## Status

Accepted

## Decision

The repository uses checks that match the change surface:

- Unit tests cover domain rules, the store, ports, use cases, views, migrations, and share payloads.
- Data checks cover schemas, node and edge counts, topology, metadata, provenance, and assets.
- Staging checks cover the ESM graph, public files, Spine references, and the runtime manifest.
- Chromium smoke and modular suites cover loading, tree interaction, compendium, planning, mobile layout, and teardown.
- Firefox and WebKit run for pushes, pull requests, scheduled checks, and manual runs.
- Pages deployment waits for the Chromium, Firefox, and WebKit jobs.

`npm run verify` runs the static chain, builds `.pages/`, checks staging, and runs the browser suite against that artifact. `scripts/ci_scope.mjs` selects the smallest complete CI path for documentation, data, and runtime changes.

## Consequences

Small documentation changes receive fast link checks. Runtime changes receive artifact and browser evidence. Device, screen-reader, performance, and production checks remain explicit release activities.
