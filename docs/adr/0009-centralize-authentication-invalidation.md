# ADR 0009: Centralize authentication invalidation behind one runtime interface

- Status: Accepted
- Date: 2026-08-12

## Context

The HTTP client imported both the auth store and router, while the auth store imported the HTTP client and router and the router imported the auth store. These runtime edges formed two direct cycles and connected the route graph and 34 HTTP callers into a 70-module strongly connected module set. Session expiry policy was also split across HTTP 401 handling, logout, password changes, Pinia projection cleanup, user-scoped cache cleanup, and navigation.

## Decision

The Authentication runtime is a deep module with `expireSession(reason)` as its interface. The reason distinguishes conditional `unauthorized` invalidation from explicit `logout` and `password-changed` invalidation. Its implementation owns Desktop no-op behavior, unauthenticated Web no-op behavior, single-flight invalidation, local projection cleanup, login navigation, and failure reporting. Cleanup and navigation failures are reported independently so one cannot prevent the other from completing.

The composition root installs the production Pinia/router adapter before bootstrap requests begin and disposes it during Vite hot replacement. The HTTP client depends only on the Authentication runtime, treats invalidation as a best-effort side effect, and always rethrows the original HTTP error. The auth store keeps its downward HTTP dependency but no longer imports the router. An import graph guard transforms TypeScript and Vue scripts to emitted JavaScript before parsing static and dynamic imports. It rejects any runtime cycle containing authentication modules or any frontend strongly connected module set larger than the current two-module baseline.

## Consequences

Session invalidation policy gains locality in one implementation and its interface provides leverage to 401, logout, and password-change callers. The largest frontend runtime cycle falls from 70 modules to 2 without changing the 34 HTTP caller interfaces. The remaining `sessionActions` and `sshSuspendActions` cycle is a separate deepening candidate; the graph guard prevents it from growing while allowing incremental removal.
