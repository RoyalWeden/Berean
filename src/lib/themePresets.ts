// Single source of truth for every preset theme — palette data, family grouping, and the
// preset <-> CSS-class resolution logic. Used by SettingsModal.tsx (inline appearance section),
// ThemePicker.tsx (the dedicated full picker overlay), and App.tsx (which applies/removes the
// resulting class on <html>). Previously this array plus a second hand-maintained list of class
// names + a NATURALLY_DARK set lived duplicated across SettingsModal.tsx and App.tsx — with 37
// presets now (up from 15), keeping those in sync by hand was exactly the kind of place a typo
// silently breaks one theme. Everything downstream is now derived from this one array.

/**
 * Ambient background animation styles — see the .theme-anim-bg block in global.css for each
 * one's actual keyframes. Every style stays low-amplitude/non-distracting at every intensity
 * tier (see AnimationIntensity below); they differ in MOTION CHARACTER, not in how prominent
 * they're allowed to get.
 *   drift     — two soft color blobs slowly wander (the original/default effect)
 *   pulse     — a single soft glow slowly brightens and dims in place, no movement
 *   shimmer   — a faint diagonal light sweep passes across occasionally, like light on water
 *   particles — a handful of tiny, faint motes drift slowly (direction set per theme)
 *   flicker   — small, fast, irregular glow variation, like distant candlelight
 */
export type AnimationStyle = 'drift' | 'pulse' | 'shimmer' | 'particles' | 'flicker'

/** Preset intensity tiers a user picks in Settings — replaces a raw opacity/speed slider with
 *  named levels, each just a multiplier applied on top of every style's base parameters. */
export type AnimationIntensity = 'subtle' | 'noticeable' | 'bold'

export interface ThemePresetDef {
  id: string
  label: string
  natural: 'dark' | 'light'
  /** Which picker group this theme is shown under. */
  family: string
  /** This theme's curated, mood-matched ambient animation — always available for this theme
      (independent of the global "any theme" animation toggle in Settings, which uses `drift` by
      default for a theme that doesn't have one of its own). Always off under
      prefers-reduced-motion regardless of source. */
  animationStyle?: AnimationStyle
  dark: { bg: string; accent: string; text: string }
  light: { bg: string; accent: string; text: string }
}

export const THEME_PRESETS: ThemePresetDef[] = [
  { id: '',               label: 'Default',  natural: 'dark',  family: 'Classic',
    dark:  { bg: '17 17 20',    accent: '100 120 220', text: '230 230 238' },
    light: { bg: '245 245 248', accent: '80 100 200',  text: '20 20 28'   } },

  // ── Vibrant ──
  { id: 'theme-neon',     label: 'Neon',     natural: 'dark',  family: 'Vibrant',
    dark:  { bg: '8 8 14',     accent: '255 0 180',   text: '240 240 255' },
    light: { bg: '250 248 255', accent: '200 0 145',   text: '18 5 35'    } },
  { id: 'theme-terminal', label: 'Terminal', natural: 'dark',  family: 'Vibrant',
    dark:  { bg: '4 10 4',     accent: '0 220 80',    text: '0 255 100'   },
    light: { bg: '238 252 238', accent: '0 155 50',    text: '4 22 4'     } },

  // ── Classic ──
  { id: 'theme-midnight', label: 'Midnight', natural: 'dark',  family: 'Classic',
    dark:  { bg: '6 8 22',     accent: '120 160 255', text: '210 220 255' },
    light: { bg: '238 242 255', accent: '70 105 215',  text: '12 18 55'   } },
  { id: 'theme-obsidian', label: 'Obsidian', natural: 'dark',  family: 'Classic',
    dark:  { bg: '12 10 14',   accent: '140 100 220', text: '230 225 240' },
    light: { bg: '248 246 252', accent: '108 72 188',  text: '22 16 35'   } },
  { id: 'theme-slate',    label: 'Slate',    natural: 'dark',  family: 'Classic',
    dark:  { bg: '14 16 18',   accent: '100 180 230', text: '220 228 235' },
    light: { bg: '238 242 246', accent: '52 132 182',  text: '16 26 36'   } },

  // ── Nature ──
  { id: 'theme-forest',   label: 'Forest',   natural: 'dark',  family: 'Nature',
    dark:  { bg: '8 14 10',    accent: '80 195 110',  text: '210 240 215' },
    light: { bg: '238 252 240', accent: '38 145 62',   text: '6 28 10'    } },
  { id: 'theme-ocean',    label: 'Ocean',    natural: 'dark',  family: 'Nature',
    dark:  { bg: '6 14 22',    accent: '30 200 190',  text: '200 235 240' },
    light: { bg: '232 248 252', accent: '12 148 142',  text: '6 28 42'    } },
  { id: 'theme-arctic',   label: 'Arctic',   natural: 'light', family: 'Nature',
    dark:  { bg: '8 20 30',    accent: '28 175 198',  text: '200 228 242' },
    light: { bg: '234 242 248', accent: '20 160 180',  text: '15 35 50'   } },

  // ── Rich & Warm ──
  { id: 'theme-royal',    label: 'Royal',    natural: 'dark',  family: 'Rich & Warm',
    dark:  { bg: '12 8 22',    accent: '218 170 50',  text: '240 228 200' },
    light: { bg: '252 248 235', accent: '165 115 15',  text: '28 18 52'   } },
  { id: 'theme-ember',    label: 'Ember',    natural: 'dark',  family: 'Rich & Warm',
    dark:  { bg: '16 10 6',    accent: '240 140 30',  text: '248 230 200' },
    light: { bg: '255 248 238', accent: '195 92 8',    text: '48 22 6'    } },

  // ── Scripture & Parchment ──
  { id: 'theme-bible',    label: 'Bible',    natural: 'light', family: 'Scripture & Parchment',
    dark:  { bg: '26 18 8',    accent: '195 132 52',  text: '228 212 182' },
    light: { bg: '240 232 210', accent: '130 80 30',   text: '55 35 15'   } },
  { id: 'theme-sand',     label: 'Sand',     natural: 'light', family: 'Scripture & Parchment',
    dark:  { bg: '30 22 10',   accent: '205 142 48',  text: '232 218 192' },
    light: { bg: '238 228 210', accent: '190 110 30',  text: '60 40 20'   } },
  { id: 'theme-dawn',     label: 'Dawn',     natural: 'light', family: 'Scripture & Parchment',
    dark:  { bg: '24 12 5',    accent: '228 118 48',  text: '250 225 205' },
    light: { bg: '255 245 238', accent: '200 95 40',   text: '55 30 15'   } },

  // ── Soft Light ──
  { id: 'theme-rose',     label: 'Rose',     natural: 'light', family: 'Soft Light',
    dark:  { bg: '26 10 18',   accent: '215 88 128',  text: '248 215 230' },
    light: { bg: '252 240 244', accent: '180 60 100',  text: '55 20 35'   } },
  { id: 'theme-ivory',    label: 'Ivory',    natural: 'light', family: 'Soft Light',
    dark:  { bg: '18 16 28',   accent: '148 118 208', text: '232 228 245' },
    light: { bg: '250 248 245', accent: '110 85 175',  text: '35 30 45'   } },

  // ── Muted & Pastel (new) ──
  { id: 'theme-sage',       label: 'Sage',        natural: 'light', family: 'Muted & Pastel',
    light: { bg: '236 241 232', accent: '107 142 99',  text: '40 54 38'   },
    dark:  { bg: '24 30 24',    accent: '140 180 130', text: '214 226 210' } },
  { id: 'theme-lavender',   label: 'Lavender',    natural: 'light', family: 'Muted & Pastel',
    light: { bg: '240 236 248', accent: '141 120 196', text: '45 36 60'   },
    dark:  { bg: '26 22 34',    accent: '176 152 224', text: '224 214 238' } },
  { id: 'theme-blush',      label: 'Blush',       natural: 'light', family: 'Muted & Pastel',
    light: { bg: '250 238 238', accent: '196 120 132', text: '60 32 36'   },
    dark:  { bg: '32 20 22',    accent: '224 150 160', text: '240 214 216' } },
  { id: 'theme-fog',        label: 'Fog',         natural: 'light', family: 'Muted & Pastel',
    light: { bg: '236 239 242', accent: '108 132 150', text: '34 40 46'   },
    dark:  { bg: '20 23 26',    accent: '150 178 196', text: '214 222 228' } },
  { id: 'theme-linen',      label: 'Linen',       natural: 'light', family: 'Muted & Pastel',
    light: { bg: '245 240 230', accent: '150 124 90',  text: '50 42 32'   },
    dark:  { bg: '26 23 18',    accent: '200 176 140', text: '232 224 208' } },
  { id: 'theme-mist',       label: 'Mist',        natural: 'light', family: 'Muted & Pastel', animationStyle: 'shimmer',
    light: { bg: '232 244 242', accent: '78 158 150',  text: '24 50 46'   },
    dark:  { bg: '16 28 26',    accent: '120 196 186', text: '206 232 228' } },
  { id: 'theme-dune',       label: 'Dune',        natural: 'light', family: 'Muted & Pastel',
    light: { bg: '244 236 220', accent: '176 132 70',  text: '56 42 24'   },
    dark:  { bg: '28 22 14',    accent: '214 176 120', text: '236 222 196' } },
  { id: 'theme-powder',     label: 'Powder',      natural: 'light', family: 'Muted & Pastel', animationStyle: 'pulse',
    light: { bg: '232 240 248', accent: '96 140 192',  text: '26 38 54'   },
    dark:  { bg: '16 22 32',    accent: '140 180 220', text: '210 222 238' } },
  { id: 'theme-clay-dust',  label: 'Clay Dust',   natural: 'light', family: 'Muted & Pastel',
    light: { bg: '246 234 226', accent: '186 110 80',  text: '58 32 24'   },
    dark:  { bg: '30 20 16',    accent: '216 148 120', text: '240 220 208' } },
  { id: 'theme-willow',     label: 'Willow',      natural: 'light', family: 'Muted & Pastel',
    light: { bg: '238 240 224', accent: '122 140 80',  text: '40 44 26'   },
    dark:  { bg: '20 24 14',    accent: '168 188 120', text: '220 228 198' } },
  { id: 'theme-periwinkle', label: 'Periwinkle',  natural: 'light', family: 'Muted & Pastel', animationStyle: 'particles',
    light: { bg: '236 236 250', accent: '120 128 208', text: '36 36 64'   },
    dark:  { bg: '20 20 36',    accent: '160 168 232', text: '216 216 244' } },
  { id: 'theme-oat',        label: 'Oat',         natural: 'light', family: 'Muted & Pastel',
    light: { bg: '244 238 224', accent: '164 140 96',  text: '52 44 30'   },
    dark:  { bg: '26 22 16',    accent: '206 184 140', text: '234 224 204' } },
  { id: 'theme-thistle',    label: 'Thistle',     natural: 'light', family: 'Muted & Pastel',
    light: { bg: '244 234 238', accent: '172 110 140', text: '54 32 42'   },
    dark:  { bg: '28 20 24',    accent: '210 150 178', text: '238 216 226' } },
  { id: 'theme-seafoam',    label: 'Seafoam',     natural: 'light', family: 'Muted & Pastel', animationStyle: 'drift',
    light: { bg: '228 244 238', accent: '70 168 144',  text: '20 50 42'   },
    dark:  { bg: '14 28 24',    accent: '120 204 178', text: '202 234 222' } },
  { id: 'theme-chalk',      label: 'Chalk',       natural: 'light', family: 'Muted & Pastel',
    light: { bg: '240 240 242', accent: '130 134 150', text: '40 40 46'   },
    dark:  { bg: '22 22 25',    accent: '172 176 192', text: '220 220 228' } },
  { id: 'theme-apricot',    label: 'Apricot',     natural: 'light', family: 'Muted & Pastel',
    light: { bg: '248 236 222', accent: '206 132 74',  text: '58 36 20'   },
    dark:  { bg: '30 22 14',    accent: '232 164 110', text: '244 222 200' } },
  { id: 'theme-wisteria',   label: 'Wisteria',    natural: 'dark',  family: 'Muted & Pastel',
    dark:  { bg: '24 18 30',    accent: '170 140 200', text: '220 208 236' },
    light: { bg: '244 238 248', accent: '128 100 168', text: '46 36 58'   } },
  { id: 'theme-slate-dust', label: 'Slate Dust',  natural: 'dark',  family: 'Muted & Pastel',
    dark:  { bg: '18 20 24',    accent: '140 158 178', text: '210 216 224' },
    light: { bg: '236 238 240', accent: '96 116 138',  text: '34 38 44'   } },
  { id: 'theme-moth',       label: 'Moth',        natural: 'dark',  family: 'Muted & Pastel',
    dark:  { bg: '22 20 18',    accent: '178 160 136', text: '220 214 204' },
    light: { bg: '240 236 228', accent: '128 110 86',  text: '42 36 28'   } },
  { id: 'theme-dusk-rose',  label: 'Dusk Rose',   natural: 'dark',  family: 'Muted & Pastel', animationStyle: 'flicker',
    dark:  { bg: '26 18 20',    accent: '200 130 146', text: '232 210 214' },
    light: { bg: '246 236 238', accent: '158 90 108',  text: '52 30 34'   } },
  { id: 'theme-heather',    label: 'Heather',     natural: 'dark',  family: 'Muted & Pastel',
    dark:  { bg: '22 20 26',    accent: '156 144 190', text: '218 212 232' },
    light: { bg: '240 238 246', accent: '108 98 148',  text: '40 36 52'   } },
  { id: 'theme-ash-sage',   label: 'Ash Sage',    natural: 'dark',  family: 'Muted & Pastel', animationStyle: 'particles',
    dark:  { bg: '18 22 20',    accent: '140 166 148', text: '210 220 212' },
    light: { bg: '236 240 236', accent: '90 120 100',  text: '34 42 36'   } },
]

/** Preset ids whose base (unsuffixed) class targets dark mode — everything else is light-natural. */
export const NATURALLY_DARK_IDS = new Set(
  THEME_PRESETS.filter((p) => p.id && p.natural === 'dark').map((p) => p.id)
)

/** Every concrete CSS class a preset (in either variant) can resolve to — for clearing on <html>. */
export const ALL_PRESET_CLASSES: string[] = THEME_PRESETS.flatMap((p) => {
  if (!p.id) return []
  return p.natural === 'dark' ? [p.id, `${p.id}-light`] : [p.id, `${p.id}-dark`]
})

/** Ids of presets with a curated signature animation (either variant). */
export const ANIMATED_PRESET_IDS = new Set(THEME_PRESETS.filter((p) => p.animationStyle).map((p) => p.id))

/** id -> curated animation style, for presets that have one. */
export const PRESET_ANIMATION_STYLE: Record<string, AnimationStyle> = Object.fromEntries(
  THEME_PRESETS.filter((p): p is ThemePresetDef & { animationStyle: AnimationStyle } => !!p.animationStyle)
    .map((p) => [p.id, p.animationStyle])
)

// Derive the CSS class to apply for a given preset + variant
export function resolvePresetClass(preset: ThemePresetDef, variant: 'dark' | 'light'): string {
  if (!preset.id) return '' // Default: clear preset
  // If requesting the preset's natural mode, use the base class (backward compat)
  if (variant === preset.natural) return preset.id
  // Otherwise append -dark or -light
  return `${preset.id}-${variant}`
}

export function presetFamilies(): string[] {
  const seen: string[] = []
  for (const p of THEME_PRESETS) {
    if (p.id && !seen.includes(p.family)) seen.push(p.family)
  }
  return seen
}
