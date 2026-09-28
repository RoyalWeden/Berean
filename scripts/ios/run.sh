#!/bin/bash
# Boot an iPhone simulator, install the Debug build and launch Berean.
#   scripts/ios/run.sh [simulator name]   (default: the first available iPhone)
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${1:-}"
if [ -z "$NAME" ]; then
  NAME="$(xcrun simctl list devices available | grep -m1 -oE 'iPhone [^(]+' | sed 's/ *$//')"
fi
[ -n "$NAME" ] || { echo "no iPhone simulator available — run: xcodebuild -downloadPlatform iOS" >&2; exit 1; }
UDID="$(xcrun simctl list devices available | grep "$NAME (" | head -1 | grep -oE '[0-9A-F-]{36}')"
echo "[ios] using simulator: $NAME ($UDID)"
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID" || true
APP="$ROOT/ios/App/DerivedData/Build/Products/Debug-iphonesimulator/App.app"
[ -d "$APP" ] || "$ROOT/scripts/ios/build.sh" simulator
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch --console-pty "$UDID" "$BUNDLE_ID" || xcrun simctl launch "$UDID" "$BUNDLE_ID"
