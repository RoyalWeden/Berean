# Berean Liquid Glass

How Berean uses Apple's Liquid Glass on macOS and iPhone. React says **what** it needs; a
platform adapter decides **how** it is drawn. Native APIs are the source of truth; CSS is the
fallback. Last verified 2026-10-04 (Xcode 27.0, macOS 27.0 SDK, iOS 27.0 SDK, Electron 32.3.3,
Capacitor 8, macOS 27.0 host, iPhone 17 Pro simulator on iOS 27).

```
                    Berean UI (React)
                          │
        src/platform/liquidGlass  — semantic API
   useLiquidGlassSurface · LiquidGlassGroup · useLiquidGlassControls
                          │
      ┌───────────────────┼────────────────────┐
    macOS               iPhone                other
  window.app.glass   window.__bereanGlass     CSS materials
  electron/liquidGlass.ts  src/platform/ios/liquidGlass.ts   (src/styles/glass.css)
  native/mac-liquid-glass  BereanGlassPlugin.swift
  NSGlassEffectView         UIGlassEffect (interactive)
  NSGlassEffectContainerView UIGlassContainerEffect
  NSVisualEffectView (<26)  UIBlurEffect thin material (<26)
```

## 1. Apple APIs verified against the installed SDKs

| API | Header | Availability | Used for |
|---|---|---|---|
| `NSGlassEffectView` — `contentView`, `cornerRadius`, `tintColor`, `style` (`Regular`/`Clear`) | AppKit/NSGlassEffectView.h | macOS 26 | sidebar pane |
| `NSGlassEffectView.effectIsInteractive` | same | **macOS 27** | supported, off for panes |
| `NSGlassEffectContainerView` — `contentView`, `spacing` | same | macOS 26 | `LiquidGlassGroup` |
| `UIGlassEffect` — `style`, `isInteractive`, `tintColor` | UIKit/UIGlassEffect.h | iOS 26 | every native control |
| `UIGlassContainerEffect` — `spacing` | same | iOS 26 | one container per control cluster |
| `UIView.cornerConfiguration` / `UICornerConfiguration.capsule()` | UIKit/UICornerConfiguration.h | iOS 26 | capsule / circle controls |

Public API only: AppKit classes are looked up at runtime (`NSClassFromString`) so the module also
loads on macOS 12–25, where it uses `NSVisualEffectView`. There are no private selectors and no
QuartzCore parameters. The guard test is `src/components/shell/__tests__/liquidGlassShell.test.ts`.

## 2. What the investigation found (and why the architecture looks like this)

**Root cause of "the vibrancy never showed".** The main window was already transparent with
`vibrancy: 'sidebar'`, but the page painted an opaque `body` at first paint. Chromium keeps the
first page background it sees as the `RenderWidgetHostViewCocoa` layer colour. After that, no CSS
change (not even `*{background:transparent!important}`) made the window see-through. A bare
transparent window with a transparent first paint showed native glass correctly. The fix is that
`body` is transparent at first paint in every window. Opaque windows get their ground once
`main.tsx` stamps `html[data-window]`.

**Z-order.** Berean's controls and content live in **one** Chromium view, and glass shows what is
behind it.

- **macOS: glass behind the page.** The page leaves that region transparent and draws its own
  crisp controls on top. Input never reaches native views (clicks, keys, scroll, drag, text
  selection, context menus, VoiceOver), and web menus, popovers and modals stay above it. This
  was verified with the Settings dialog dimming the pane.
  - Glass placed *above* the page would blur the React controls under it, so it is only right for
    native content.
- **iPhone: native controls above the WKWebView.** Their glass genuinely refracts the Scripture
  scrolling underneath. Touches pass through everywhere except on a control
  (`PassthroughView` / `PassthroughEffectView`).
  - Web overlays render inside the web view, so a native control hides whenever its web
    placeholder is not the topmost element at its centre (`document.elementFromPoint`).
  - That rule covers every sheet, popover, scrim and menu without special cases. The placeholder
    then becomes visible again, so a control is never lost.

**Window geometry.** The main window has 16pt corners, measured from the running window. Attaching
an empty unified `NSToolbar` was tried: it does not change the radius, and it changes the title-bar
height (900 → 952 pt window), so it was rejected. Tokens: window 16 → pane inset 6 → concentric
pane radius 10.

**Appearance.** Native views follow the *window's* appearance. Berean's Light / Dark / System
setting now drives `nativeTheme.themeSource` (`app:setThemeSource`), so glass, vibrancy, menus,
dialogs and scrollbars match a dark Berean on a light Mac. iOS clusters take `appearance` from
`html.dark`.

## 3. Surface audit

| Surface | Platform | Before | Now | Why |
|---|---|---|---|---|
| Sidebar | macOS | 75% grey CSS over an opaque page (vibrancy invisible) | **Native `NSGlassEffectView` pane**, floating, inset 6, radius 10, full height (traffic lights + toggle on it), pinned autoresizing, in-flow React content on top | navigation layer; macOS 26/27 sidebar pattern |
| Sidebar toggle | macOS | glass circle straddling the pane edge | plain icon at the pane's trailing edge; glass circle only when collapsed | no glass-on-glass |
| Toolbar groups | macOS | CSS capsules with internal dividers; nav group straddled the pane edge | CSS capsules, **no internal dividers**, nav group starts in the content toolbar | content does not scroll under Berean's toolbar, so there is nothing to refract; a behind-page glass capsule would show the desktop instead of the content; a native `NSToolbar` was rejected (title-bar change) |
| Scripture / notes / lexicon / search text | both | content | **content, never glass** | content layer |
| Scripture side panel (inspector) | macOS | attached flat inspector | unchanged (`material-inspector`) | long-form study text; behind-page glass would show the desktop under lexicon text |
| Floating rail, formatting bar, popovers, menus, sheets | macOS | CSS materials | unchanged CSS | they float over web content; behind-page native glass cannot show that content |
| Modals / dialogs | macOS | web | web, above the native pane | input and z-order preserved |
| Bottom navigation (tab cards · + · caret) | iPhone | CSS glass buttons | **Native**: interactive `UIGlassEffect` buttons in one `UIGlassContainerEffect` (spacing 12); tab count on the front card; + accent-tinted; slides away on scroll, hides with the keyboard, hides under sheets | top-level navigation; refracts the text beneath |
| Passage title capsule | iPhone | CSS glass | **Native** labelled capsule (fits its label; never truncates) | Scripture control over text |
| Tab-type (grid) button | iPhone | CSS glass | **Native** circle; its menu/scrim leaves it above, as before | top-level navigation |
| Page header circles, sheets, popover menus, search field | iPhone | CSS | unchanged CSS | per-page / in-sheet web UI; hidden when needed by the occlusion rule |
| iPad | — | — | **not applicable** (`TARGETED_DEVICE_FAMILY = 1`, iPhone only) | adding iPad is a product/App Store change, not part of this pass |

## 4. Semantic API

```ts
useLiquidGlassSurface(ref, { role: 'sidebar', variant: 'regular', pin: { top, bottom, left } })
<LiquidGlassGroup spacing={8}>…members…</LiquidGlassGroup>          // native container
useLiquidGlassControls('bottom-nav', [{ id, ref, symbol, label, badge, title, prominent, onPress }],
                       { role: 'navigation', collapsed, onSwipe })  // native control cluster
```

- **Roles:** sidebar, toolbar, navigation, floating, popover, inspector, control, custom. A role
  drives geometry (`roleRadius`: controls are capsules from their height; panes are concentric),
  the fallback material and accessibility.
- **Regular** is the default; **Clear** is reserved for rich media.
- **Interactive** glass is used only on the iPhone's primary navigation controls.
- **Tint** is used only for the + control's symbol.

**Capability detection is centralised** in `capabilities.ts`: `native`, `liquidGlass`,
`grouping`, `interactive`, plus live Reduce Transparency and Increase Contrast. Those two come from
`html[data-reduce-transparency|data-increase-contrast]`, stamped by the platform shell. The module
stamps `html[data-native-glass="glass|material"]`. Components never check OS versions.

## 5. Fallbacks

| Condition | macOS | iPhone |
|---|---|---|
| macOS 26+ / iOS 26+ | NSGlassEffectView / UIGlassEffect | — |
| older OS | NSVisualEffectView (sidebar material) | thin-material blur |
| bridge missing (`build/native/berean_glass.node` absent, `BEREAN_NATIVE_GLASS=0`) | the pane hole shows the window's own vibrancy | the web controls stay visible (placeholders are only hidden while native draws them) |
| bridge throws at runtime | disabled for the session; `glass:disabled` → CSS | — |
| not the main window / not macOS | opaque CSS sidebar, unchanged | — |

## 6. Lifecycle (verified)

**macOS**
- The surface is created on mount and destroyed on sidebar collapse, focus mode and window
  `close`. 10 rapid collapse/expand cycles left exactly 1 native view.
- Live resize is tracked by autoresizing pins: a 1100×700 window gave a 688pt pane (700 − 2×6).
- Light/dark follows the app theme.
- The inactive window desaturates natively.

**iPhone**
- A cluster is created and updated per render and removed on unmount.
- Controls hide under the tab-cards sheet, the passage picker, scrims and the keyboard, and
  return afterwards.
- Scroll-collapse slides natively (92pt) and disables input; scrolling back up restores both.
- Native presses run the same React handlers (debug-build `__bereanGlassDebug(press)` fires the
  real `touchUpInside`).
- Dark mode, Increase Contrast and XXL Dynamic Type were exercised in the simulator.

**iPhone hand-off rules (2026-10-05)** — the fixes for "glass appears late" and "a button
disappears":
- **First paint gate.** No native control is sent before the web view has painted
  (`afterFirstPaint()` in `react.tsx`). Before this, glass drawn over the still-blank web view
  sampled a black backdrop, rendered dark, then re-tinted grey → light as Scripture appeared.
  The bridge controller also gives the window and web view `systemBackground` instead of black.
- **Native fades in; the placeholder hides last.** New clusters (alpha 0 → 1, 0.24 s) and new
  items (0.16 s) fade in. A web placeholder turns invisible only after the bridge call resolved
  AND the fade finished (`NATIVE_FADE_MS`). Before this it hid on the same frame React decided
  "native", so neither control was visible while the native one was created or fading in.
  Covered → web is immediate: the native control fades out over a visible placeholder.
- **Cluster frame.** Only items with a real rect form the cluster's frame (a hidden item's zero
  rect used to stretch it to the screen origin).
- **Pressed state.** A press is a tint over the same material (`--m-glass-control-pressed`),
  glass controls keep one compositing layer (`will-change: transform`), and native glass is not
  clipped (`clipsToBounds` only for the pre-26 blur fallback).

### iPhone material system (2026-10-06)

| Layer | Implementation | Pressed | Selected | Reduce Transparency |
|---|---|---|---|---|
| Bottom bar (tab cards · + · caret), passage capsule, tab-type grid | **Native** `UIGlassEffect` (interactive) in `UIGlassContainerEffect` clusters | UIKit's own interactive glass response | accent symbol (+) | system |
| Other floating controls (back, header circles, joined capsules, compose / insert FABs, sheet ✕, audio, picker history) | **Web glass**: `--m-glass-control` + `--m-glass-filter` + hairline rim + specular edge | ONE recipe (`mobile.css` "ONE interactive Liquid Glass recipe"): same material + inner light bloom + brighter edge + 1.06 swell; items inside a joined capsule light up inside it (no glass on glass) | accent-tinted glass (`.is-active`, `.is-open`) | opaque surface fallbacks |
| Prominent (Done ✓) | accent-tinted glass | accent + bloom + swell | — | — |
| Menus (`PopoverMenu`) | web glass panel anchored to its control, rows highlight inside | row highlight | check column | opaque surface |
| Sheets (`Sheet.tsx`) | below full height: **floating** — inset 8pt, radius 34, lighter glass, page visible around it; full height: attached, more opaque | — | — | opaque surface |
| Content controls (list rows, chips, cells, tab cards) | not glass — row highlights | row highlight | — | — |

Why web glass for most controls: they live in WKWebView content (headers, sheets, menus) whose
layout, safe areas, keyboard and occlusion React already owns; native views above the web view are
used only for the persistent navigation layer, where UIKit's interactive glass is the real thing.
Root cause of "glass disappears when pressed" (fixed): scattered per-control `:active` rules — flat
tints, opaque `surface-4` fills, a solid accent, a second glass fill inside joined capsules — not a
renderer problem (there is no WebGL / per-button renderer). `src/mobile/__tests__/glassPressRecipe.test.ts`
guards the recipe.

## 7. Performance

- **macOS Scripture scroll, 2 s continuous:** median 13.3 ms per frame (display refresh), p95
  14.0 ms, 1 frame over 20 ms. The pane is a static native view with no per-frame IPC.
- **iPhone:** the native views sit outside the web view's scroll path. Each cluster re-syncs only
  when its spec changes. Inputs are DOM mutations, resize, transitions and a 350 ms safety tick
  that costs three `elementFromPoint` reads.
- **WebGL glass:** not used. `@liquid-glass/react` was evaluated and rejected: WebGL2 only, no live
  DOM backdrop (it needs an image, or html2canvas for DOM), and essentially unmaintained. The
  native adapters cover every surface that needs glass.

## 8. Build & packaging

- `npm run build` and `npm run dev` compile the bridge on macOS:
  `node scripts/mac/build-native.mjs glass`, universal arm64 + x86_64. Non-macOS skips it.
- The bridge ships in DMG (`build.mac.extraResources`) and MAS (`build.mas.extraResources`).
  `verify-mas.mjs` checks that it is signed.
- The iOS plugin lives in `ios/App/BereanNative`, registered in `BereanBridgeViewController.swift`.

## 9. Known limits

- **macOS toolbar items remain React (CSS) controls.** True refraction of web content needs
  native controls above the page (an `NSToolbar` model) and a title-bar change; that trade-off was
  measured and deferred.
- **Reduce Transparency was not toggled:** that would change this Mac's or the simulator's
  system-wide settings. The native classes adapt by themselves (an Apple behaviour); the CSS
  fallbacks follow `html[data-reduce-transparency]`.
- **VoiceOver focus order** across native and web controls needs a physical-device pass. Native
  controls carry the labels, and their placeholders are `aria-hidden` while native.
- **Simulator automation cannot test a real finger hit-test or the swipe gesture recogniser**;
  those need the physical iPhone.
