# iPhone material system (iOS design system)

Source of truth for the phone shell's translucent materials, radii and surfaces. Tokens and
classes live at the end of `src/mobile/mobile.css` ("iOS material system"). Added 2026-09-24
after developer feedback that Floating Search felt busy and the sheets / chrome did not feel
iOS-native or glassy enough.

## References and stance

- Apple HIG: Materials, Sheets, Toolbars, Search fields; iOS 26 "Liquid Glass" (translucent
  floating controls, toolbars that float over content, sheets with large corner radii).
- Liquid Glass drew legibility criticism (NN/G, "Liquid Glass Is Cracked, and Usability Suffers
  in iOS 26"), and Apple itself added a more "frosted"/tinted option in iOS 26.1. Berean is a
  reading app, so the system is deliberately **restrained**: frosted, fairly dense materials,
  never clear glass over body text; blur only where content actually scrolls underneath.
- Reduce Transparency (Settings → Accessibility → Display & Text Size) makes system bars fully
  opaque; we do the same.

## Tokens (`:root`, dark overrides on `html.scheme-dark`)

| Token | Value (regular glass) | Use |
|---|---|---|
| `--m-glass-filter` | `saturate(glass-saturate × 1.25) blur(26px × glass-blur)` | all glass |
| `--m-glass-filter-thin` | same, 16px blur | thin glass |
| `--m-glass-thin` / `-regular` / `-thick` | surface-2 at α 0.62 / 0.76 / 0.88 (× `--glass-alpha-mult`, capped) | bars, headers |
| `--m-glass-sheet` | surface-1 (light) / surface-2 (dark) at α 0.86 | sheets |
| `--m-glass-control` | surface-3 at α 0.72 | floating controls (bottom nav) |
| `--m-bar-bg` | surface-2 at α 0.97 | in-flow page headers |
| `--m-card-bg` | white cards (light); surface-2 lifted 10 % toward text (dark) | grouped cards |
| `--m-fill` / `--m-fill-pressed` | text-primary at 7 % / 12 % (dark 10 / 16 %) | search fields, chips, segmented track |
| `--m-hairline`, `--m-separator` | text-primary at 10 % / 8 % | borders, list separators |
| `--m-edge-highlight` | white at 10 % (dark 7 %) | inset 0.5px top edge on glass |
| `--m-radius-sheet` / `-card` / `-control` / `-field` | 30 / 16 / 12 / 12 px | |
| `--m-shadow-float`, `--m-shadow-sheet`, `--m-backdrop-dim` | soft; dim 0.3 (dark 0.45) | |

Alphas multiply the shared `--glass-alpha-mult` / `--glass-blur` / `--glass-saturate` knobs, so
Settings → Glass appearance (clear / regular / tinted) retunes the phone too.

Utility classes: `.m-glass`, `.m-glass-thick`, `.m-glass-thin`, `.m-glass-control`,
`.m-glass-card`.

## Where used

- **Sheets** (`.mobile-sheet`): sheet glass + blur, 30px top radius, inset top highlight,
  hairline + soft shadow; 36×5 grabber at 22 % text; dim backdrop.
- **Grouped cards** (`.mobile-list-group`, `.mobile-caret-group-body`, `.mobile-choice-list`,
  `.mobile-caret-tile`, `.mobile-action-row`): `--m-card-bg`, 16px radius, hairline separators,
  pressed fill. Pages and sheets share the same card treatment (iOS inset-grouped).
- **Page headers**: in-flow headers use the near-opaque `--m-bar-bg` + hairline (nothing scrolls
  beneath them, and backdrop-filter during nav-stack pushes costs frames). The reader's overlay
  header is real glass (`--m-glass-regular` + blur), since the text scrolls under it.
- **Bottom navigation**: iOS 26 toolbar style — the bar has no fill; tabs (48pt circle), plus
  (112×48 capsule, accent glyph, the largest) and caret (48pt circle) float as individual glass
  controls. Over the reader a faint surface gradient keeps them legible. Padding / overlay /
  collapse remain in `reader/readerChrome.css`.
- **Search fields** (`.mobile-search-field`, `.mobile-search-row`): filled rounded field
  (`--m-fill`, 12px radius), no border.
- **Chips / segmented**: fill-based; selected segment is a raised card (light) or 20 % text
  (dark); selected chip is accent.
- **Tab cards**: 16px radius, hairline ring + float shadow, thick-glass header.

## Floating Search (NewTabSheet)

Field (auto-focus, clear button) → one grouped row of 8 icon-only 44pt destinations (Scripture,
Note, Today, Lexicon, History, YouTube, Settings, More; VoiceOver labels + tooltips) → Recent as
an inset-grouped list (5, then "Show All" up to 30). Typing replaces the lower part with an
inset-grouped action list, primary action first (Enter runs it). No Compare, no Workspaces.

## Accessibility

- **Reduce Transparency**: `@media (prefers-reduced-transparency: reduce)` and
  `html[data-reduce-transparency]` redefine every material token to its opaque surface and set
  the filters to `none`. WebKit on iOS does not reliably report the media query, so the native
  a11y bridge (`BereanA11yPlugin`, observing `reduceTransparencyStatusDidChangeNotification`)
  reports `reduceTransparency`, and `MobileApp.tsx` sets `html[data-reduce-transparency]`.
- **Increase Contrast** (`prefers-contrast: more` / `html[data-contrast="more"]`): materials go to
  α ≥ 0.97, hairlines/separators use text-muted at 60 % / 45 %, grouped cards and fields get a
  1px ring.
- Text sits on materials of α ≥ 0.72 over a blurred backdrop; primary text keeps the theme's
  contrast. Touch targets stay ≥ 44pt. Reduce Motion drops the press-scale on nav controls.

## Action sheets and context menus

Every `ActionList` / `actionListView` reads as one iOS inset-grouped menu: contiguous rows with
hairline separators, rounded only at the group ends; a `cancel` action stands apart as its own
centred row; rows that push a sub-view show a chevron. Search result long-press menus use this.

## Compact passage header (collapsed Scripture header)

A black shape that merges with the device cutout: island devices get a 999px capsule under the
island (top 11pt), notch devices a shape hanging from the notch with 32pt lower corners; a small
pill on home-button devices. The band behind it is the opaque reader surface fading out over its
last 8px — it never blurs, so the status area stays one colour.

**Screenshot limitation:** iOS screenshots do not draw the Dynamic Island or notch hardware, so a
captured image shows the black shape standing alone. An app cannot change what the system
screenshot captures (the screenshot notification fires after the capture), so this is accepted.

## Scripture chrome (2026-09-25)

Reader and Compare share one header: no bar — Scripture stays visible around a floating glass
passage capsule (translucent surface, saturate + blur backdrop, hairline edge, top specular line;
opaque under Reduce Transparency, ringed under Increase Contrast). The status-bar area is a solid
band in the Scripture background colour with a 12 px fade (never a blur, so no halo next to the
island / notch). Scrolling down swaps it for the island / notch pill and slides the bottom
controls away. The capsule has no outer drop shadow: WKWebView draws an outer shadow under a
backdrop-filtered element as a square (checked in the simulator).

Glass placement: floating controls (capsule, bottom controls), sheets, bars. Never Scripture text,
never cards around Scripture.

## Scripture colour themes (2026-09-25)

Presets colour the reading surface only (`--scripture-bg / -text / -verse-num / -strongs`, plus
`-rgb` triples) through one injected style scoped to `.mobile-reader`, `.m-compare` and the
Scripture page roots, gated by `html[data-scripture-theme]`. The app keeps its Default Light /
Dark palette (`applyMobileAppearance`). Custom themes add optional verse-number and Strong's
colours (derived when unset).

## Floating controls over Scripture (2026-09-25 v2)

Floating controls that sit over Bible text (tab switcher options, the audio play/pause) use a
thicker material (surface at ~90 % with the blur) than resting bar controls, so a label or glyph
never competes with the words behind it. Backdrop-filtered circles use a hairline + inset
highlight, never an outer drop shadow (WKWebView renders it as a square). Opening the switcher
dims the page slightly (14 % light / 32 % dark) to separate the fan from the text.

## Open items

- None blocking. Glass strength and the notch shape need a look on a physical device.
