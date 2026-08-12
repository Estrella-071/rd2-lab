# Raw-to-canonical data pipeline

## Purpose

The public 1.0.3 snapshot is generated from the Unity client table snapshot. `site/data/dice_tree.json` is not a hand-maintained numeric source. Raw values, growth axes, units, and four-locale labels must be reproducible from the selected client tables.

The frozen evidence projection is `data/raw_snapshot_1.0.3.json`. It contains a redacted source identity digest, payload hashes when the unpack manifest is available, selected-table hashes, the raw table projection, and the canonical expectations used by CI. Absolute workstation paths are deliberately excluded.

## Reproduction sequence

From `website/`:

```text
npm run generate:canonical
npm run generate:locales
npm run check:raw
npm run validate
```

`generate:canonical` reads the configured local source snapshot by default. A different source must be supplied explicitly with `--source` or `RD2_SOURCE_ROOT`, and it must identify the expected client package and version `1.0.3`, 239 tree nodes, 248 raw edges, a complete source hash inventory, and complete selected table records. The public canonical tree has 246 effective edges after the two owner-confirmed reward-root corrections described below.

`generate:locales` uses the same default extraction table directory. Each generated special-stat mapping requires the raw `Local_*` key carried by the canonical stat; a generated DICE row without a stable key fails rather than falling back to an array position or a display label. Legacy fallback code is retained only for old non-generated fixtures.

Special unlock thresholds are deliberately split from the client tree when the client row is blank. `data/unlock_condition_supplements.json` records the four stable condition keys and values (Yin-Yang 700, Greed 2100, Void 300, Fear 900), the raw value observed in the client row, and whether the value is owner-confirmed or independently present in the client table. The same file records the eight owner-confirmed resource-free dice. The generator applies those policies to canonical output while retaining the original client costs and blank thresholds in the raw lineage; a hand edit to canonical JSON is therefore neither necessary nor accepted.

The 1.0.3 official notice source also identifies three tactics that no longer apply in co-op: Faction War, Rooftop, and Pacifist. The canonical event builder resolves those notice names through the raw four-locale localization table, disables only their co-op flags/timing/wave references, and keeps their versus records. The notice hash and the three resolved internal tactic IDs are stored in the raw lineage.

Greed (`5006`) and Void (`5008`) are reward-granted secondary initial dice. Their reward acquisition has priority over the client tree's prerequisite display, so the public effective topology removes only `5007→5006` and `5009→5008`. The raw projection keeps both edges, while `data/unlock_condition_supplements.json`, the lineage expectations, canonical edge list, node `incoming`/`next_nodes`, and the SVG are generated from the same correction policy. This is an effective unlock-order correction, not a claim that the raw client data contained different edges.

## Mapping policy

For each DICE node, the generator resolves the `DefenderTable` row, its referenced `ProjectileAbilityTable` row, and its `DefenderSkillTable` row. Normal published special stats must have a raw `Local_*` key and carry:

- `stat_id`: stable table/key/field identity;
- `label_key`: the source localization key used by all four locales;
- `unit`: derived from the client value type or field semantics;
- `raw_source`: the exact raw table, key, field, and three numeric axes;
- `add`: the corresponding `*_UpAdd` or `*_LvAdd` value, with zero represented as an empty addition.

The axis suffix is authoritative when a source field has only one upgrade axis. In particular, `DefenderTable.BossAttackPer_UpAdd` maps to `powerup_data.special_stats[].add`; it must not be copied to the dot/pip axis merely because the generated stat also has a `dot_data` representation.

Flower is an explicit semantic exception. Its `DefenderTable` row has no `DefenderSkillKind` link, and `DefenderSkillTable.Kind=Flower` leaves `Duration` blank while storing `Interval=60`. Because Bloom is a single attack window that ends rather than a repeating trigger, the generator publishes that raw field as the derived four-locale stat `stats.bloomDuration` (`綻放持續時間 60s`). The raw field remains `Interval` in lineage, so the semantic interpretation is auditable. `FlowerSeven.Interval=10` belongs to the 7-dot awakening event and is not promoted to a duration without an independent label or behavior mapping.

Raw numeric fields without a client localization key are retained in the lineage projection but are not presented as a guessed public stat. This prevents fields such as an unlabeled cast count or range from being assigned an unrelated label. If two source rows describe the same labeled value and all three axes are identical, the explicit relation is preferred and the duplicate is not shown twice.

Signed rune modifiers are kept signed in the raw-backed fields. The text formatter applies every non-zero rank delta, including negative deltas; for cooldown-reduction kinds it derives the positive magnitude expected by the four localized templates. This keeps the client formula auditable without displaying a negative number after the word "減少" or suppressing its level growth.

`RuneTable.Duration` is not treated as a universal presentation field. Its meaning is kind-specific: a source row can use it as an inline interval, multiplier, effect duration, or stack cap. The tooltip therefore does not manufacture a generic `Duration` row for `DICE_RUNE` nodes. Kind 53 (`ElementDefenderRotationSpeedIncrease`) is an explicit source-format correction: the raw signed values remain `Value1=3`, `Value2=-0.5`, and `Duration=5`, while `generate_locales.mjs` emits the four-locale conservative semantic wording "rotation interval shortened by 0.5 seconds; the effect lasts up to 5 seconds". The raw snapshot does not establish that `5` is a stack count, so the generated text does not claim five stacks. The generated catalog records all applied source-format patch keys at its root, and the generator fails if a declared patch key disappears from the raw localization table. The correction is generated from the stable rune kind and is covered by regression tests; it is not a hand-edited canonical value.

The client uses `DefenderTable.TargetingType=RangeFront` for the Predator dice and its three runes. Its source target label is corrected from `範圍前` to `範圍內`, with matching four-locale catalog text. The patch is applied during canonical and locale generation and is covered by raw-pipeline tests.

The current extraction identifies the Judge Dice as canonical node `4003`, with `DefenderSkillTable.Kind=Punch`, `Interval=10`, and `Interval_LvAdd=1`. Its localized source key and the `PunchMaxChargeTimePlusSec` rune both describe seconds, so the generated value remains `10s`. No `D102` identifier is present in this snapshot; an external D102 mapping needs separate evidence before it can change the published field.

The generator copies raw tree node fields and starts from the raw edge list, then applies only the declared effective topology corrections. The validator checks that `edges`, `incoming`, and `next_nodes` remain mutually symmetric, and that every corrected edge is absent from the effective output while remaining present in raw lineage. Costs, node identity, direct attack values, and attack intervals therefore cannot silently diverge from the selected `DiceTreeNodeTable` projection.

## Validation boundary

`npm run check:raw` first uses the local source snapshot when it exists. On machines that do not carry the source files, it checks the committed frozen projection instead. Both paths compare all 239 raw-backed nodes and all generated DICE special-stat arrays. The result is evidence of the 1.0.3 client snapshot, not proof of current server-side balance or live execution formulas.

Do not edit `site/data/dice_tree.json`, `site/data/locales.json`, or `data/raw_snapshot_1.0.3.json` to repair a value. Update the extraction input or parser, rerun the generators, inspect the raw lineage diff, and run the complete validation sequence.
