# ADR 0002: Prove Electron backend readiness

- Status: Accepted
- Date: 2026-08-12

## Context

The packaged desktop runtime uses fixed loopback ports and injects a runtime nonce into backend HTTP and WebSocket requests. Treating any `200` through `499` response as ready could accept an unrelated process already listening on the backend port.

## Decision

The Electron supervisor sends a random readiness challenge. A healthy backend signs it with HMAC-SHA256 using the runtime nonce and returns the proof only after database, disk, and backup-directory checks pass. The supervisor requires status `200`, a ready response body, a matching constant-time proof, and a still-live spawned child before it starts the frontend server.

Development and packaged runtimes share the same readiness implementation.

## Consequences

A process that merely owns the fixed port cannot impersonate the spawned backend or receive renderer nonce traffic. The readiness endpoint remains compatible with Web deployments because the proof header is absent when no Electron nonce or valid challenge exists.
