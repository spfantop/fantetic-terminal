# Release Guide

## Release Assets

The desktop release workflow publishes the following assets for each `v${version}` tag:

- Windows installer (`.exe`) and portable archive (`-portable.zip`)
- Linux AppImage and Debian package
- macOS disk images for supported architectures
- `SHA256SUMS.txt` for integrity verification

Verify a downloaded release asset with the matching entry in `SHA256SUMS.txt` before distribution.

## Desktop Compatibility

Desktop packages use Electron 44. Building them requires Node.js 22.12 or later. The packaged macOS application requires macOS 13 or later; Windows and Linux desktop packages are published only for 64-bit architectures.

## Docker Release Asset

For Docker versions produced by the atomic publication workflow, the same GitHub Release also contains `fantetic-terminal-docker-release-${version}.json`. A manifest with `status: complete` records the source revision, immutable image digests, and required platforms for the distributed release set.

## Code Signing

Desktop releases use code signing when the corresponding CI credentials are configured. If signing credentials are absent, the workflow still publishes unsigned artifacts and emits a warning in the build log.

Unsigned Windows and macOS applications can trigger operating-system security warnings. Do not treat an unsigned artifact as equivalent to a production-signed release.

## Quality and Security Check Failures

`Quality checks` runs dependency auditing independently from the `verify` job. A new vulnerability advisory can make an unchanged lockfile fail `audit`; strict type checks, behavior tests, and runtime builds still run to completion. HIGH/CRITICAL findings remain blocking for the audit job. Registry failures, invalid reports, and scanner execution failures also remain failures.

Root and Electron lockfiles are both audited, including development dependencies. Download the `npm-audit-<revision>` artifact and read the job summary to identify affected packages. The security workflow retains secret scanning, CodeQL, image builds, and the all-in-one startup/restart/shutdown smoke test. Trivy still fails on HIGH/CRITICAL findings with available fixes and uploads `trivy-<image>-<revision>` JSON reports even when findings fail the scan. A clean report is not a guarantee that a release has no vulnerabilities.

The desktop and Docker tag workflows do not depend on the quality or security workflows: their `needs` dependencies refer only to jobs within their own publishing workflow. A red audit is not itself a packaging failure. Branch protection may require these checks before merging; repository protection configuration is separate and is not changed here. Inspect the failed job before retrying a release or changing policy. Do not remove security checks to conceal an unresolved advisory.

At the time of the 2.1.11 preparation, a local audit reported 15 HIGH/CRITICAL findings in the root lockfile and 4 in Electron. These are audit report counts, not necessarily unique advisories, and will change with the registry database. This CI change does not fix those dependencies. Dependency remediation must be reviewed and tested separately; release consumers should assess the published reports before deployment.
