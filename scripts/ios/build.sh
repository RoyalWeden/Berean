#!/bin/bash
# Build the iOS app from the command line.
#   scripts/ios/build.sh simulator   — Debug build for the iOS Simulator ("Sign to Run Locally": no
#                                      team needed, but the entitlements — App Group, iCloud — are
#                                      embedded so the Share Extension inbox works in the simulator)
#   scripts/ios/build.sh device      — Debug build for a physical iPhone (needs Signing.xcconfig)
#   scripts/ios/build.sh archive     — Release archive (needs Signing.xcconfig); upload via Xcode Organizer
# Always sets DEVELOPER_DIR so it works even when xcode-select points at the CommandLineTools.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/ios/App"
MODE="${1:-simulator}"
case "$MODE" in
  simulator)
    xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData \
      build | "$ROOT/scripts/ios/xcpretty-lite.sh" ;;
  device)
    xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
      -destination 'generic/platform=iOS' -derivedDataPath DerivedData \
      -allowProvisioningUpdates build | "$ROOT/scripts/ios/xcpretty-lite.sh" ;;
  archive)
    xcodebuild -project App.xcodeproj -scheme App -configuration Release \
      -destination 'generic/platform=iOS' -archivePath "build/Berean.xcarchive" \
      -allowProvisioningUpdates archive | "$ROOT/scripts/ios/xcpretty-lite.sh" ;;
  *) echo "usage: $0 simulator|device|archive" >&2; exit 2 ;;
esac
