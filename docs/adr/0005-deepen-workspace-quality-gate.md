# ADR 0005: Deepen the workspace quality gate

- Status: Accepted
- Date: 2026-08-12

## Context

Behavior tests were transpiled independently with esbuild, so test source did not participate in strict TypeScript checking. The workspace runner also started every `test:*` script serially through a new npm process. A nested remote-gateway script caused one behavior to run twice, and a full local suite took about two minutes.

## Decision

Each TypeScript workspace exposes a `typecheck` script. Workspace-specific test configurations use the same strict compiler settings as production while matching the module format used by the test runtime. CI runs the root type-check interface before behavior tests.

The workspace test suite discovers each `test:*` script as one behavior group, adds Electron and delivery groups, and executes groups with bounded concurrency. The default limit is four and can be changed with `WORKSPACE_TEST_CONCURRENCY`. Results are reported in deterministic discovery order, all groups complete before failures are aggregated, and a discovered `test:*` script must not invoke another discovered `test:*` script.

## Consequences

Test fixtures and assertions can no longer drift outside the compiled contracts. The runner interface remains `npm test`; process orchestration, platform differences, concurrency, failure aggregation, and reporting stay inside one deep module.

Independent test processes must continue using isolated temporary storage and ephemeral network ports. Tests that introduce shared resources must either isolate those resources or be assigned to a future serial group interface.
