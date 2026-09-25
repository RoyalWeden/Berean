# Berean UX principles

Permanent product rules for both apps (macOS and iPhone). Source of the current wave: the
developer's 2026-09-25 device testing (learning curve, feature overload, too many taps, "feels
like Safari / an interactive web thing"). Requirement ledger:
[mobile/testing-backlog-2026-09-25.md](mobile/testing-backlog-2026-09-25.md).

> Berean is **a Bible with powerful study tools attached** — not a navigation system that happens
> to contain a Bible. The Scripture reader is the centre; everything else serves it.

## 1. Principles

1. **Easy for a non-technical user.** The basic app — read, change chapter, search, tap a verse,
   find notes — works without a tutorial and without knowing what a sheet, tab stack, history,
   database, workspace or session is.
2. **Power users stay fast.** Simplicity never means burying features. A feature is *hidden until
   relevant*, never *hidden until discovered by accident*. Every advanced feature keeps a direct,
   logical home (verse sheet, caret, Filters, long-press, Settings).
3. **Minimise interaction depth for high-frequency Bible-study tasks.** Optimise the frequent
   tasks first (table §3); rare tasks may be one level deeper.
4. **Contextual functionality.** An action that only makes sense in a context lives in that
   context: verse → Notes · Strong's · Refs · Copy; result → long-press menu; tab → caret.
5. **Fewest layers necessary.** Tabs → current tab → caret / sheet → sub-view is a default, not a
   law. Bypass a layer when it makes a task clearly easier (e.g. editing a verse note inside the
   verse sheet instead of switching to the Notes tab). Don't restructure for novelty.
6. **Fewer visible controls + better placement + contextual discovery + fewer steps = power
   without clutter.** Reduce visual competition, not capability.
7. **Native, not web.** Apple materials where they naturally belong (floating controls, bars,
   sheets), system typography, grouped lists, native menus; no address-bar metaphors, no
   dashboard grids, no decorative cards around Scripture. Glass is a material, not an identity:
   Scripture text is never translucent.
8. **Compact does not mean tiny.** Density comes from removing wasted space and duplicate labels,
   never from shrinking tap targets (≥ 44 pt), Dynamic Type or contrast.

## 2. Current tab vs new tab (Cmd+L vs Cmd+T)

| Gesture | Mac | iPhone | Effect |
|---|---|---|---|
| Change the current tab | Cmd+L, floating search in "edit current tab" mode | the caret's search field | navigates THIS tab (same parser / destinations as floating search) |
| New tab | Cmd+T | the plus (floating search) | creates a tab |
| Tap a result / reference | click | tap | opens in the current tab |
| Open elsewhere | menu → Open in New Tab | long-press → Open in New Tab | new tab, explicit |

**Rule:** an action that starts inside an existing tab changes that tab unless it is explicitly
labelled as creating a new one (Advanced Scripture Search from a Scripture tab, Compare this verse,
a cross reference, a note's verse link, back/forward). There is no label explaining the caret
field — it is learned by use.

## 3. Interaction depth audit (iPhone, taps after the app is open)

"Before" = before the 2026-09-25 pass; "After" = now. Typing counts as one step.

| # | Task | Before | After | Notes |
|---|---|---|---|---|
| 1 | Read the current chapter | 0 | 0 | |
| 2 | Next / previous chapter | 1 swipe | 1 swipe | edge tap too |
| 3 | Change book + chapter | 4–5 (title → library → collection → book → chapter) | 3 (title → book → chapter) | picker opens inside the current library; Scripture changes on the chapter tap |
| 4 | Go to a verse | 5 (… chapter → "choose verses" → verse) | 4 (… chapter → verse), or 2 typed ("John 3:16") | verse grid appears right after the chapter |
| 5 | Search Scripture | 2 + typing | 2 + typing | plus → type |
| 6 | Advanced search option | 2–3, all filters always visible | 2 (Search → Filters → option) | Filters collapsed by default with a summary |
| 7 | Strong's for a word | 3 (verse → drag up → number) | 2 (verse → number, Strong's mode remembered) / 3 | numbers inline in the reader: 1 |
| 8 | Cross references of a verse | 2 | 2 | now TSK/e · Classic · My Notes, filtered to the selection |
| 9 | Read / edit a verse's note | 4 + tab switch (verse → up → Notes → note → Notes tab) | 3, in place (verse → Notes → note) | edited in the verse sheet |
| 10 | New note on a verse | 2 + tab switch | 3, in place | context (the verse) stays |
| 11 | Copy a verse | 2 | 2 | sheet stays open with ✓ |
| 12 | Compare translations | 2, new tab | 2, same tab (‹ returns) | |
| 13 | KJV ⇄ LXX | 2 | 2 | caret tile |
| 14 | Find in this book | 2 | 2 | |
| 15 | Previous location in this tab | 2, unreliable in Notes / Search / Settings | 2, every tab type | caret ‹ › |
| 16 | History (all tabs) | 2 | 2 | plus → History |
| 17 | Open a result in a new tab | 2 | 2 | long-press |
| 18 | New tab | 1 | 1 | plus |
| 19 | Switch tab | 2 | 2 | tab cards, Recent order by default |
| 20 | Settings | 2 | 2 | plus → Settings |
| 21 | Text size | 3 | 3 / pinch 1 | caret → Display → size |
| 22 | Scripture colours | 4 (Settings → preset …) | 3 (caret → Display → Colour) | Scripture only now |
| 23 | Lexicon entry by number | 2 | 2 | plus → "H7225" |
| 24 | Today's note | 2 | 2 | plus → Today |
| 25 | Change the current tab to another passage / note | 3+ (picker / finder) | 2 + typing (caret field) | Cmd+L equivalent |

## 4. Before / after navigation map

| Goal | Before | After |
|---|---|---|
| Edit a verse's note | verse → drag up → Notes for this verse → note → *Notes tab* → edit | verse → Notes → note → edit **in the sheet** ("‹ Deuteronomy 29:3") |
| Strong's of a verse | verse → drag up → study view → number | verse → Strong's (mode remembered) → number |
| Cross refs of several verses | select → *not available* for several | select → Refs → per-verse lists |
| Change the tab's passage by typing | title → picker search | caret → search field → "Matthew 10 LXX" (same parser as floating search) |
| Pick book / chapter / verse | title → Library → collection → book → chapter → "Choose verses" → verse | title → book → chapter (Scripture updates, verse grid shown) → verse *or* dismiss |
| Compare | caret → Compare (**new tab**) | caret → Compare (**this tab**; ‹ returns) |
| Back to where I was in Notes | caret ‹ (**often wrong**) | caret ‹ — list, folder, note, exactly |
| Advanced search | Search → all filter rows | Search → Filters (summary) → options |
| Scripture colours | Settings → Color preset (changed **the whole app**) | caret → Display → Colour (Scripture only) |

## 5. Feature placement matrix

A persistent tab · B contextual sheet · C inline action · D long-press · E expandable section ·
F Settings · G redundant entry removed · H other.

| Feature | Placement |
|---|---|
| Scripture reading | A (Scripture tab) |
| Book / chapter / verse | B (title → picker), C (swipe / edge tap), caret field (type) |
| Verse actions (Notes, Strong's, Refs, Copy) | B (verse sheet, compact) |
| Highlight, Share, audio, compare, tags | B (verse sheet: colours compact; the rest expanded) |
| Verse notes | B (verse sheet, edit in place) + A (Notes tab) |
| Strong's | C (inline numbers), B (verse sheet Strong's mode / entry), A (Lexicon) |
| Cross references | B (verse sheet Refs, selection bar Refs) |
| Find in book | caret action → inline bar (C) |
| Display options | E (caret → Display) |
| Scripture colour presets | E (caret → Display) + F |
| KJV ⇄ LXX, Strong's toggle, read aloud | caret tiles |
| Compare | caret action (this tab) · verse sheet (expanded) |
| Search | A (Search tab) · plus (new tab) |
| Advanced search filters | E (Search → Filters) |
| Result actions | D (long-press menu) |
| Tab back / forward | caret ‹ › |
| History (all tabs) | A (History tab) via plus |
| Tabs, sessions, archive | B (tab cards sheet; archive / sessions are sub-views) |
| Workspaces | G — same thing as Sessions (saved sessions) |
| Compare / Workspaces in floating search | G (removed) |
| "Why did you go to…?" prompt | G on iPhone (kept on macOS) |
| Notes list views ("All views, desktop layout") | G (native groupings in the caret) |
| Daily / Today | plus · Notes caret |
| Settings | A (Settings tab) via plus |

## 6. New user vs power user

| New user can… | How |
|---|---|
| read, change chapter | open → read; swipe; tap the passage capsule |
| search | plus → type |
| study a verse | tap it → four obvious buttons |
| find notes | verse → Notes; Notes tab |
| understand controls | three bottom controls only (tabs · plus · caret); labels on every sheet action |

| Power user can quickly… | How |
|---|---|
| advanced search | Search → Filters, or a Scripture tab's caret |
| Strong's | inline numbers; Strong's mode; Lexicon |
| cross references (3 sources, multi-verse) | verse / selection → Refs |
| compare | caret → Compare |
| library books (LXX, Enoch, Jubilees, Apocrypha…) | picker search: "Matthew 10 LXX", "1 Enoch 10" |
| history | caret ‹ › (per tab), History tab (all) |
| tabs / sessions | tab cards: Recent / Custom, Sessions, Archive |
| reading options | caret → Display |

## 7. Models

**Per-tab history.** History is per tab (`tabNavStacks`); the History tab combines tabs. An entry is
a *meaningful destination*: a chapter / verse / translation change, a note opened, the Notes list
or a folder / filter of it, a search query committed or its scope / filters changed, a Lexicon
entry, a video, a Settings subsection, entering / leaving Compare. Scroll is state attached to an
entry, never its own entry. Entries carry typed fields (book, chapter, noteId, …) and a generic
`state` snapshot re-applied on restore; `home` entries record list views. Nothing is recorded while
a back / forward restore is running. Back / forward never create a tab or a sheet.

**Sheet gestures.** Boundary-driven: content scrolls until its top (dragging down) or bottom
(dragging up) boundary, then the sheet itself follows the finger continuously and settles to the
nearest detent by velocity. No rubber-band overscroll inside sheets. The keyboard dismisses as
soon as the sheet starts moving. Detents: low / medium / full where useful.

**Scripture-only themes.** Colour presets style the reading surface only (Scripture background,
text, verse numbers, Strong's) through reader-scoped custom properties; system Light / Dark and
every other surface (sheets, lists, bars, Notes, Search, Settings) are independent. Any
combination is valid (System Light + Black Scripture, System Dark + Sepia).
