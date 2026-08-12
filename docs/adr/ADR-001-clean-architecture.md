# ADR-001: Layered architecture

## Status

Accepted

## Decision

Random Dice 2 Lab uses four layers and a composition root:

```text
UI -> Application -> Domain
Infrastructure implements Application ports
Composition root wires the graph
```

- `src/domain/` contains deterministic rules, topology, text shaping, and asset-key mapping.
- `src/app/` contains the store, ports, and use cases.
- `src/infra/` contains HTTP, storage, viewport, and image adapters.
- `src/ui/` contains views that render store state and invoke use cases.
- `src/main.js` creates adapters, the store, use cases, and views.

Domain code uses plain values. Application code depends on domain modules and ports. Infrastructure code owns external APIs. Shared helpers live in a neutral layer and keep adapters independent of views.

## Consequences

Pure rules can run in the Node test runner. Adapters can be replaced with test implementations. View changes stay close to the affected feature. The composition root remains the place for lifecycle ownership and dependency wiring.
