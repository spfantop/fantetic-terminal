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
