# Architecture Decision Records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-isolate-terminal-background-html.md) | Accepted | Isolate terminal background HTML in an opaque-origin sandbox |
| [0002](0002-prove-electron-backend-readiness.md) | Accepted | Prove packaged backend identity before serving the desktop renderer |
| [0003](0003-drain-websocket-sessions-before-storage.md) | Accepted | Drain WebSocket sessions before closing storage |
| [0004](0004-validate-core-websocket-messages.md) | Accepted | Validate core WebSocket messages at runtime boundaries |
| [0005](0005-deepen-workspace-quality-gate.md) | Accepted | Type-check tests and run behavior groups with bounded concurrency |
| [0006](0006-manage-connection-catalog-consistency.md) | Accepted | Centralize connection catalog consistency behind one interface |
| [0007](0007-publish-atomic-docker-release-sets.md) | Accepted | Publish distributed Docker images as one immutable release set |
| [0008](0008-load-locales-on-demand.md) | Accepted | Load non-default locales on demand behind one runtime interface |
| [0009](0009-centralize-authentication-invalidation.md) | Accepted | Centralize authentication invalidation behind one runtime interface |
| [0010](0010-own-dependencies-in-caller-workspaces.md) | Accepted | Make caller workspaces authoritative for dependency ownership |
| [0011](0011-defer-optional-connection-forms.md) | Accepted | Defer optional connection forms behind one loading boundary |
