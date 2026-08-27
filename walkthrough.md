# Random Dice 2 Lab walkthrough

This document describes the current public runtime and its verification path.

## User flow

1. The loader reads the canonical tree, compendium, metadata, and changelog files.
2. The tree view renders 239 nodes and 248 directed edges.
3. Search and filters narrow the visible nodes while pan, zoom, and minimap keep navigation responsive.
4. A tooltip shows costs, ranks, prerequisites, icons, and simulation actions.
5. The compendium opens dice, monsters, bosses, and events with search, sorting, and mode controls.
6. Planning mode tracks unlocks, rank costs, revoke actions, faction levels, and two five-slot teams.
7. The share panel creates a versioned URL and a fixed-size PNG planning card.
8. The changelog panel reads the same structured entries as the version badge.

## Verification map

| area | command | observable result |
| --- | --- | --- |
| Domain and store | `npm run test:unit` | rules, state, views, ports, and share payloads pass |
| Data | `npm run validate:data` | 239 nodes, 248 edges, valid node types, and acyclic topology |
| Provenance | `npm run check:provenance` | published hashes and metadata agree |
| Assets | `npm run check:assets` | allowlisted PNG inventory is current |
| Staging | `npm run check:staging` | ESM, data, Spine files, and manifest are aligned |
| Browser | `npm run test:e2e:smoke` | loading, navigation, compendium, planning, mobile, and teardown pass |

## Deployment artifact

`npm run build:pages` writes `.pages/` from the canonical source and the runtime allowlist. CI verifies that artifact, and a maintainer publishes it to Cloudflare Pages with the pinned Wrangler version. Browser diagnostic files stay under the ignored `artifacts/` directory.
