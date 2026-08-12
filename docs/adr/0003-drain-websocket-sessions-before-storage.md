# ADR 0003: Drain WebSocket sessions before storage

- Status: Accepted
- Date: 2026-08-12

## Context

WebSocket handlers and cleanup used different `SftpService` instances, and server shutdown started asynchronous session cleanup without waiting for recordings, uploads, and connection resources before closing the database.

Marked SSH sessions also transfer a live channel and client to the suspended-session runtime during cleanup. Clearing the WebSocket state before this transfer completed meant an exception could leave neither runtime responsible for closing the detached resources.

## Decision

WebSocket handlers and cleanup share the runtime-owned SFTP adapter. The WebSocket runtime exposes an idempotent `drainSessions` operation that stops heartbeat and status polling, snapshots active sessions, and awaits every cleanup with aggregated failure reporting. Within one session, recording, polling, SFTP, Telnet, SSH, timers, and state detachment are each attempted even when an earlier step fails; errors are reported only after the session is detached.

SSH ownership transfer is resolved behind one interface. It detaches the channel and client, reports success only after the suspended-session runtime accepts them, revalidates the channel after asynchronous preparation, closes both resources when takeover is rejected or throws, and aggregates close failures without skipping the remaining resource. Callers never reconstruct this ordering.

Graceful shutdown terminates clients, awaits session drain, closes the WebSocket server even when cleanup fails, and only then advances to HTTP and storage phases.

## Consequences

Session recordings and transfer resources have a deterministic shutdown boundary. A failed session does not prevent cleanup attempts for other sessions or prevent the server close step; failures remain visible to the existing graceful-drain registry.

The WebSocket session and suspended-session runtime cannot both own the same live SSH resources. The ownership interface is the test surface for successful transfer, rejected transfer, takeover exceptions, and partial close failures.
