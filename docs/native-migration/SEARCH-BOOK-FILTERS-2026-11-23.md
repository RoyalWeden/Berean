# Search book filters and first-paint experiment — November 23, 2026

Committed as `4141ad1a` in `ScriptureSearchView.swift` and `PassagePicker.swift`. This changes presentation and selection of the existing device-local Search book IDs. The checked Search sync record retains only its query. Schema, sync and identities are unchanged.

## Filter behavior

- Browse Books uses the active edition scope and testament. Bible entries are grouped by testament with canonical book IDs listed once across scoped editions, including KJVA and LXX. Other texts group by work. A work with one entry is a direct toggle, while works with multiple entries expose expandable rows and bulk actions. Expanded rows share the passage picker’s short book labels.
- Select all adds only missing IDs in that group. Clear removes only that group’s IDs. Clear all removes the full book filter. Up to six selected books show removable chips directly. Larger sets show an expandable count.
- Find a book searches the scoped catalog by name or short name, excludes selected IDs and deduplicates by canonical ID. Return adds the first match and clears the input. Group headings use subheadline sizing after the first UI run.

## iPhone Simulator result and failure

On owned D0CC, selecting all 27 New Testament books, entering Psalms in Find a book and pressing Return raised the count to 28. Clearing the New Testament group left only the Psalms chip and the single Psalm 42:4 result. This verifies that group clear preserves an out-of-group selection and results follow the retained book filter.

The subsequent Bible scope change crashed iPhone Simulator process 60526 at 14:30:31. Report: `BereanIOS-2026-11-23-143031.ips`. The `focusText` getter read session state inside `app.update` while the same session was under exclusive mutation. The candidate now captures focus before the closure and clears it only when the explicit new edition list excludes the captured edition. The rebuilt `4141ad1a` candidate passed the scope retests below. No further crash was observed in these routes.

## Final Mac and iPhone scope checks

- Mac expanded Clement to Book 1–10, selected all 10, added Psalms with typed Return for 11 selected, then cleared Clement and retained only Psalms and its one result. Clear all restored 19 original results. Bible scope showed 18 and switching back to All restored 19 without a crash.
- iPhone Simulator verified Bible at 18, LXX at 8, and All at 19. LXX-only browsing showed Old Testament with 38 books and Apocrypha with 15, with no New Testament group. Changing from focused LXX to Other Writings cleared the focus and left one Jacob result. No further crash was observed.
- Restored Mac “voice of joy,” All scope and seven tabs. Restored the iPhone original `zzbereanqa2026` query and All scope, then Study Matthew 5, selected verse 12 and nine tabs.

## Search first-paint experiment

The new list seeds its native scroll position from the validated pending or saved row and alignment. Its identity waits for current results or tag membership. The existing task handles history changes in a mounted list. In a cold manual-bottom replay, the first two CUA screenshots and the settled view retained the bottom position. The earlier wrong-top flash was absent from those samples. Continuous first-paint behavior remains unverified. See [Search viewport evidence](SEARCH-VIEWPORT-2026-11-23.md).

## Remaining verification

Broaden scoped deduplication and individual toggling checks, accessibility and hardware keyboard actions, no-match input, tightly constrained layouts, filter races and first-paint timing.
