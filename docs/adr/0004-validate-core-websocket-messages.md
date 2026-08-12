# ADR 0004: Validate core WebSocket messages at runtime boundaries

- Status: Accepted
- Date: 2026-08-12

## Context

The frontend and backend previously described WebSocket messages with open-ended `any` payloads. Both runtimes parsed and constructed protocol messages in stateful connection handlers, so malformed payloads and cross-runtime drift reached session code without a stable validation boundary.

The protocol has many existing message types. Replacing every message in one migration would create a broad compatibility risk and would make the contract package mirror internal implementation details.

## Decision

Stable cross-runtime messages are migrated as vertical slices. The contracts package owns their discriminated TypeScript interfaces. Runtime adapters own encoding and validation: the backend constructs typed server messages, and the frontend converts untrusted frames from `unknown` into validated message variants before dispatch.

The first core slice covers terminal connection acknowledgement, application latency probes, and SSH output frames. Known core messages with invalid payloads fail at the adapter boundary. Existing unmodelled messages remain on an explicit legacy path during migration; new protocol work must not extend that path without documenting the compatibility reason.

Binary SSH output retains its four-byte `SSHO` frame header, while clients without binary capability continue to receive the existing base64 JSON representation.

## Consequences

Stateful handlers receive validated core payloads, and compile-time drift is detected across the frontend, backend, and contracts workspaces. Protocol validation and encoding have focused behavior tests that exercise both runtime adapters.

The legacy message path still carries weaker types. Subsequent migrations should prioritise security-sensitive commands and high-volume paths, and should keep internal persistence or UI models out of the shared contract surface.
