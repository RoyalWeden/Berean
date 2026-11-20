# Study preview alignment and content checkpoint

2026-11-19, source1f4e7361. Latest runtime and CI in HANDOFF.

## Behavior

- Chapter metadata uses tag / related-passages symbols, not a generic note symbol. A mention or tag does not establish an attached note. Chapter actions focus the chapter, not the previously selected verse.
- Attached-note count, outgoing-passage count and mentions in other notes are separate. Mention-only clicks open My Notes references directly.
- Margin hover resolves up to3 actual cited passages from the attached verse note, with its title. LXX uses reader number mapping and keeps superscriptions with opening text.
- Resolve before showing so loading does not move the card. Native firstRect→screen→window→content conversion anchors it; no manually mixed flipped-coordinate offsets. Cancel stale tasks and dismiss on scroll/rebuild/pointer exit/click.
- Native text keeps intrinsic vertical size (max5lines per passage) so ordinary short verses are complete. Combined Psalm115 partial-record requests and broader ranges/editions remain an audit gate.

## Actual evidence

Disposable GEN.1.1 note0c0ed7f5-06c2-487d-a05e-da94032710d8 cited John3:16 and Psalm3:1LXX. Final native card displayed the entire John verse through everlasting life, and Psalm title+O Lord… through many rise up against me. At top and slight scroll, arrows aligned to their margin target. Scroll dismissed the card. Geometry screenAnchor equaled its window/content round trip exactly, including after scroll; final[340,1901,12,23], popover[352,1659,388,342], key window true. JSON retained /private/tmp/berean-study-preview-final-geometry.json.

CUA cannot hover. Opt-in DEBUG development QA Option-click (--qa-library --qa-study-preview) exercises the same rendering/anchor and records numeric geometry. This does NOT verify sustained physical hover timing or all display/window states. Final installed runtime has diagnostics OFF. Source rebuild + regular click tests also verified mention-only Cross Refs and chapter Notes access.

Final Mac/iOS builds pass. Shared package unchanged; previous274tests and de4c37f4 CI green remain baseline. Own note recoverably trashed and extra tab closed; all original note hashes/timestamps, IDs and tag tables unchanged. Live Mac Notes/Genesis1:1/scroll0.5782918149466192/sidebar239 restored; iPhone Psalm3LXX retained. VoiceOver, physical hover, resize/multi-screen/Retina/long previews and full iPhone annotation matrix remain open.
