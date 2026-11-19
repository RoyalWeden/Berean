# Brenton reader presentation and online witnesses

Checked 2026-11-18. This is an editorial presentation policy, not a database migration.

## Psalm titles and verse 1

Follow the body-first presentation of [Bible Hub's Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm): the superscription and opening body belong to verse 1. Show one verse number at the beginning of that group, a restrained italic superscription aligned with the body, and then the body on its own line. A title must not look like an unrelated unnumbered verse or jump into the gutter when it wraps. Both native readers retain the same underlying selection and annotation identity for this group.

[Bible Hub Psalm 51](https://biblehub.com/sep/psalms/51.htm) similarly joins the two source superscription rows to the opening body. That page uses an MT/KJV chapter heading; its text corresponds to actual LXX Psalm 50. Do not rename LXX chapters to match website navigation headings.

Not all online editions use this presentation: [eBible Psalm 3](https://ebible.org/eng-Brenton/PSA003.htm) numbers the title separately. “Matches online” must name an edition and numbering convention; it must not claim every website agrees.

## Chapter joins, splits, and combined records

Offline regression witnesses in `PsalmSuperscriptionTests.swift` check real bundled body text, reader numbering, and KJV correspondence at these boundaries:

| Actual LXX location | Online Brenton witness | Presentation |
|---|---|---|
| 3:1 | [Bible Hub 3:1](https://biblehub.com/sep/psalms/3.htm) | Title and opening body share verse 1. |
| 9:1 and 9:21 | [Bible Hub 9](https://biblehub.com/sep/psalms/9.htm), [10](https://biblehub.com/sep/psalms/10.htm) | One LXX chapter contains both KJV chapters. |
| 50:1 | [Bible Hub 51:1](https://biblehub.com/sep/psalms/51.htm) | Two source title rows belong to the first body verse. |
| 113:9 | [Bible Hub 115:1](https://biblehub.com/sep/psalms/115.htm) | Second KJV chapter within the combined LXX chapter. |
| 114:1 and 115:1 | [Bible Hub 116](https://biblehub.com/sep/psalms/116.htm) | One KJV chapter spans two LXX chapters. |
| 115:4–5 and 115:6 | [Bible Hub 116:13–15](https://biblehub.com/sep/psalms/116.htm), [eBible 115](https://ebible.org/eng-Brenton/PSA115.htm) | Bundled raw 4 contains both sentences; raw 5 is absent. |
| 146:1 and 147:1 | [Bible Hub 147](https://biblehub.com/sep/psalms/147.htm) | KJV 147:12 starts the second LXX chapter. |

The combined LXX 115 record uses the numeric reader range **4–5**. eBible instead labels the latter sentence **4a**; Bible Hub shows the sentences separately under MT/KJV 116:13–14. This is a documented numeric normalization, not a claim that eBible prints “4–5.” Verse 6 and all stored identifiers stay unchanged. Splitting a bundled row or assigning new persisted IDs is outside this presentation change.

## Quiet numbering information

The reader shows concise secondary metadata, such as “KJV Psalm 51” or “KJV Psalm 116:10–19,” in place of a full explanatory paragraph. Clicking or tapping it opens the full explanation on demand. Structural differences in Esther, Ezra, Proverbs, Sirach, and Baruch retain their existing explanation behind “About this edition.” Jonah 1–2 also identifies the differing chapter boundary. These summaries are not destinations: never navigate to a guessed exact counterpart where only a structural explanation is known.

`ChapterMap.versificationNote` and all legacy golden behavior remain intact; native summary/detail APIs are additive. No stored chapter, verse, link, tag, note, or sync record is renumbered.

## Verification scope

The complete bundled-Psalter test checks all 151 chapters for word order, lossless title folding, stored identities, presentation/reference coherence, and idempotence. The online witness test samples the independently checked boundaries above; it is not a word-for-word comparison of all 151 chapters against a live website. App builds and interactive checks for the new title/metadata presentation must be recorded in HANDOFF before claiming delivery.

Native combined-record cross-reference aggregation is implemented in42d34bbe and verified against both reference sources. Still open: legacy raw-link versus newly typed display-reference compatibility, unverified structural-book alignments, and the larger per-column Compare selection/dragging redesign.
