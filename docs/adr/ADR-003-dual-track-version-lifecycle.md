# ADR-003: Version lifecycle

## Status

Accepted

## Decision

Data updates follow two paths:

1. A content update changes values, text, records, or assets within the current JSON shape.
2. A schema update changes required fields or the shape of a public record.

Content updates run the data, provenance, asset, and browser checks. Schema updates increment `schema_version` and add a reversible step under `schema/migrations/` when an older published dataset must remain readable. The migration runner applies ordered `up()` functions to cloned JSON values and supports `down()` rollback.

## Consequences

Reviewers can identify a value change separately from a contract change. Data consumers receive an explicit schema version, and migration tests cover the supported transitions.
