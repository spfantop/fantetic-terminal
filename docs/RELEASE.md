# Release Guide

## Release Assets

The desktop release workflow publishes the following assets for each `v${version}` tag:

- Windows installer (`.exe`) and portable archive (`-portable.zip`)
- Linux AppImage and Debian package
- macOS disk images for supported architectures
- `SHA256SUMS.txt` for integrity verification

Verify a downloaded release asset with the matching entry in `SHA256SUMS.txt` before distribution.
