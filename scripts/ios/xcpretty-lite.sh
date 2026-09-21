#!/bin/bash
# Minimal xcodebuild output filter (no gem needed): keeps errors, warnings from our code,
# the copy-data phase, and the final verdict; exits non-zero when the build failed.
status=0
while IFS= read -r line; do
  case "$line" in
    *"error:"*|*"BUILD FAILED"*|*"ARCHIVE FAILED"*) echo "$line"; status=1 ;;
    *"BUILD SUCCEEDED"*|*"ARCHIVE SUCCEEDED"*|*"copied "*|*"removed stale"*|*"warning: "*BereanNative*|*"warning: "*"/App/App/"*) echo "$line" ;;
  esac
done
exit $status
