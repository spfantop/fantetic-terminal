# ADR 0011: Defer optional connection forms behind one loading boundary

## Status

Accepted

## Context

The authenticated connections route eagerly imported the single and batch connection editors even though neither form is visible until the user asks to add, edit, or batch-edit connections. The single editor was also imported independently by workspace and dashboard views. This made three page implementations own the same loading boundary and added optional form code to the main connections chunk.

Other large frontend chunks do not have the same shape. Monaco and the complete icon catalog already sit behind meaningful lazy boundaries, while the session store is required by the primary authenticated workflow and owns lifecycle ordering. Splitting those modules only because of their output size would move implementation complexity into callers without proving a user-facing improvement.

## Decision

- A `LazyConnectionForm` module is the page-facing interface for both single and batch connection editors.
- The module owns the two dynamic import adapters, loading and failure states, retry, dismissal, focus, and stale completion after unmount.
- Connections, workspace, and dashboard views only compose form props and business events; they do not import either form implementation directly.
- The build budget requires both named JavaScript chunks, rejects either chunk in the initial asset graph, and limits their combined gzip size to 24 KiB.
- Chunking decisions remain workflow-driven. Existing Monaco, icon-catalog, and session boundaries are unchanged until runtime measurements identify a concrete problem.

## Consequences

- In the production build measured when this decision was accepted, the `ConnectionsView` JavaScript chunk decreased from 142,350 B to 112,400 B gzip, a reduction of 29,950 B (21.0%).
- The deferred `AddConnectionForm` and `BatchEditConnectionForm` chunks total 18,337 B gzip. Opening a form for the first time adds one network request and therefore exposes an explicit loading/error/retry surface.
- The shared loading module has two real implementation adapters and three callers. Removing it would redistribute loading, retry, focus, and stale-result rules into those callers, so the module provides depth rather than a pass-through abstraction.
