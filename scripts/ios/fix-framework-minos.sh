#!/bin/bash
# "Fix Embedded Framework Versions" build phase (scripts/ios/patch-xcodeproj.mjs step 12).
#
# App Store Connect rejects a build whose embedded framework declares a MinimumOSVersion in its
# Info.plist that differs from what its binary was built for (ITMS-90208, 0.8.0 (5)):
# onnxruntime-swift-package-manager ships a static library whose framework Info.plist says 15.1;
# Xcode links it into a dynamic framework built for the app's deployment target (17.0) but keeps
# that Info.plist. For every embedded framework whose plist disagrees with its binary's LC_BUILD_VERSION
# `minos`, set the plist to the binary's value and re-sign that framework with the build's own
# identity (the app is signed after this phase, so its seal covers the fixed framework).
set -euo pipefail

FW_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"
[ -d "$FW_DIR" ] || exit 0

for fw in "$FW_DIR"/*.framework; do
  [ -d "$fw" ] || continue
  name="$(basename "$fw" .framework)"
  bin="$fw/$name"
  plist="$fw/Info.plist"
  [ -f "$bin" ] && [ -f "$plist" ] || continue
  minos="$(xcrun vtool -show-build "$bin" 2>/dev/null | awk '$1 == "minos" { print $2; exit }')"
  [ -n "$minos" ] || continue
  current="$(/usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$plist" 2>/dev/null || true)"
  [ "$current" = "$minos" ] && continue
  if [ -n "$current" ]; then
    /usr/libexec/PlistBuddy -c "Set :MinimumOSVersion $minos" "$plist"
  else
    /usr/libexec/PlistBuddy -c "Add :MinimumOSVersion string $minos" "$plist"
  fi
  if [ "${CODE_SIGNING_ALLOWED:-YES}" != "NO" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then
    codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" --preserve-metadata=identifier,entitlements,flags --timestamp=none "$fw"
  fi
  echo "[ios] $name.framework MinimumOSVersion ${current:-(none)} → $minos (matches its binary)"
done
