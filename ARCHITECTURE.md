# Architecture

Random Dice 2 Lab uses a small layered runtime. Each layer has a clear owner and a single direction of dependency.

## Layers

```text
src/domain/  pure rules, data shaping, and icon resolution
src/app/     state, ports, and use cases
src/infra/   HTTP, storage, viewport, and image export adapters
src/ui/      tree, tooltip, compendium, controls, changelog, locale, and planning views
src/main.js  composition root and lifecycle
```

- Domain modules use plain JavaScript values and have no browser dependency.
- Application modules depend on domain modules and declared ports.
- Infrastructure modules implement ports and own external I/O.
- UI modules render state and call use cases through the application store.

The compendium keeps `compendium_view.js` as its lifecycle facade. Category and
sort controls, overlay and modal behavior, dice rendering, monster rendering,
event rendering, and shared slider/path utilities live in separate
`compendium_*` modules. The facade preserves the application-facing API while
keeping card markup and interaction details out of the lifecycle owner.

## Localization

`src/domain/localization.js` owns locale normalization, catalog lookup,
placeholder interpolation, and localized copies of tree, compendium, and event
records. It keeps canonical source fields alongside localized values so
classification, topology, and simulation rules continue to use stable data.

`src/ui/locale_view.js` applies catalog keys to document attributes and static
labels, manages the language selector, and notifies the application when the
locale changes. View renderers receive the same service for dynamic labels and
formatted game text. `site/data/locales.json` is the runtime catalog; the
generator and translation checker keep its four locale entries aligned.

The language selector uses the disclaimer surface styling and sits immediately
to the right of the changelog widget. `MorphingWidgets` owns the open, close,
focus, and outside-click behavior shared by all HUD widgets.

## Runtime data flow

`HttpDataRepository` reads the canonical JSON and SVG files from `site/data/` and `site/`. The application store distributes the loaded tree, compendium, metadata, and changelog to the views. `SimulationPlanUseCase` keeps planning state separate from browsing state and serializes share payloads through the versioned share module.

## Public data contract

- `site/data/dice_tree.json` and `site/data/dice_tree.svg` define the tree.
- `site/boss_event_data.json` and `site/monster_posters.json` define the compendium.
- `site/data/game_data_metadata.json` defines the current data version and schema versions.
- `site/data/changelog.json` and `site/data/official_update_notices.json` feed the update panel.
- `site/data/locales.json` supplies the four-locale UI and runtime content catalog.
- `site/runtime-allowlist.json` defines the files copied to Pages.

The JSON schemas, validation scripts, provenance hashes, and asset inventory form the data safety net. Staging validation recursively resolves every metadata key ending in `_path`, then requires the target to be both present in `.pages/` and declared by its runtime manifest.

## Build and deployment

`npm run build:pages` synchronizes `src/` into the site runtime, copies the allowlisted files into `.pages/`, and writes a runtime manifest. The CI workflow validates that artifact and enforces the documented [performance budget](PERFORMANCE.md) before deployment. `.pages/` is generated output and remains outside source review.
