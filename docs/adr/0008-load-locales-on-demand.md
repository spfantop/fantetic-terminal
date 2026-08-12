# ADR 0008: Load non-default locales on demand

- Status: Accepted
- Date: 2026-08-12

## Context

The frontend previously imported all three locale catalogs through both the i18n setup and a translation helper. This placed about 85 KiB of independently gzipped message data in the startup graph, while language selection, fallback, persistence, and `<html lang>` updates were split across callers. Making imports asynchronous also introduces stale-load and settings-persistence races that callers should not need to coordinate.

## Decision

The Locale runtime is a deep module with `initialize` and `setLocale` as its primary interface. The English default locale remains eagerly available as the fallback and offline baseline; Chinese and Japanese catalogs are named lazy chunks loaded before their locale becomes active. Initialization completes before application mount, reports a selected-locale load failure, and falls back to the default locale. Interactive switches are single-flight per locale and latest-wins, while failed loads remain retryable.

The browser adapter commits a successful switch to vue-i18n and `<html lang>`, then stores the local preference on a best-effort basis. Persisted settings changes cross a serialized coordinator seam: the target locale is proven loadable before the backend write, a failed write rolls the active locale back, and Pinia updates only after both operations succeed. Components use the reactive vue-i18n interface rather than importing message catalogs directly.

## Consequences

The initial asset graph excludes non-default locale chunks. Each lazy locale has its own gzip budget and a build guard that rejects missing, oversized, or initially preloaded locale chunks. Adding a locale requires updating the explicit catalog and loader map; this duplication is deliberate because it makes the supported and lazy-loaded set visible to type checking and bundle verification.
