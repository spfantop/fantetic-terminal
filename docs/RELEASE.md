# Release Guide

## Release Assets

The desktop release workflow publishes the following assets for each `v${version}` tag:

- Windows installer (`.exe`) and portable archive (`-portable.zip`)
- Linux AppImage and Debian package
- macOS disk images for supported architectures
- `SHA256SUMS.txt` for integrity verification

Verify a downloaded release asset with the matching entry in `SHA256SUMS.txt` before distribution.

## Code Signing

Desktop releases use code signing when the corresponding CI credentials are configured. If signing credentials are absent, the workflow still publishes unsigned artifacts and emits a warning in the build log.

Unsigned Windows and macOS applications can trigger operating-system security warnings. Do not treat an unsigned artifact as equivalent to a production-signed release.
