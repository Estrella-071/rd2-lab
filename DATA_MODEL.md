# Data model

## Current snapshot

The public data contract is version 1.0.3. [`site/data/game_data_metadata.json`](site/data/game_data_metadata.json) is the single metadata authority used by the site badge, compendium, and changelog.

| snapshot | tree nodes | directed edges | status |
| --- | ---: | ---: | --- |
| 1.0.0 | 239 | 248 | historical reference |
| 1.0.2 | 239 | 248 | historical reference |
| 1.0.3 | 239 | 248 | current public snapshot |

The current tree contains 41 dice, 123 tree runes, 70 player passives, and 5 support perks. The rune catalog contains 153 records, including 30 supplemental records outside the visible tree. The compendium contains 15 monsters and 55 active events.

## Tree contract

Each `nodes[]` entry contains:

- `id`, `branch`, and `node_type`;
- `incoming` and `next_nodes` directed-edge lists;
- icon path, display text, unlock costs, ranks, and node-specific values.

The public tree schema is [`schema/dice-tree.schema.json`](schema/dice-tree.schema.json). `scripts/validate_data.mjs` checks node identity, edge counts, node types, icon paths, and acyclic topology.

## Compendium contract

`site/boss_event_data.json` contains the active event set and monster records. A future removal is represented by an optional `historical_events[]` entry with its last visible version. Active filters use `events[]`; historical entries remain available for stable links.

`site/monster_visuals.json` maps the public monster records to the Spine presentation assets. Its snapshot identifier must match the canonical metadata.

## Changelog contract

`site/data/changelog.json` is generated from structured version entries and official notice records. Each entry includes a version, date when available, topology summary, categorized changes, and stable IDs. The public renderer reads this structure and supplies the user-facing summary.

## Localization contract

`site/data/locales.json` carries the UI catalog and stable source keys for tree,
compendium, planning, sharing, and update text. It declares the locale order
`zh-tw`, `en`, `ja`, `ko`, with `zh-tw` as the published default. Runtime
content mappings connect each stable entity ID to its source keys; localized
copies retain canonical fields for topology and rule calculations.

Node mappings use `unlockCondition` for the translated requirement label and
may include `unlockConditionValue` for a fixed external requirement. Ordinary
graph prerequisites use `unlock.prerequisite`; level gates and event-specific
requirements use dedicated locale keys so their labels and values stay visible
in every supported language.

Every runtime key has a value in all four locales. Placeholders and game text
markers keep the same shape across translations. Run
`npm run generate:locales -- --source <source-table-dir>` after source changes and
`npm run check:translations` before building the Pages artifact.

## Schema changes

Content updates use the existing JSON shape. A required-field or shape change increments `schema_version`. Add a reversible migration under `schema/migrations/` when an older published dataset must remain readable. A content-only update keeps the current schema version.
