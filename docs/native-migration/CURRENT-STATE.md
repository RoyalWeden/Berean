# Current native migration checkpoint

Snapshot **2026-11-20T07:12:57+00:00**, Codex. Read HANDOFF first. This is not a worker lock; verify live Git/GitHub/process/app/library before acting and preserve newer edits.

## Source, review and verification

- Checkout /Users/roywe/Documents/ChatGPT/Berean/repo, branch native/reader-notes.
- Latest implemented source **7e8142f94febbb35a609d2398dba9b8f0795fb76**: verified automatic Scripture-block presentation on both native editors and categorized iPhone Settings. A later documentation-only head can follow it.
- Draft PR24, base native/m6-navigation, last verified OPEN/draft. Last remote observation was cf0c6438 before this source/doc publication. **Verify actual remote head and its own checks**; if source7e8142f9 is already published, resume app work rather than repeating publication.
- Prior exact cf0c6438 CI44686490619 SUCCESS; source1f4e7361 CI44683148736 SUCCESS. Continuity-only9fb67f8b run44685554261 was CANCELLED, not green. None proves new-source CI.
- New source local validation **290tests PASS** (4core+286conformance/68suites), both final development builds PASS; actual Mac+iPhone Simulator interactions and source/data checks passed. See [SCRIPTURE-BLOCKS-2026-11-19](SCRIPTURE-BLOCKS-2026-11-19.md) for logs, limits and cleanup. New publication-head CI must be rechecked.
- Pushgithub in this clone; origin is the owner's local repository. Owner-only merge22→23 after correct retarget/checks→draft24. No merge/retarget/ready/force action.
- All shipping-code WIP was committed as7e8142f9. Documentation may still be dirty until its own checkpoint commit; inspect actual status. Historical prototype is superseded, never copy it over live code.

## Safe runtime and data

- Mac only /private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119, development IDcom.berean.native.mac.dev. Final build installed; diagnosticsOFF; test Settings window closed by verified isolated lifecycle.
- Mac Genesis1KJVA, selected1, Notes inspectorGenesis1:1, sidebar239/rightdivider1148, scrollbar **0.5782918149466192** explicitly restored after final relaunch. Preserve newer live state, not this snapshot. Several app copies share a bundle ID; verify exact path/arguments/PID before stopping/replacing.
- iPhone only simulatorD0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D / com.berean.native.ios.dev. Last container **D979C134-F582-414A-AED5-EF5D1B25D673**, PID36782. Re-query after every install; path file /private/tmp/berean-note-keyboard-ios-container.txt. Final Psalm3LXX, no selection, Strong’s/CompareOFF, sheets closed, Capture KeyboardOFF/ZoomToFit.
- Both format settings restoredOFF/default90%; Mac reference detection restoredfalse, iPhone defaulttrue preserved. Source703chars exact after Undo/Redo and Trash.
- Owned Mac notecf45c4a8-6e0a-4ee7-954a-e3df7a0a89d3 and iPhone notef1fe721c-0d9b-478b-9979-741946f9a26b recoverablyTRASHED; extra tabs closed. All19Mac/24iPhone prior note-row hashes/timestamps (including prior owned Trash),37/47exact active IDs and all3tag tables unchanged. Original16/17notes are included.
- TextEdit helper closed, prior reference fixture window/selection restored; auto-saved synthetic helper moved out of iCloud to /private/tmp/Bible Verses and Commentary.txt, exact fixture intact. Known original non-sensitive clipboard restored to host/selected simulator; no global sharing preference changed. [Clipboard QA](SIMULATOR-CLIPBOARD-QA.md) prevents repeating this trap.
- Owner-requested Ollama models/app cleanup is separate: models deleted/app/settings in recoverableTrash; only negligible admin-owned dangling shortcut remains. See [OLLAMA-REMOVAL](OLLAMA-REMOVAL-2026-11-19.md). No need to retry privilege/password bypass.

## Next executable work

1. Verify current source/doc publication and exact-head CI; re-poll confirmed live jobs rather than restarting on timeout. No native GUI work is currently pending; all CUA phases received completion summaries.
2. **Fix LXX note attachment presentation**: rawPSA.3.2 displaysPsalms3:2LXX despite reader/title3:1. Use reader mapping for display, keep raw IDs/golden Reference unchanged. Add range/combined/whole/multi-attachment tests and actual note-link UI checks.
3. **Fix iPhone dock after editor removal**: trashing an editing note left keyboardUp true/no dock. Begin/end notifications have no dismantle cleanup; audit ownership/order across trash/navigation/tab switching and hardware/software keyboards. QA relaunch is not a fix.
4. Reproduce Mac Notes-return/relaunch viewport/right-divider drift with real trace; separately observed Settings Back/Done worked, so don't call the fast-batch flip a proved productbug.
5. Continue Word Replacer persisted/custom/per-rule revision handling, remaining hover/cursor controls, all-tab history/scroll, live generic splits, rich/read-only Notes/sharing/backlink grammar and Kokoro. No Apple voices. Follow [TASKS](TASKS.md), [FOLLOWUP](FOLLOWUP-2026-11-19.md), [parity](FULL-FEATURE-PARITY.md), [principles](OWNER-PRINCIPLES.md) and [map](DOCUMENTATION-MAP.md).

Maintain notes continuously. Broad goal remains **ACTIVE**; tests, a source/doc commit or this batch do not complete the migration. Previous working notes were [archived](CHECKPOINT-HISTORY-2026-11-20.md), not erased.
