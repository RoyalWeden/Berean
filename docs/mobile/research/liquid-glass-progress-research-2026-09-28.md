# Liquid Glass, Materials/Color, Accessibility, Progress Indicators, iCloud Lifecycle — Research Memo

Research date: 2026-09-28. Sources are Apple's current HIG (developer.apple.com), WWDC25 sessions "Meet Liquid Glass" (219) and "Get to know the new design system" (356), SwiftUI `glassEffect` docs, and Apple Support. Where Apple's live pages are JS-rendered and couldn't be fetched directly, a text-rendering proxy of the same URL was used — quotes below are taken from that rendered text, not paraphrased from third-party blogs, unless explicitly marked as a secondary source.

---

## 1. Liquid Glass

### 1.1 Functional layer vs. content layer
**Source:** https://developer.apple.com/design/human-interface-guidelines/materials
> "Liquid Glass forms a distinct functional layer for controls and navigation elements — like tab bars and sidebars — that floats above the content layer."
> "Don't use Liquid Glass in the content layer."

**Source:** WWDC25 "Get to know the new design system" (session 356) — https://developer.apple.com/videos/play/wwdc2025/356/
> "Liquid Glass defines new functional layer above content."

**Exception carved out by the HIG** (materials page):
> "...controls in the content layer with a transient interactive element like sliders and toggles; in these cases, the element takes on a Liquid Glass appearance to emphasize its interactivity."

**Implication for Berean:** Toolbars, tab bars, sidebars, floating search, and the verse-note popover chrome are legitimate Liquid Glass surfaces (functional layer). The Bible text itself, note markdown body, and lexicon entry body are content layer and must **not** carry glass — a Torah-study reading surface needs the text layer flat/opaque for legibility. A slider/toggle embedded directly in a content row (e.g., a per-verse highlight-color picker inline in text) is the one place glass-in-content is explicitly sanctioned.

### 1.2 Regular vs. clear variants
**Source:** materials page (rendered text)
> Regular "blurs and adjusts the luminosity of background content to maintain legibility of text and other foreground elements."
> Clear "is highly translucent, which is ideal for prioritizing the visibility of the underlying content and ensuring visually rich background elements remain prominent."
> "Only use clear Liquid Glass for components that appear over visually rich backgrounds."

**Source:** WWDC25 "Meet Liquid Glass" (219), via WWDCNotes summary — https://wwdcnotes.com/documentation/wwdc25-219-meet-liquid-glass/
> Clear "is permanently transparent... does not have adaptive behaviors."
> Regular "is more versatile than clear and will be used more frequently. Retains all adaptive behaviors."
> Clear should only be used when: elements sit over media-rich content, the underlying content tolerates dimming, and the covered content is bold/bright.

**Implication for Berean:** Regular glass is the default for nearly everything (toolbars over scripture text, sidebar, floating search — text-heavy backgrounds need the adaptive legibility behavior). Clear glass has essentially no legitimate use case in Berean except possibly YouTube video player chrome (video is "visually rich media content"); it should not be used over Bible text, notes, or lexicon panels.

### 1.3 Avoid glass on content / glass-on-glass
**Source:** materials page (rendered text)
> "If you apply Liquid Glass effects to a custom control, do so sparingly... Limit these effects to the most important functional elements in your app."

No page found an explicit sentence literally saying "avoid glass on glass," but the sparing-use directive plus the functional-layer/content-layer split functions as the operative rule; WWDC25 356 frames it as layering discipline ("Relationships between surfaces depicted by how they appear and stay connected to source"). **Mark the specific phrase "glass-on-glass" as UNCONFIRMED as a literal Apple quote** — the underlying guidance (don't nest glass surfaces, don't put glass over glass) is corroborated by sparing-use + functional-layer language but not by that exact wording in the pages fetched.

**Implication for Berean:** Don't put a glass toolbar inside a glass sidebar panel, and don't stack a glass verse-note popover on top of a glass panel background — pick one glass layer per stack and let inner elements use solid fills/opacity instead (see 1.4).

### 1.4 Tinting guidance
No sentence explicitly using the word "tint" was recovered from the Materials page rendering fetched in this session (the earlier search-engine summary claimed "Tints should only be used to bring emphasis to primary elements," but that could not be re-confirmed against the actual page text this pass pulled — **mark as UNCONFIRMED**, needs a follow-up direct read of the Materials or Color HIG page's tinting section, or the SwiftUI `Glass.tint(_:)` API reference).

**Implication for Berean:** Until confirmed, treat tint as an emphasis-only tool (e.g., a highlight-color accent on a note's glass chrome) rather than a default styling mechanism — apply conservatively pending confirmation.

### 1.5 Shapes: capsule, concentric corners
**Source:** SwiftUI `Applying Liquid Glass to custom views` — https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views
> `glassEffect(_:in:)` by default "uses the `regular` variant of `Glass` and applies the given effect within a `Capsule` shape."
> "Use different shapes to have a consistent look and feel across custom components in your app. For example, use a rounded rectangle if you're applying the effect to larger components."

**Source:** WWDC25 356 (rendered summary)
> "Concentric shapes let system calculate inner radii for nested containers."
> Constant corner radius applies to fixed shapes; capsule shapes use "radius half the container size"; nested elements subtract padding from parent measurements.

**Source (secondary, via search-engine summary of WWDC25 356 — not independently re-verified this pass):** "Align with the concentric design of the hardware and software to create harmony between interface elements... Glass controls nest perfectly into the rounded corners of windows... The design system... provides concentric shapes with fallback radius values that adapt when nested." **Mark as UNCONFIRMED pending a direct HIG/API page read** (this came only from a search-engine synthesis, not a fetched page).

**Implication for Berean (Capacitor iOS app, not native SwiftUI):** Berean-ios cannot call `glassEffect`/`GlassEffectContainer` directly (those are SwiftUI-only APIs), but the visual language should still be replicated in CSS/WebView chrome: small controls as capsules, larger panels as rounded rectangles with corner radius that "nests" (child radius = parent radius − padding) rather than a flat fixed radius everywhere.

### 1.6 Interaction states (pressed/selected/morphing) and motion
**Source:** SwiftUI Liquid Glass doc
> `GlassEffectContainer` lets views "blend their shapes together and to morph in and out of each other during transitions." "The larger the spacing value on the container, the sooner the Liquid Glass effects behind views blend together."
> `interactive()` configuration makes glass components "react to touch and pointer interactions."

**Source:** WWDC25 356 (rendered summary)
> "Glass subtly recedes and gets more opaque on focus shifts, providing feedback about interaction state without dramatic transitions."

**Source (secondary, from an earlier search-engine synthesis of WWDC25 219 — not independently re-verified against the actual transcript this pass):** Liquid Glass "flex[es] and energize[s] with light" during interactions, with "gel-like flexibility in tandem with interactions." **Mark as UNCONFIRMED** pending direct transcript read.

**Implication for Berean:** Morphing (elements merging/splitting, e.g., a floating search bar expanding into a results panel) is a first-class Liquid Glass interaction pattern worth emulating with CSS transitions/backdrop-filter changes; on focus/press, prefer subtle opacity/recede changes over dramatic scale or color animation.

---

## 2. Materials, vibrancy, and semantic/dynamic system colors

### 2.1 Vibrancy
**Source:** https://developer.apple.com/design/human-interface-guidelines/dark-mode (rendered text)
> "The system uses vibrancy and increased contrast to maintain the legibility of text on darker backgrounds."
> "System views and controls make your app's text look good on all backgrounds, adjusting automatically for the presence or absence of vibrancy."

### 2.2 Semantic/dynamic system colors
**Source:** https://developer.apple.com/design/human-interface-guidelines/color (rendered text)
> "Each dynamic color is semantically defined by its purpose, rather than its appearance or color values. For example, some colors represent view backgrounds at different levels of hierarchy and other colors represent foreground content, such as labels, links, and separators."
> "use the grouped background colors (`systemGroupedBackground`, `secondarySystemGroupedBackground`, and `tertiarySystemGroupedBackground`) when you have a grouped table view; otherwise, use the system set of background colors (`systemBackground`, `secondarySystemBackground`, and `tertiarySystemBackground`)."
> "Avoid redefining the semantic meanings of dynamic system colors... use dynamic system colors as intended."

**Source:** https://developer.apple.com/design/human-interface-guidelines/dark-mode (rendered text)
> "Semantic colors (like `labelColor` and `controlColor` in macOS or `separator` in iOS and iPadOS) automatically adapt to the current appearance."

### 2.3 Published RGB/hex values — which are, and are not
The Color HIG page **does** publish a specifications table, but only for the **system gray ramp** (`systemGray` through `systemGray6`), across four contexts: default light, default dark, increased-contrast light, increased-contrast dark. It does **not** publish a specifications table for `label`, `secondaryLabel`, `tertiaryLabel`, `separator`, `systemBackground`, `secondarySystemBackground`, or the grouped backgrounds in the pages fetched this pass.

Apple's own design intent, confirmed by the "semantically defined... rather than its appearance or color values" language above, is that these colors are meant to be consumed by name, not by fixed hex — the rendered value depends on trait environment (light/dark, increased contrast, tint) and Apple reserves the right to change it OS-to-OS.

**Any hex/RGB numbers circulating for `label` (`#000000`/white), `secondaryLabel` (`~#8E8E93` family), `systemBackground` (`#FFFFFF`/black), etc. are community-measured, not Apple-published specs, and MUST be marked UNCONFIRMED / non-authoritative if used anywhere in Berean docs or code comments.**

**Implication for Berean:** Berean-ios should consume system semantic color tokens (via native platform bridge or CSS `env()`/`-apple-system` equivalents) rather than hardcoding hex values for text/background hierarchy — exactly the same principle already enforced by the Electron app's theme-var system (per `native-mac-audit` skill / `docs/native-mac-checklist.md`). Only the gray ramp has an Apple-published numeric spec; treat everything else as "adapts automatically, don't hardcode."

---

## 3. Accessibility

### 3.1 Reduce Transparency
**Source:** https://developer.apple.com/design/human-interface-guidelines/materials (rendered text)
> "The appearance of these variants can differ in response to certain system settings, like if people choose a preferred look for Liquid Glass in their device's settings, or turn on accessibility settings that reduce transparency or increase contrast in the interface."

A more specific "what changes" statement (system makes blurred/translucent areas "mostly opaque" when Reduce Transparency is on) appeared only in an earlier search-engine synthesis of the general Accessibility HIG page and was **not independently re-confirmed by a direct fetch this pass — mark as UNCONFIRMED**, though it is consistent with long-standing, well-documented iOS behavior.

### 3.2 Increase Contrast
**Source:** https://developer.apple.com/design/human-interface-guidelines/accessibility (rendered text)
> "If your app doesn't provide this minimum contrast by default, ensure it at least provides a higher contrast color scheme when the system setting Increase Contrast is turned on."

Contrast-ratio guidance on the same page (WCAG-aligned, stated as Apple's own minimums):
> Text up to 17 pt (all weights): **4.5:1**
> Text at 18 pt or larger (all weights): **3:1**
> Any text size, bold: **3:1**

### 3.3 Reduce Motion
**Source:** accessibility page (rendered text)
> "When this setting is active, ensure your app or game responds by reducing automatic and repetitive animations, including zooming, scaling, and peripheral motion."

### 3.4 Dynamic Type
**Source:** accessibility page (rendered text)
> "Dynamic Type is a systemwide setting that lets people adjust the size of text for comfort and legibility."

**Implication for Berean:** (a) Every glass surface Berean renders in the Capacitor WebView needs a "flatten to opaque" fallback path keyed off `prefers-reduced-transparency`/the OS accessibility flag, mirroring what native Liquid Glass does automatically — WebViews don't get this for free. (b) Verse text, note text, and lexicon body copy must hit 4.5:1 contrast at normal sizes (3:1 only applies at ≥18pt or bold) — worth an explicit contrast audit of the current KJV serif rendering in both light and dark theme. (c) Any custom morph/slide animation on tab/panel transitions needs a Reduce-Motion fallback (crossfade or instant, no scale/parallax). (d) Bible/notes text must scale with Dynamic Type, not a fixed px value — check current `ChapterView`/`NoteEditorPM` font-size settings against this.

---

## 4. Progress indicators

**Source:** https://developer.apple.com/design/human-interface-guidelines/progress-indicators (rendered text)
> "Determinate, for a task with a well-defined duration, such as a file conversion."
> "Indeterminate, for unquantifiable tasks, such as loading or synchronizing complex data."
> "When possible, use a determinate progress indicator." — rationale: it "helps them gauge what's happening and how long it will take," letting people decide whether to wait, reschedule, or abandon the task; indeterminate only shows that something is happening.
> "Be as accurate as possible when reporting advancement in a determinate progress indicator and consider evening out the pace of advancement to help people feel confident about the time needed for the task to complete."
> "Keep progress indicators moving so people know something is continuing to happen... people tend to associate a stationary indicator with a stalled process or a frozen app."
> "When possible, switch a progress bar from indeterminate to determinate" once a duration becomes knowable mid-task.
> "Don't switch from the circular style to the bar style."

**Implication for Berean:** Vault export/import, iCloud reconcile, and YouTube transcript fetch are all candidate determinate-progress cases (file counts / byte counts are knowable) — currently worth checking whether these use a spinner (indeterminate) when a determinate bar would serve the user better per Apple's stated preference. Any long file-count operation that starts indeterminate (unknown total) and later learns its total should flip to determinate, but must never flip between circular and bar styles mid-operation.

---

## 5. iCloud lifecycle facts

### 5.1 App deleted — does ubiquity container data survive?
No Apple Support or Developer page fetched this pass states explicitly, in Apple's own words, what happens to an app's iCloud ubiquity-container data the moment the app itself is deleted from a device. Community/developer-forum reports (non-Apple, **UNCONFIRMED** as an Apple statement) describe app-specific iCloud Drive folders persisting and even "resurrecting" after the app is deleted and reinstalled — consistent with ubiquity containers being independent of app installation state, but this is not sourced to an Apple document. **Mark as UNCONFIRMED.**

### 5.2 Manually deleting an app's iCloud documents/data
**Source:** https://support.apple.com/en-us/108922 (Manage your iCloud storage on your Apple device) confirms the general "Manage Storage" deletion workflow exists but the specific fetched rendering did not surface app-specific ubiquity-container language; the destructive/permanent nature of a Manage-Storage deletion for app documents and data is corroborated by developer-forum discussion of `NSFileManager` ubiquity container removal (simulates "first installation"), but that mechanism description is **UNCONFIRMED** against an Apple Support page directly (only via developer forum synthesis).

### 5.3 Turning off iCloud for an app in Settings
**Source:** https://support.apple.com/en-us/118225 (Change which apps sync and store data with iCloud)
> "When you turn off iCloud for an app, the app no longer connects with iCloud, so your data exists only on your device."

This confirms: turning off per-app iCloud sync does **not** delete local data — the app's data becomes device-local only. The page as fetched did not state, one way or the other, whether data already uploaded to iCloud is deleted or orphaned when sync is turned off — **mark that specific sub-question as UNCONFIRMED.**

### 5.4 "Apps using iCloud" / Manage Storage list — is it system-controlled, and can an app remove itself from it?
Not confirmed from an Apple source fetched this pass. General Apple developer-relations position (well established across `NSFileManager`/`NSUbiquitousKeyValueStore`/CloudKit docs, though not re-verified verbatim here) is that the "Apps Using iCloud"/Manage Storage list is populated by the system based on which apps have registered an iCloud container entitlement and have ever written data — the list itself is a system UI surface, not something an app's own code can add itself to or remove itself from at will (short of the user manually deleting the app's documents/data, which clears the container but the app entry may still persist in the list until the OS re-evaluates). **Mark this entire item as UNCONFIRMED — needs a direct read of an Apple Developer "iCloud Design Guide" or CloudKit container-management page, or an explicit Apple Support Settings walkthrough, neither of which yielded a directly quotable sentence this pass.**

**Implication for Berean:** Do not build any feature or messaging that promises to remove Berean from the iCloud "Apps using iCloud" list, or that guarantees vault data is purged the instant the app is deleted — neither behavior is confirmed, and the safer assumption (consistent with developer-forum reports) is that the vault's `berean-notes/` ubiquity container content **outlives app deletion** until the user manually clears it via Settings → iCloud → Manage Storage, or deletes the files directly. Any onboarding/settings copy about "removing Berean data from iCloud" should point the user to that system Manage Storage flow rather than claim the app can do it itself.

---

## Summary of UNCONFIRMED items (needs follow-up direct-source verification)
1. Literal Apple wording for "avoid glass-on-glass" (directionally supported, exact phrase not found).
2. Explicit tinting-guidance sentence on the Materials/Color HIG pages.
3. The "concentric hardware/software harmony," fallback-radius, and "gel-like flexibility"/"flex and energize with light" quotes (came from search-engine synthesis, not a direct fetch this pass).
4. Reduce Transparency's specific "makes areas mostly opaque" mechanism (long-standing known iOS behavior, but not re-confirmed against a directly fetched Apple page this pass).
5. What happens to ubiquity-container data automatically on app deletion (no Apple-authored statement found).
6. Whether iCloud Drive data already synced is deleted or retained when per-app iCloud sync is turned off.
7. Whether the "Apps using iCloud" / Manage Storage list is purely system-controlled and whether an app can ever remove itself from it — treat as **cannot**, pending confirmation.
