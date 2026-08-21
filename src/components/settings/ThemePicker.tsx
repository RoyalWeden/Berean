import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  THEME_PRESETS, resolvePresetClass, presetFamilies, type ThemePresetDef, type AnimationStyle,
} from '@/lib/themePresets'

const ANIMATION_STYLE_LABEL: Record<AnimationStyle, string> = {
  drift: 'Drift', pulse: 'Pulse', shimmer: 'Shimmer', particles: 'Particles', flicker: 'Flicker',
}

/** Hover-preview styling for one animation style, sped up and boosted from the real in-app
 *  amounts so the motion is actually visible at a ~150px card size — see the CSS comment on
 *  .theme-card-anim-preview in global.css for why pulse/flicker need their own keyframe. */
function animPreviewStyle(style: AnimationStyle, accent: string): CSSProperties {
  switch (style) {
    case 'drift':
      return {
        background: `radial-gradient(circle at 18% 22%, rgb(${accent} / 0.32), transparent 55%), radial-gradient(circle at 82% 78%, rgb(${accent} / 0.26), transparent 55%)`,
        backgroundSize: '160% 160%',
        animationName: 'theme-anim-drift', animationDuration: '6s', animationDirection: 'alternate',
      }
    case 'shimmer':
      return {
        background: `linear-gradient(115deg, transparent 35%, rgb(${accent} / 0.4) 50%, transparent 65%)`,
        backgroundSize: '300% 300%',
        animationName: 'theme-anim-shimmer', animationDuration: '2.6s',
      }
    case 'particles':
      return {
        backgroundImage: `radial-gradient(circle, rgb(${accent} / 0.5) 1.5px, transparent 1.5px), radial-gradient(circle, rgb(${accent} / 0.4) 1px, transparent 1px), radial-gradient(circle, rgb(${accent} / 0.45) 1.2px, transparent 1.2px)`,
        backgroundSize: '90px 90px, 60px 60px, 75px 75px',
        backgroundPosition: '10% 20%, 70% 60%, 40% 85%',
        animationName: 'theme-anim-particles', animationDuration: '5s', animationTimingFunction: 'linear',
      }
    case 'pulse':
      return {
        background: `radial-gradient(circle at 50% 40%, rgb(${accent} / 1), transparent 60%)`,
        animationName: 'theme-anim-pulse-preview', animationDuration: '2.2s',
      }
    case 'flicker':
      return {
        background: `radial-gradient(circle at 50% 45%, rgb(${accent} / 1), transparent 58%)`,
        animationName: 'theme-anim-flicker-preview', animationDuration: '1.4s',
      }
  }
}

/**
 * Dedicated full-screen theme picker — a separate overlay from Settings → Appearance rather than
 * a small inline swatch grid, per the original ask ("turns into its own menu and shows the image
 * things of the different themes a little more descriptively"). Grouped by family, with a real
 * mini reader mock-up per card (not just a flat color swatch) so each theme's actual reading feel
 * is visible at a glance. A handful of the new muted/pastel themes carry a very slow, low-
 * amplitude ambient background animation (see .theme-anim-bg in global.css) — flagged here with a
 * small sparkle badge, and previewed live on hover/selection via the same class.
 */
export default function ThemePicker({
  onClose,
  theme,
  previewVariant,
  setPreviewVariant,
}: {
  onClose: () => void
  theme: 'dark' | 'light' | 'system'
  previewVariant: 'dark' | 'light'
  setPreviewVariant: (v: 'dark' | 'light') => void
}) {
  const themePreset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)

  // "Animated" is a pseudo-family (cuts across the real families) so the handful of themes with
  // the ambient background drift are easy to find as a group, not just spottable one card at a
  // time via the sparkle badge.
  const families = useMemo(() => ['All', ...presetFamilies(), 'Animated'], [])
  const [activeFamily, setActiveFamily] = useState('All')

  const visible = activeFamily === 'All'
    ? THEME_PRESETS
    : activeFamily === 'Animated'
      ? THEME_PRESETS.filter((p) => p.animationStyle)
      : THEME_PRESETS.filter((p) => p.family === activeFamily)

  function selectPreset(preset: ThemePresetDef) {
    if (!preset.id) { setThemePreset(''); return }
    if (theme === 'system') setThemePreset(preset.id)
    else setThemePreset(resolvePresetClass(preset, previewVariant))
  }

  function isActive(preset: ThemePresetDef) {
    return themePreset === preset.id || themePreset === `${preset.id}-dark` || themePreset === `${preset.id}-light`
  }

  const isSystemAccentActive = themePreset === 'system-accent'
  const systemAccent = systemAccentColor ?? THEME_PRESETS[0].dark.accent

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-[20000] flex flex-col bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex flex-col flex-1 min-h-0 max-w-5xl w-full mx-auto my-6 rounded-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[rgb(var(--color-surface-3))] flex-shrink-0">
          <div>
            <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Themes</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))]">{THEME_PRESETS.length} presets — pick one to apply it instantly</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Always shown now, even when the app's own color mode is "system" — previewVariant
                is purely which palette the CARDS simulate, independent of what mode the app is
                actually in. It used to be hidden for theme==='system', which combined with
                ThemeCard's old "diagonal split, no content" fallback for that same case meant
                every card showed a plain gradient rectangle with nothing on it at all for anyone
                using System mode (likely most people) — reported as "none of the themes are
                showing in the preview... just shows the basic thing". ThemeCard now always
                renders the full mock-up using previewVariant; there's no content-less fallback
                left to need hiding this behind. */}
            <div className="flex items-center rounded-full border border-[rgb(var(--color-surface-4))] p-0.5 text-xs">
              {(['dark', 'light'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPreviewVariant(v)}
                  className={`px-2.5 py-1 rounded-full capitalize cursor-pointer transition-colors ${
                    previewVariant === v ? 'bg-[rgb(var(--color-accent))] text-white' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Family filter chips */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-[rgb(var(--color-surface-3))] flex-shrink-0 overflow-x-auto">
          {families.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFamily(f)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                activeFamily === f
                  ? 'bg-[rgb(var(--color-accent))] text-white'
                  : 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Card grid. Settings' Radix Dialog stays open underneath (so you can back out to the
            rest of Appearance), which would normally scroll-lock this too — this picker has to
            portal straight to document.body itself (Dialog.Content is translate()'d for
            centering, which would break position:fixed's full-viewport coverage if nested
            inside it), and Radix's lock/aria-hide otherwise targets every OTHER document.body
            child, including this one. SettingsModal.tsx drops Dialog.Root's `modal` prop for
            exactly this window instead of working around it here with a manual scroll
            handler — see that file's own comment on `modal={!themePickerOpen}`. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((preset) => (
              <ThemeCard
                key={preset.id || 'default'}
                preset={preset}
                previewVariant={previewVariant}
                active={isActive(preset)}
                onSelect={() => selectPreset(preset)}
              />
            ))}

            {/* "System" preset — live macOS accent color, not a static swatch */}
            {activeFamily === 'All' && (
              <ThemeCard
                preset={THEME_PRESETS[0]}
                previewVariant={previewVariant}
                active={isSystemAccentActive}
                overrideAccent={systemAccent}
                overrideLabel="System accent"
                onSelect={() => setThemePreset(isSystemAccentActive ? '' : 'system-accent')}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ThemeCard({
  preset, previewVariant, active, onSelect, overrideAccent, overrideLabel,
}: {
  preset: ThemePresetDef
  previewVariant: 'dark' | 'light'
  active: boolean
  onSelect: () => void
  overrideAccent?: string
  overrideLabel?: string
}) {
  const colors = previewVariant === 'dark' ? preset.dark : preset.light
  const bg = colors.bg
  const accent = overrideAccent ?? colors.accent
  const text = colors.text
  const label = overrideLabel ?? preset.label

  return (
    <button
      onClick={onSelect}
      title={label}
      className={`group text-left rounded-xl border p-1.5 transition-all cursor-pointer ${
        active
          ? 'border-[rgb(var(--color-accent))] ring-2 ring-[rgb(var(--color-accent))/50]'
          : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-text-muted))]'
      }`}
    >
      {/* Mini APP mock-up — a small non-clickable replica of Berean's actual shell (sidebar
          rail, tab bar, panel header, reading content with a Strong's chip and a button), not
          just a couple of gray bars. Per feedback that the plain-text-lines version didn't show
          "what it would look like" — this is the whole look, at a glance, one level down from
          a real screenshot. Every piece here is decorative (the card itself is the one real
          button); nothing inside is individually clickable. */}
      <div className="relative h-40 rounded-lg overflow-hidden flex">
        {/* Sidebar rail */}
        <div className="w-7 flex-shrink-0 flex flex-col items-center gap-2 pt-2.5" style={{ background: `rgb(${bg})`, borderRight: `1px solid rgb(${text} / 0.08)` }}>
          <div className="w-3.5 h-3.5 rounded-md" style={{ background: `rgb(${accent})` }} />
          <div className="w-3.5 h-3.5 rounded-md" style={{ background: `rgb(${text} / 0.18)` }} />
          <div className="w-3.5 h-3.5 rounded-md" style={{ background: `rgb(${text} / 0.18)` }} />
          <div className="w-3.5 h-3.5 rounded-md" style={{ background: `rgb(${text} / 0.18)` }} />
        </div>

        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* This theme's own curated animation style — hover-triggered, using the SAME
              keyframes the real .theme-anim-bg effect uses (just sped up/boosted so the motion
              actually registers at card size instead of the real 8-54s near-invisible amounts —
              see animPreviewStyle above). Static until you hover, then it moves. */}
          {preset.animationStyle && (
            <div
              className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 theme-card-anim-preview"
              style={animPreviewStyle(preset.animationStyle, accent)}
            />
          )}

          {/* Tab bar */}
          <div className="h-5 flex items-center gap-1 px-1.5 flex-shrink-0" style={{ background: `rgb(${text} / 0.05)` }}>
            <div className="h-3 px-2 rounded-t flex items-center" style={{ background: `rgb(${bg})` }}>
              <div className="w-6 h-[3px] rounded-full" style={{ background: `rgb(${accent})`, opacity: 0.8 }} />
            </div>
            <div className="w-5 h-[3px] rounded-full" style={{ background: `rgb(${text})`, opacity: 0.25 }} />
          </div>
          {/* Panel header */}
          <div className="h-6 flex items-center gap-1.5 px-2 flex-shrink-0" style={{ background: `rgb(${accent} / 0.10)` }}>
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: `rgb(${accent})` }} />
            <div className="h-[3px] rounded-full" style={{ background: `rgb(${text})`, opacity: 0.4, width: '35%' }} />
          </div>
          {/* Reading content */}
          <div className="flex-1 flex flex-col justify-center px-2.5 py-1.5 gap-1.5" style={{ background: `rgb(${bg})` }}>
            <div className="flex items-center gap-1">
              <span
                className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-bold flex-shrink-0"
                style={{ background: `rgb(${accent})`, color: `rgb(${bg})` }}
              >1</span>
              <div className="h-[3px] rounded-full flex-1" style={{ background: `rgb(${text})`, opacity: 0.65 }} />
              <span className="text-[6px] px-1 rounded-sm font-mono flex-shrink-0" style={{ background: `rgb(${accent} / 0.18)`, color: `rgb(${accent})` }}>H1</span>
            </div>
            <div className="h-[3px] rounded-full" style={{ background: `rgb(${text})`, opacity: 0.5, width: '88%' }} />
            <div className="flex items-center gap-1">
              <span
                className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-bold flex-shrink-0"
                style={{ background: `rgb(${accent})`, color: `rgb(${bg})` }}
              >2</span>
              <div className="h-[3px] rounded-full flex-1" style={{ background: `rgb(${text})`, opacity: 0.35 }} />
            </div>
            <div
              className="mt-1 self-start px-2.5 py-1 rounded-full text-[9px] font-medium"
              style={{ background: `rgb(${accent})`, color: `rgb(${bg})` }}
            >
              Button
            </div>
          </div>
        </div>
        {preset.animationStyle && (
          <div
            className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/35 backdrop-blur-sm"
            title={`${ANIMATION_STYLE_LABEL[preset.animationStyle]} animation when this theme is active — hover to preview`}
          >
            <Sparkles size={9} className="text-white" />
            <span className="text-[8px] font-medium text-white leading-none">{ANIMATION_STYLE_LABEL[preset.animationStyle]}</span>
          </div>
        )}
        {active && (
          <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-white/95 flex items-center justify-center">
            <Check size={10} style={{ color: `rgb(${accent})` }} strokeWidth={3} />
          </div>
        )}
      </div>
      <p className={`mt-1.5 px-0.5 text-[11px] font-medium truncate ${active ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-secondary))]'}`}>
        {label}
      </p>
    </button>
  )
}
