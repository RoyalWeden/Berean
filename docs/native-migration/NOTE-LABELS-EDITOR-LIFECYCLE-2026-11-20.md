# LXX note labels and iPhone editor teardown — 2026-11-20

Source **334eafbb**, based on published9a210789; broad migration remains ACTIVE. PR24 stays draft/base native/m6-navigation. Owner-only merge22→23 after correct retarget/checks→24. No schema, production, sync identity, signing or legacy formatter changes.

## Delivered and why

- Shared native NoteAttachmentLabel maps saved LXX Psalm attachment numbers to the same body numbers used by the reader. RawPSA.3.2 now displaysPsalms3:1LXX. Handles title/opening collapse, ranges, combined115:4–5 source records, whole chapters, multi-attachments and one edition suffix. Other editions and the legacy golden Reference formatter remain unchanged. Native labels do not rewrite any attachment/link identity.
- iPhone RichNoteEditorIOS explicitly resigns and finishes its editing session during dismantle. Normal UIKit end and teardown share one idempotent path. Deferred teardown carries the owning editor UUID; an obsolete editor cannot clear a newer editor's focus. Existing keyboard-frame notifications remain. This fixes the tested Trash workflow without an app restart; it is not a claim of all keyboard/window configurations.

## Verification

- Six meaningful regressions across NoteAttachmentLabelTests/NoteEditingFocusTests: reader/storage separation, title/range/combined/whole/mixed/empty/unknown/non-LXX cases, normal/duplicate/unmatched ends and deferred old-editor end after new-editor begin.
- Targeted six PASS: /private/tmp/berean-label-focus-tests.log. First restricted run failed because Swift could not write its module cache; reran with required build access, no code workaround or reset.
- Full shared suite PASS: **296 total** (4XCTest core +292Swift Testing /70suites), /private/tmp/berean-label-focus-full-tests.log. Swift Testing exhaustive suites completed31.597s.
- Both native Debug builds PASS: /private/tmp/berean-label-focus-mac-build.log and /private/tmp/berean-label-focus-ios-build.log. Established isolated DerivedData /private/tmp/berean-scripture-block-final-dd avoids confirmed cloud-offloaded repo cache. Development identities verified before installation.
- Actual Mac CUA: created owned Psalm3:1LXX reader + verse note; attachment saysOpenPsalms3:1LXX; click reuses matching reader and selectsPsalms3:1. Read-only DB confirms rawPSA.3.2/lxx. Recoverably trashed owned note2ed8f256-5c50-4aa6-8bd4-e5297c28ca3e and closed both extra tabs.
- Actual iPhone CUA, established iPhone18Pro27.0Simulator D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D: body tap selects verse1, AddNote gives matching title/attachmentPsalms3:1LXX, attachment opens matching selected reader verse, Back-to-note restores editing. Typed known sourceDock lifecycle QA. with captured hardware keyboard; note actions→Trash returns to Notes with visible/working Tabs/Go/More dock **without relaunch**. RawPSA.3.2/lxx retained. Owned note007f9551-d946-4896-923e-a9767aa4dfcd recoverablytrashed, extra tabclosed.
- /private/tmp/berean-label-focus-data-verification.json proves all20Mac/25iPhone pre-existing full note-row hashes/timestamps unchanged, all3tag tables unchanged and exact37/47active tabIDs restored. Initial tag comparison used dictionaries against baseline array rows; normalized to the baseline representation and verified actual equality. No data repair/write was required.
- Mac final Genesis1KJVA/selected1/NotesGenesis1:1/sidebar239/rightdivider1148/scroll0.5782918149466192. This relaunch preserved scroll exactly; returning from the temporary reader still changed rightdivider to1168, restored via UI, with resulting scroll restored. **Divider/viewport return issue remains open**.
- iPhone final Psalm3LXX/no selection/Strong'sCompareOFF/no sheets/dock visible/CaptureKeyboardOFF/ZoomToFit. Updated appPID40249; re-query container from /private/tmp/berean-note-keyboard-ios-container.txt after future installs. Mac exact QA path/profile unchanged. All CUA phases summarized; no GUI interaction pending.

## Limits and next work

Physical iPhone, software-keyboard-specific deletion, rapid switches between two different focused editors, multiple iPad scenes and comprehensive keyboard dismissal remain unverified in UI. Focus ordering is regression-tested; do not infer that every UIKit notification race or scene is solved. Next implement/reproduce right-divider/viewport drift with a real trace; continue Word Replacer, rich/read-only Notes, general splits/history/cursor and Kokoro backlog. No Apple voices.

Previous head9a210789 run44693533700 remained live at last poll: legacy job succeeded, native Mac tests/AppKit regressions succeeded, iOS platform-conformance step running. This does not establish green checks for334eafbb or a later publication head. Recheck exact-head CI after push; do not restart a live job because a poll times out.

Owner also completed the administrator-owned Ollama shortcut removal; read-only file/symlink absence verified. See OLLAMA-REMOVAL-2026-11-19.md. Never retry admin unlink/password access.
