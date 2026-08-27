# ADR-002: HTTP data and asset loading

## Status

Accepted

## Decision

The site loads canonical JSON, SVG, PNG, and Spine files through a static HTTP server. `HttpDataRepository` owns data requests and caching. `scripts/build_pages.mjs` selects the public files through `site/runtime-allowlist.json` and writes a manifest for staging checks.

The tree, compendium, and metadata stay as independent files so the browser can cache and validate them separately. The application store supplies data to the UI.

## Consequences

HTTP caching, staged validation, and asset-level provenance make the runtime easier to inspect and deploy. Local preview uses a static server, and the Pages workflow publishes the generated artifact.
