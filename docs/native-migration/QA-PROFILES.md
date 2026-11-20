# Isolated Mac QA profiles

The shared `BereanNativeQA` library is now being used during human testing. Do not restore its old note/tab fixtures or run further automated interactions against that live app path. Preserve newer notes/tabs. Production/dev bundle IDs, signing and sync remain unchanged.

## Implemented debug-only isolation

The Mac debug bundle `com.berean.native.mac.dev` accepts `--qa-library --qa-profile NAME`. Names contain1–48ASCII letters/digits/hyphens, begin with a letter/digit, and normalize to lowercase so case-insensitive filesystem names share the same preference domain. Missing/repeated/invalid profiles fail closed before library opening. Arbitrary paths are never accepted. Existing launches without a profile retain their previous directories/preferences.

A profile uses container Application Support/`BereanNativeQA-NAME` and UserDefaults suite `com.berean.native.mac.dev.qa.NAME`. All app-owned direct preference access now uses UserLibrary.defaults, and Mac root/Settings @AppStorage inherits that same store. The preference owner/history helpers are MainActor-isolated. Regular Mac and iPhone behavior keeps UserDefaults.standard. Framework window restoration may still use platform-owned preferences; do not claim isolation of every OS window setting.

## Current automation fixture

- Separate app copy: `/private/tmp/berean-codex-qa/BereanMac.app`.
- Launch: `open -n /private/tmp/berean-codex-qa/BereanMac.app --args --qa-library --qa-profile codex-study-20261119`.
- Library: `/Users/roywe/Library/Containers/com.berean.native.mac.dev/Data/Library/Application Support/BereanNativeQA-codex-study-20261119/berean.db`.
- Suite plist: same container `Data/Library/Preferences/com.berean.native.mac.dev.qa.codex-study-20261119.plist`.
- Baseline: `/private/tmp/berean-codex-qa/baseline.json` (all13note content hashes/timestamps,38active IDs, all3tag tables).
- Source snapshot: SQLite backup from a read-only connection to the human-used QA library. Source never written by the copy. Existing profile directory must never be overwritten; create a new named fixture if needed. Saved note/tab IDs remain intact in the copy.

Bind CUA only with the separate app’s full path. Never broad-kill BereanMac processes. Inspect the exact copied binary path/QA-profile arguments, then stop only that isolated PID when updating the copy. Build first, stop that PID, copy the app with ditto, relaunch the profile. Do not change the original app’s bundle identity or signing. Do not use external URL dispatch to select between concurrent apps with the same bundle ID.

## Evidence

Profile parser tests cover explicit opt-in, invalid/missing/repeated names, path traversal/separators/Unicode/option-like names, lengths48/49 and case folding. Final full255tests=4core+251conformance/64suites PASS,133.637s conformance, `/tmp/berean-study-filter-final-full-suite.log`; bothSDK27.2builds `/tmp/berean-study-filter-final-{mac,ios}.log` PASS. The live profile writes studyNotesSort=created and its own currentSessionId to its named suite. All13copied note hashes/timestamps,38original active IDs and all3tag tables remained unchanged after the first filter/scroll interaction pass. A single explicit John3:17 temporary tab was closed individually. Recheck against this profile baseline, not the obsolete shared-QA baseline.

## Current automation copy — codex-controls-20261119

Use `/private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119`. A read-only backup of the prior study QA library seeded the NEW container directory `Application Support/BereanNativeQA-codex-controls-20261119`; fresh preference suite `com.berean.native.mac.dev.qa.codex-controls-20261119`. Baseline `/private/tmp/berean-codex-controls-qa/baseline.json`:16 notes includingTrash,37 activeIDs,3tagtables. All unchanged after this UI pass. Prior codex-study profile has newer concurrent tab/list/viewport changes and must not be automated/restored to its old38-ID baseline. Exact removed original tab ID and runtime details are in newest HANDOFF. Never kill shared/regular/old-study processes while updating this copy. Match the full new path and QA args first.
