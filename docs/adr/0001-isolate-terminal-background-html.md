# ADR 0001: Isolate terminal background HTML

- Status: Accepted
- Date: 2026-08-12

## Context

Terminal background themes may contain inline scripts for animation. Remote themes are untrusted, but they were previously inserted into the trusted Vue renderer and their scripts were explicitly re-executed. The backend also accepted arbitrary HTTP or HTTPS download targets.

## Decision

Render terminal background documents in an `iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`. Generate the complete `srcdoc` through one adapter that applies a deny-by-default CSP: inline scripts and styles are allowed for theme animation, while network, frames, workers, objects, forms, fonts, and media are denied.

Remote theme downloads accept only HTTPS `.html` files from `raw.githubusercontent.com`, reject credentials and custom ports, disable redirects, and enforce a 10 KiB response limit and timeout.

## Consequences

Inline theme animation remains available, but theme code cannot read the authenticated parent origin or call backend APIs. Remote themes cannot load external assets; assets must be embedded as allowed `data:` or `blob:` images. Supporting another remote source requires an explicit allowlist decision and regression tests.
