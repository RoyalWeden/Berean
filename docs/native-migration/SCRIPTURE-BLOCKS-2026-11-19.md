# Verified automatic Scripture blocks and iPhone Settings

2026-11-19 local / 2026-11-20 UTC. Source **7e8142f94febbb35a609d2398dba9b8f0795fb76**, native/reader-notes, draft PR24. This implements the Notes block presentation requested from the original app; it does not complete all Notes/editor/backlink parity.

## Implemented behavior

- Both native editors recognize single-line reference+body and reference headings with numbered multiline bodies, including disjoint, whole-chapter and cross-chapter references. Full Reference grammar is used for Hermas sections/comma book names; source ranges stay UTF16 and Markdown source is never serialized or rewritten by presentation.
- Canonical Bible lookup precedes formatting. Requested rows must exist; missing chapters/verses and half of a combined LXX record remain plain. LXX Psalm reader mapping folds titles consistently while retaining raw stored IDs. Actual display text uses the existing Word Replacer pipeline.
- Original settings keys/defaults: noteScriptureBlock=false, noteScriptureBlockThreshold=0.9. Threshold accepts0–1, clamps malformed/nonfinite imports safely; UI uses5% steps and retains finer imported values until edited. Suggestions, auto-linking and formatting remain independent.
- Off-main cancellable scanning;300ms database debounce, chapter reuse per pass, bounded500ratio cache keyed by normalized block/actual edition/Hermas/replacer context. Duplicate passages each receive their own current source range. Note/content/settings/catalog checks reject stale results; native restyling validates source slices again before drawing.
- Rounded restrained cards share the existing dictionary layout, normal note font, editable source/selection/Undo/table behavior. Verified headings can link through the existing passage route when auto-linking is enabled. Note links prefer the note's edition rather than silently using the app default.
- iPhone Settings now starts with six native category links: Reading, Appearance, Notes, Workspaces, Shortcuts, About. Haptics is under Appearance. Existing bindings/actions remain; Mac pane layout is unchanged.

## Meaningful logic tests and builds

- New16tests cover UTF16/CRLF/loneCR, inline-format projection, source staleness, numbered/multiline/chapter/disjoint headings, numbered-book boundaries, code/link/table exclusions, normalization, Hermas syntax, position-independent keys, legacy repeated-word ratios/Strong’s exclusions, complete/cross-chapter coverage, wrong/missing/duplicate rows, LXX titles/combined records and malformed thresholds.
- Full shared suite: **290PASS** =4core+286conformance/68suites,28.4seconds for conformance after compilation. Log /private/tmp/berean-scripture-block-full-tests.log. This is not the earlier274test baseline.
- Final builds including Settings navigation: /private/tmp/berean-scripture-block-navigation-mac.log and /private/tmp/berean-scripture-block-navigation-ios.log, both BUILD SUCCEEDED. Both development bundle IDs verified; same final Mac build was installed into the isolated QA copy.
- Earlier publication logs /private/tmp/berean-scripture-block-publish-{mac,ios}.log also passed before the iPhone category refinement. Isolated derived data /private/tmp/berean-scripture-block-final-dd was necessary because a provisional repository-cache Mac build waited on a cloud-offloaded12GiB compilation index. That obsolete provisional build was cancelled only after both final builds passed; it is not recorded as success.
- Swift startup initially waited on a live Git status reading offloaded legacy source; restoring necessary individual tracked paths let the same process continue. No checkout/cache reset or user-data deletion was used.

## Actual Mac interactions

Using only /private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119:

1. Created an owned attached note; pasted the known703-character fixture. Single John3:16, multiline John3:16–17, explicit Psalm3:1LXX and duplicate John quote all rendered cards. Unrelated spacecraft/coffee commentary remained plain; the Markdown table rendered as a table.
2. One Undo removed the full paste; Redo restored it. Replacing just one duplicate with unrelated prose removed its card, retaining the other; one Undo restored the quote.
3. Formatting and auto-link toggles were independent: cards with links off, plain linked references with formatting off. No source conversion/phantom formatting Undo step.
4. Read-only DB equality proved exact pasted source, including after Undo/settings. Original refs false and formatting false restored.
5. Recoverably trashed only note **cf45c4a8-6e0a-4ee7-954a-e3df7a0a89d3**; extra note tab closed. All19pre-existing note-row hashes/timestamps (including older owned Trash),37exact active IDs and all3tag tables unchanged. Original16notes are included in that scope.
6. Final Mac app relaunch closed the test Settings window and installed the last build. Genesis1KJVA/selected1/Notes inspectorGenesis1:1/sidebar239/rightdivider1148 retained. Scroll was explicitly restored to0.5782918149466192 after relaunch reported0.6209964412811388. This is restoration evidence, not a fix for the broader viewport defect.

## Actual iPhone Simulator interactions

Only simulatorD0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D / com.berean.native.ios.dev:

1. Root Settings six routes and native Back verified. Reading controls, Appearance/theme+haptics, Notes controls, Workspaces list, Shortcuts and About all reachable. Typing copy in Shortcuts filtered to the two expected commands; query cleared.
2. Formatting enabled at90%. Body tap selected Psalm3LXXverse1 with grouped dashed/faint fill. AddNote created owned note **f1fe721c-0d9b-478b-9979-741946f9a26b**, raw attachmentPSA.3.2/textlxx.
3. Pasted the exact703-character fixture using the native DeviceHub Send Clipboard flow. Both John quote occurrences, multiline quote and LXX quote rendered; unrelated commentary stayed unboxed; table stayed a table. This also exercised canonical fallback for John in a note attached to LXX.
4. Actual native Undo returned to the prior typed/autocorrected body; Redo restored exact pasted source. Read-only DB comparison confirmed source equality again after recoverable Trash.
5. Owned fixture trashed and exact extra tab09f1f557-de10-4240-a23d-e06aea628c77 closed through Tab Actions. All24pre-existing note-row hashes/timestamps (including older owned Trash),47exact active IDs and all3tag tables unchanged; original17notes are included. Format preference restoredOFF; other Notes switches preserved.
6. Final display Psalm3LXX, no selection, Strong’s/CompareOFF, no sheets; Capture KeyboardOFF/ZoomToFit retained. Device container after last install D979C134-F582-414A-AED5-EF5D1B25D673, final appPID36782 after the documented QA recovery relaunch. Re-query before future use.

## Clipboard/helper cleanup

See [SIMULATOR-CLIPBOARD-QA](SIMULATOR-CLIPBOARD-QA.md). Direct CUA.paste under captured keyboard used the old simulator clipboard; Undo corrected only the owned test note. Native TypeText allowed normal iOS autocorrection, so it was not used as exact-paste proof.

A NEW TextEdit helper copied only synthetic text. TextEdit autosaved/auto-named it Bible Verses and Commentary in its iCloud folder; after verifying ownership by exact fixture content and creation chain, native File→Move To moved it to /private/tmp/Bible Verses and Commentary.txt. Read-only existence/source checks proved the iCloud copy absent and temporary fixture intact. The temporary clipboard edit was reverted and helper closed. The prior berean-reference-block-qa.txt window/selection was restored; all pre-existing TextEdit documents were left unedited. Known prior non-sensitive clipboard command restored to host and selected simulator; no command was executed. No global shared-clipboard/iCloud preference was changed.

Future tests should open a dedicated already-created temporary file rather than new default TextEdit documents to avoid automatic iCloud save/naming.

## Remaining scope and newly reproduced issues

- Physical phone, VoiceOver, IME/very large notes, every imported-rich-text/code/link variant, read-only history/print blocks and broader automatic-reference grammar/index parity remain OPEN. A block is not proof of complete backlink tracking.
- Existing UI issue: LXX attachment label saysPsalms3:2LXX while reader/title correctlyshow3:1. Fix presentation, never rewrite rawPSA.3.2 or golden Reference behavior.
- Existing UI issue: trashing an actively edited iPhone note left root dock hidden. RichNoteEditorIOS has begin/end notifications but no dismantle cleanup; audit owner ordering/keyboard geometry. QA-only relaunch recovered navigation; no product fix claimed.
- Existing Mac return/relaunch viewport/panel-width changes remain OPEN; exact reproduction is in FOLLOWUP.
- A fast batched Settings Back→Done coincided with underlying KJVA flip; separate observed Back→Done returned correctly. Distinguish tool/remote-sheet timing from a real product click-through before changing code.
- No production/shared Mac, physical phone, other simulator, schema, sync protocol, signing or bundle identities changed. Berean legacy integration remains. The unrelated owner-requested Ollama removal has its own artifact.

Temporary evidence /private/tmp/berean-scripture-block-{mac,ios}-{baseline,fixture}.json, /private/tmp/berean-scripture-block-fixture.txt and /private/tmp/berean-scripture-block-final-verification.json. These may disappear; do not restore old user content to recreate a baseline.
