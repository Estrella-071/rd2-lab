# ADR-005: Single Spine WebGL context

## Status

Accepted

## Decision

`SpineWebglEngine` manages one active WebGL context. Before a new monster animation starts, the current canvas, renderer, asset manager, textures, and animation loop are disposed. Application teardown calls the same disposal path.

Static poster images provide the display fallback when WebGL is unavailable. The adapter records context creation and release so unit and browser checks can verify the cap.

## Consequences

GPU usage stays bounded and modal navigation has a deterministic cleanup path. One animated model is active at a time, while the rest of the compendium remains available through static data and poster assets.
