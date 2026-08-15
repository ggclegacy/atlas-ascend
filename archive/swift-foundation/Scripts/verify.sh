#!/usr/bin/env bash
#
# Command-line verification for the Atlas Ascend core modules.
#
# Builds and tests against the macOS SDK so the design system, map abstraction,
# and Command Center stay verifiable on a machine without a full Xcode install.
# This is NOT a substitute for building the iOS app — it cannot catch iOS-only
# issues, and it never runs on a simulator or device.
#
# ATLAS_CLI_BUILD excludes the `#Preview` blocks, whose macro plugin ships with
# Xcode rather than the Command Line Tools.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building (macOS, Swift 6 strict concurrency)"
swift build -Xswiftc -DATLAS_CLI_BUILD

echo "==> Testing"
swift test -Xswiftc -DATLAS_CLI_BUILD

echo "==> OK"
