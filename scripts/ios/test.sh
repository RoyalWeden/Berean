#!/bin/bash
# Run the BereanNative Swift package's XCTest suite on an iOS simulator.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/ios/App/BereanNative"
# By id: a name alone means "the latest OS", and that device may only exist on an older runtime.
ID="$(xcrun simctl list devices available | grep -m1 -E 'iPhone ' | grep -oE '[0-9A-F-]{36}')"
[ -n "$ID" ] || { echo "no iPhone simulator available" >&2; exit 1; }
xcodebuild test -scheme BereanNative -destination "platform=iOS Simulator,id=$ID" \
  -derivedDataPath "$ROOT/ios/App/DerivedDataTests" | "$ROOT/scripts/ios/xcpretty-lite.sh"
