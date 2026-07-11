# ADR-0001: Multi-user and multi-group access control

- Status: Accepted
- Date: 2026-07-11

## Context

The Web runtime supports authenticated users, but historical resources were global. Adding a second user would expose connections, credentials, settings, and history across users. The product must support bastion-style delegation where users can belong to several groups and connections can be assigned to several groups.

## Decision

Use three independent authorization dimensions:

1. Instance-wide system roles (`super_admin`, `admin`, `user`, `auditor`).
2. Per-group membership roles (`owner`, `admin`, `operator`, `viewer`).
3. Per-connection group grants (`view`, `connect`, `manage`).

Private resources record an `owner_user_id`. Access is denied by default. A caller is allowed only through ownership, an explicit group grant with sufficient authority, or an explicit system-role override.

The Desktop runtime remains a loopback-only local account adapter. It does not create a Web user and does not participate in Web group membership.

## Migration

The oldest existing user becomes `super_admin`. Existing private resources are assigned to that user. New resources must always be created with the authenticated owner. Multi-user endpoints must never perform an unscoped resource query.

## Consequences

- Repository interfaces must accept an authorization subject or owner identifier.
- Connection listing and lookup require group-aware queries.
- Group administration and user administration require new routes and UI.
- Cross-user and cross-group isolation require integration and E2E tests.
- Global instance settings remain system-admin controlled; user preferences will be separated from instance settings in a later migration.
