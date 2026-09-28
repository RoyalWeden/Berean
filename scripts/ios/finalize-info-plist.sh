#!/bin/bash
# Xcode build phase ("Finalize Info.plist", added by scripts/ios/patch-xcodeproj.mjs).
# Build-setting substitution applies to Info.plist *values*, not dictionary keys, and the
# NSUbiquitousContainers dictionary is keyed by the iCloud container id. This rewrites the
# placeholder key in the *built* Info.plist to the BEREAN_ICLOUD_CONTAINER value so the
# container appears in iCloud Drive (as "Berean") on the user's Mac as well — the folder the
# desktop app reads (docs/mobile/icloud.md §2). The source Info.plist stays generic.
set -euo pipefail
PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
ID="${BEREAN_ICLOUD_CONTAINER:-}"
if [ -z "$ID" ]; then echo "warning: BEREAN_ICLOUD_CONTAINER is empty; NSUbiquitousContainers left as is"; exit 0; fi
if /usr/libexec/PlistBuddy -c 'Print :NSUbiquitousContainers:$(BEREAN_ICLOUD_CONTAINER)' "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Copy :NSUbiquitousContainers:\$(BEREAN_ICLOUD_CONTAINER) :NSUbiquitousContainers:$ID" "$PLIST"
  /usr/libexec/PlistBuddy -c 'Delete :NSUbiquitousContainers:$(BEREAN_ICLOUD_CONTAINER)' "$PLIST"
  echo "NSUbiquitousContainers keyed by $ID"
fi
