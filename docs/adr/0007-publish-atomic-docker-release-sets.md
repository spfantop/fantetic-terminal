# ADR 0007: Publish atomic Docker release sets

- Status: Accepted
- Date: 2026-08-12

## Context

The distributed Docker deployment used independent `latest` tags for frontend, backend, and Remote Gateway. Four matrix jobs also wrote release and `latest` tags independently. A partial build or retry could therefore expose images from different source revisions while Compose still looked healthy, and rollback could not reconstruct the selected image set.

## Decision

A Docker release set is a deep module whose interface prepares one version, assembles exactly four candidate digests, verifies the required platforms and immutable target tags, and promotes the set. The implementation owns the official namespace, image repositories, Dockerfiles, version rules, digest references, preflight ordering, and completed manifest schema. Desktop and Docker workflows share the release-version implementation but preserve their distinct tag interfaces.

Matrix jobs push candidates by digest without public tags. One publish job waits for all candidates, performs complete preflight before its first registry write, promotes identical immutable version tags, verifies each write, updates `latest` only for the standalone all-in-one image, and uploads a `complete` manifest with source revision and digests to the matching GitHub Release. Promotion is idempotent when an existing version tag has the same digest and rejects replacement when it differs.

Compose requires one `FANTETIC_VERSION` and uses it for frontend, backend, and Remote Gateway. It fails when the version is missing rather than falling back to a moving tag.

## Consequences

Docker Hub does not provide a transaction across repositories. A failed promotion can leave a strict subset of immutable tags, but that subset is not a completed Docker release set. Operators select only a version with a `complete` manifest; rerunning the same release safely fills missing tags. This gives deployment callers a small interface and concentrates version, image, ordering, and recovery knowledge in one implementation.

The all-in-one image retains `latest` as a convenience because it is one deployable artifact. Distributed images do not publish `latest`.

This decision applies to Docker releases produced after its adoption. Existing Docker tags remain legacy migration baselines and do not retroactively acquire a completed manifest.
