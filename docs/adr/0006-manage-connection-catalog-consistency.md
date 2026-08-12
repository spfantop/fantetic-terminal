# ADR 0006: Manage connection catalog consistency behind one interface

- Status: Accepted
- Date: 2026-08-12

## Context

Managed connection and folder reads were initiated by many frontend callers. Each read independently parsed cache data, issued an HTTP request, changed loading and error state, serialized the complete list, and replaced the Pinia projection. Overlapping reads duplicated work, while a response started before a user-scope change or mutation could arrive later and restore stale data.

## Decision

The managed connection catalog is a deep module with `refresh`, `revalidate`, `invalidate`, and `replace` as its interface. Its implementation owns user-scope single-flight, generation-based stale response rejection, cache-first projection, forced post-mutation reads, unchanged-snapshot suppression, and failure fallback.

The production adapter connects the seam to HTTP, local storage, and Pinia. An in-memory adapter exercises the same interface in behavior tests. HTTP and cached payloads cross a decoder seam from `unknown` into managed connection and folder types before they can replace the projection. Cache I/O is best effort: failures remain observable at the adapter boundary but never block an authoritative HTTP read or mutation.

Mutations invalidate their catalog generation before writing. A mutation with an authoritative response uses `replace`; other successful mutations use `revalidate` so they cannot reuse a read started during the mutation. External callers invalidate through the store interface and do not know cache keys.

## Consequences

Callers retain the existing `fetchConnections` and `fetchFolders` interface while receiving single-flight behavior. Scope, ordering, cache, and reconciliation rules gain locality in one implementation, and the interface provides leverage to every view and mutation caller.

The adapter still shares the store's existing error text strategy. Migrating all frontend errors to stable message keys remains a separate concern.
