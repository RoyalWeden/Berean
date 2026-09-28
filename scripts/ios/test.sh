#!/bin/bash
# Run the BereanNative Swift package's XCTest suite on an iOS simulator.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/ios/App/BereanNative"
NAME="$(xcrun simctl list devices available | grep -m1 -oE 'iPhone [^(]+' | sed 's/ *$//')"
[ -n "$NAME" ] || { echo "no iPhone simulator available" >&2; exit 1; }
xcodebuild test -scheme BereanNative -destination "platform=iOS Simulator,name=$NAME" \
  -derivedDataPath "$ROOT/ios/App/DerivedData" | "$ROOT/scripts/ios/xcpretty-lite.sh"
