#!/usr/bin/env bash
# Native Swift apps (docs/native-migration). Output always lands in build/apple/ inside this
# checkout (ADR-0004) — never ~/Library/Developer/Xcode/DerivedData or a home-folder build dir.
#   scripts/native/build.sh test      swift test for Packages/BereanKit (golden conformance)
#   scripts/native/build.sh mac       BereanMac (Debug, com.berean.native.mac.dev)
#   scripts/native/build.sh ios       BereanIOS for the iOS Simulator (Debug, com.berean.native.ios.dev)
#   scripts/native/build.sh ios-test  BereanKit golden suites on an iOS Simulator
#   scripts/native/build.sh all       test + mac + ios builds
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DD="$ROOT/build/apple/DerivedData"
PROJECT="$ROOT/apple/Berean.xcodeproj"

# Release mode: the golden suites walk every verse of several texts (≈30 s optimised vs minutes in debug).
run_test() { swift test -c release --package-path "$ROOT/Packages/BereanKit" --scratch-path "$ROOT/build/apple/swiftpm"; }
# BereanKit golden suites on an iOS Simulator (the platform SQLite there differs from macOS — B-15).
run_ios_test() {
  local udid
  udid=$(xcrun simctl list devices available -j | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(x['udid'] for k,v in sorted(d.items(), reverse=True) if 'iOS' in k for x in v if x['name'].startswith('iPhone')))")
  (cd "$ROOT/Packages/BereanKit" && xcodebuild test -quiet -scheme BereanKit-Package -configuration Release \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$ROOT/build/apple/DerivedData-ios-tests")
}
run_mac() {
  xcodebuild -project "$PROJECT" -scheme BereanMac -configuration Debug -destination 'platform=macOS' \
    -derivedDataPath "$DD" build
  verify_identity "$DD/Build/Products/Debug/BereanMac.app/Contents/Info.plist" com.berean.native.mac.dev
}
run_ios() {
  xcodebuild -project "$PROJECT" -scheme BereanIOS -configuration Debug -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DD" build
  verify_identity "$DD/Build/Products/Debug-iphonesimulator/BereanIOS.app/Info.plist" com.berean.native.ios.dev
}
# Development builds must never carry a production (or Capacitor Dev) identity.
verify_identity() {
  local id; id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$1")
  if [[ "$id" != "$2" ]]; then echo "NATIVE IDENTITY CHECK FAILED: $id (expected $2)" >&2; exit 1; fi
  echo "Native identity OK — $id"
}

case "${1:-all}" in
  test) run_test ;;
  ios-test) run_ios_test ;;
  mac) run_mac ;;
  ios) run_ios ;;
  all) run_test; run_mac; run_ios ;;
  *) echo "usage: $0 test|mac|ios|all" >&2; exit 2 ;;
esac
