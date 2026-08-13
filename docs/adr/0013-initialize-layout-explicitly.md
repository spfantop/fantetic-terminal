# ADR 0013: Initialize the authenticated layout projection explicitly before mount

- Status: Accepted
- Date: 2026-08-13

## Context

Constructing `layout.store` started layout, sidebar, and navigation-visibility requests immediately. Any transitive consumer therefore acquired network side effects, including terminal lifecycle tests that only imported Docker layout awareness. The main layout and sidebar requests also ran sequentially, while each loader committed its state independently. Ownership, ordering, and the point at which the projection became ready were implicit.

## Decision

The Layout runtime exposes one `initialize()` interface on `layout.store`. Store construction is side-effect free. The application composition root calls and awaits this interface only after authentication and before router mount. Concurrent initialization calls share one execution.

The implementation reads the layout tree, sidebar panes, and navigation visibility in parallel. Each read applies its existing remote, local-cache, and default fallback policy. The runtime commits all three values together after every read has settled, so mounted consumers observe one complete projection rather than partially initialized state.

## Consequences

Importing or constructing a layout consumer no longer performs remote work, and focused tests do not need unrelated HTTP adapters. Authenticated startup reduces the layout-read critical path from sequential layout and sidebar requests to three parallel reads. Removing this interface would force initialization ownership, request coalescing, fallback ordering, and commit timing back into the composition root and consumers.

The application still waits for layout settings before mounting authenticated routes. A slow settings service can therefore delay first render, while failures use cached or default values and complete initialization instead of blocking startup.
