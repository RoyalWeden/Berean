#!/bin/zsh
# Build, install and launch the NATIVE iPhone app (com.berean.native.ios.dev — "Berean Native Dev") on a
# connected physical iPhone. It installs next to the App Store "Berean" (com.berean.app) and the Capacitor
# "Berean Dev" (com.berean.app.dev): different bundle id, no iCloud or App Group entitlements, its own data.
#
#   npm run native:ios:device            # first connected iPhone
#   npm run native:ios:device -- <UDID>  # a specific one
#
# Signing: automatic development signing with your team. The team id is read from the gitignored
# apple/Config/Signing.xcconfig; if missing, it is created from ios/App/Signing.xcconfig's DEVELOPMENT_TEAM
# (ONLY the team id is copied — never its bundle id, iCloud container or App Group).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
SIGN="apple/Config/Signing.xcconfig"
if [[ ! -f "$SIGN" ]]; then
  TEAM=""
  [[ -f ios/App/Signing.xcconfig ]] && TEAM="$(sed -n 's/^DEVELOPMENT_TEAM *= *\([A-Z0-9]*\).*/\1/p' ios/App/Signing.xcconfig | head -1)"
  if [[ -z "$TEAM" ]]; then
    echo "No development team found. Create $SIGN with one line:  DEVELOPMENT_TEAM = <your 10-character Team ID>"; exit 1
  fi
  printf '// Local only (gitignored). Native development signing — team id only.\nDEVELOPMENT_TEAM = %s\n' "$TEAM" > "$SIGN"
  echo "Created $SIGN (team id only)."
fi

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  UDID="$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}' | head -1)"
fi
if [[ -z "$UDID" ]]; then
  echo "No connected iPhone. Connect it with a cable (or on the same Wi-Fi after pairing), unlock it, and trust this Mac."; exit 1
fi
echo "Device: $UDID"

BUNDLE="com.berean.native.ios.dev"
grep -q "PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE" apple/Config/BereanIOS.xcconfig || { echo "Refusing: the iOS target is not $BUNDLE"; exit 1; }

python3 scripts/native/gen_xcodeproj.py >/dev/null
xcodebuild -project apple/Berean.xcodeproj -scheme BereanIOS -configuration Debug \
  -destination "id=$UDID" -derivedDataPath build/apple/DerivedData \
  -allowProvisioningUpdates build 2>&1 | grep -E "error:|warning: .*[Pp]rovision|BUILD (SUCCEEDED|FAILED)" || true
APP="build/apple/DerivedData/Build/Products/Debug-iphoneos/BereanIOS.app"
[[ -d "$APP" ]] || { echo "Build failed — see above. If it mentions provisioning, open apple/Berean.xcodeproj once in Xcode and sign in to your Apple account (Xcode ▸ Settings ▸ Accounts)."; exit 1; }
ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
[[ "$ID" == "$BUNDLE" ]] || { echo "Refusing to install: built bundle id is $ID"; exit 1; }
if codesign -d --entitlements - "$APP" 2>/dev/null | grep -qE "icloud|application-groups"; then echo "Refusing: the build has iCloud/App Group entitlements"; exit 1; fi
xcrun devicectl device install app --device "$UDID" "$APP"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE" || echo "Installed. If launch was refused, unlock the iPhone (and trust the developer: Settings ▸ General ▸ VPN & Device Management)."
