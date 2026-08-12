# ADR-004: Unidirectional store state

## Status

Accepted

## Decision

`src/app/store/app_store.js` is the state authority. A user or lifecycle event calls a use case; the use case dispatches an action; the reducer creates the next snapshot; subscribed views render the result.

The store owns tree data, selection, prerequisite paths, filters, viewport state, compendium state, changelog metadata, and planning state. Planning state remains a separate branch so browsing and simulation can change independently.

Views subscribe to state and call use cases. Reusable services and domain helpers carry shared view behavior.

## Consequences

State transitions are explicit and testable. A view can be re-created without losing the canonical data contract. The store adds a small amount of wiring to local interactions and makes that wiring visible to tests.
