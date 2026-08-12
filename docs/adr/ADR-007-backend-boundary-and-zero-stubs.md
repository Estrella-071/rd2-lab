# ADR-007: Static boundary and complete modules

## Status

Accepted

## Decision

The published application is a static client. Storage, HTTP, and viewport behavior enter the application through ports and concrete adapters. Every committed module has a working purpose, a defined owner, and a matching verification path.

Optional online features would receive a new application port and an isolated infrastructure adapter. The domain and existing views would keep their current contracts.

## Consequences

The Pages artifact remains self-contained and easy to inspect. Future services can be added without mixing network concerns into domain rules or view rendering. Each new module carries its own implementation and test surface.
