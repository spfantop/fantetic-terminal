# ADR 0003: Drain WebSocket sessions before storage

- Status: Accepted
- Date: 2026-08-12

## Context

WebSocket handlers and cleanup used different `SftpService` instances, and server shutdown started asynchronous session cleanup without waiting for recordings, uploads, and connection resources before closing the database.

## Decision

WebSocket handlers and cleanup share the runtime-owned SFTP adapter. The WebSocket runtime exposes an idempotent `drainSessions` operation that stops heartbeat and status polling, snapshots active sessions, and awaits every cleanup with aggregated failure reporting.

Graceful shutdown terminates clients, awaits session drain, closes the WebSocket server even when cleanup fails, and only then advances to HTTP and storage phases.

## Consequences

Session recordings and transfer resources have a deterministic shutdown boundary. A failed session does not prevent cleanup attempts for other sessions or prevent the server close step; failures remain visible to the existing graceful-drain registry.
