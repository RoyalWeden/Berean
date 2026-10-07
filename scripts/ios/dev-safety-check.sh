#!/bin/sh
# Berean Dev safety check (TEST 2026-10-01): a DEBUG build — Xcode ▶ Run on a physical iPhone or a
# simulator, `npm run ios:build`, `ios:device` — must be Berean Dev (com.berean.app.dev), so it
# installs next to the App Store / TestFlight "Berean" (com.berean.app) and never replaces it.
#
#   As an Xcode build phase ("Berean Dev safety check", added by scripts/ios/patch-xcodeproj.mjs):
#     reads the build settings from the environment; RELEASE builds (archives) pass through —
#     scripts/ios/verify-identity.mjs checks those after archiving.
#   From a shell (`npm run ios:check:dev`, `ios:open:dev`):
#     bash scripts/ios/dev-safety-check.sh --xcodebuild   (asks xcodebuild for the Debug settings)
#
# Expected values come ONLY from config/app-identity.json (read with plutil — no node on Xcode's PATH).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/config/app-identity.json"
dev() { /usr/bin/plutil -extract "identities.development.$1" raw -o - "$CONFIG"; }

if [ "${1:-}" = "--xcodebuild" ]; then
  export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
  SETTINGS="$(cd "$ROOT/ios/App" && xcodebuild -project App.xcodeproj -target App -configuration Debug -showBuildSettings 2>/dev/null)"
  get() { printf '%s\n' "$SETTINGS" | sed -n "s/^ *$1 = //p" | head -1; }
  CONFIGURATION=Debug
  PRODUCT_BUNDLE_IDENTIFIER="$(get PRODUCT_BUNDLE_IDENTIFIER)"
  BEREAN_IDENTITY="$(get BEREAN_IDENTITY)"
  BEREAN_BUNDLE_ID="$(get BEREAN_BUNDLE_ID)"
  BEREAN_DISPLAY_NAME="$(get BEREAN_DISPLAY_NAME)"
  BEREAN_ICLOUD_CONTAINER="$(get BEREAN_ICLOUD_CONTAINER)"
  BEREAN_APP_GROUP="$(get BEREAN_APP_GROUP)"
  BEREAN_URL_SCHEME="$(get BEREAN_URL_SCHEME)"
fi

if [ "${CONFIGURATION:-}" != "Debug" ]; then
  exit 0   # Release / archive: verified after the build by verify-identity.mjs
fi

EXP_BUNDLE="$(dev bundleId)"
fail=""
check() { # label expected actual
  if [ "$2" != "$3" ]; then fail="${fail}
  $1 — expected: $2 · actual: ${3:-<unset>}"; fi
}
check "Bundle ID (PRODUCT_BUNDLE_IDENTIFIER)" "$EXP_BUNDLE" "${PRODUCT_BUNDLE_IDENTIFIER:-}"
check "Identity (BEREAN_IDENTITY)" "development" "${BEREAN_IDENTITY:-}"
check "Share Extension bundle ID" "$EXP_BUNDLE.share" "${BEREAN_BUNDLE_ID:-}.share"
check "Display name" "$(dev appName)" "${BEREAN_DISPLAY_NAME:-}"
check "iCloud container" "$(dev cloudContainer)" "${BEREAN_ICLOUD_CONTAINER:-}"
check "App Group" "$(dev appGroup)" "${BEREAN_APP_GROUP:-}"
check "URL scheme" "$(dev urlScheme)" "${BEREAN_URL_SCHEME:-}"

if [ -n "$fail" ]; then
  echo "error: IOS DEV BUILD SAFETY CHECK FAILED: This build is not configured as Berean Dev."
  echo "error: Expected bundle ID: $EXP_BUNDLE — Actual bundle ID: ${PRODUCT_BUNDLE_IDENTIFIER:-<unset>}"
  printf 'error: Mismatches:%s\n' "$fail"
  echo "error: A Debug build would install over the production Berean app. Repair: npm run ios:sync:dev (regenerates ios/App/IdentityDevelopment.xcconfig) — never edit the bundle ID in Xcode."
  exit 1
fi
echo "Berean Dev safety check: OK — $PRODUCT_BUNDLE_IDENTIFIER · $BEREAN_DISPLAY_NAME · $BEREAN_ICLOUD_CONTAINER · $BEREAN_APP_GROUP · $EXP_BUNDLE.share"
