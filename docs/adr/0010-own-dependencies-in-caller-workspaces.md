# ADR 0010: Make caller workspaces authoritative for dependency ownership

## Status

Accepted

## Context

The root manifest repeated runtime packages already owned by frontend or backend workspaces. The frontend also declared the native `sqlite3` backend implementation, while backend type declarations were listed as runtime dependencies. Electron packaging compensated with an ignore list for selected `@types/*` packages.

These shallow declarations obscured the real owner of each dependency and made the manifest an unreliable interface for SBOM generation, production installation, and Electron runtime collection. Removing a duplicate declaration does not move implementation complexity to another caller, so the duplicates provide no module depth.

## Decision

- A package is declared by every workspace whose source or scripts directly call it.
- The root manifest owns only tools called by root scripts or root build tools.
- Type declarations are development dependencies of the workspace they type-check.
- Build tools may use different compatible versions in different workspaces; a root override must not force an incompatible version across workspace boundaries.
- Browser manifests do not declare server-native implementations.
- Electron runtime preparation derives its dependency graph directly from backend runtime dependencies in the root workspace lock file. It has no package-name ignore list.
- A repository behavior test protects these ownership rules and runs before the workspace test suite.

## Consequences

- Workspace manifests become the authoritative dependency interface for builds and packaging.
- Production installs and Electron runtime collection exclude build-only type declarations by construction.
- The root lock file can still hoist one physical package for multiple legitimate workspace owners; declaration cleanup alone does not guarantee a material install-time or runtime performance improvement.
- Adding a new root dependency requires a root caller, while packages used by multiple workspaces must be declared by each caller.
