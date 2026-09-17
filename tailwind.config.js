/** @type {import('tailwindcss').Config} */
// Design-system utilities. Every value here is backed by a CSS custom property declared in
// src/styles/global.css (base per-theme vars + the derived semantic layer), so a theme swap
// re-tunes all of them with zero component changes. See docs/design-system.md.
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
    './electron/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // ── Base per-theme triples (support <alpha-value>: bg-surface-4/60, text-accent/80) ──
        surface: {
          1: 'rgb(var(--color-surface-1) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
          3: 'rgb(var(--color-surface-3) / <alpha-value>)',
          4: 'rgb(var(--color-surface-4) / <alpha-value>)'
        },
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
        'red-letter': 'rgb(var(--color-red-letter) / <alpha-value>)',
        // ── Semantic status (scheme-aware triples) ──
        destructive: 'rgb(var(--color-destructive) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        info: 'rgb(var(--color-info) / <alpha-value>)',
        // ── Derived (already full colors — no <alpha-value>) ──
        separator: 'var(--color-separator)',
        border: 'var(--color-border)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-pressed': 'var(--color-surface-pressed)',
        'surface-selected': 'var(--color-surface-selected)',
        'accent-muted': 'var(--color-accent-muted)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-raised': 'var(--color-accent-raised)',
        'accent-pressed': 'var(--color-accent-pressed)',
        'accent-active': 'var(--color-accent-active)',
        'focus-ring': 'var(--color-focus-ring)',
        // ── Interactive glass (M2) + lift scale ──
        control: 'var(--control-bg)',
        'control-hover': 'var(--control-bg-hover)',
        'control-pressed': 'var(--control-bg-pressed)',
        'control-selected': 'var(--control-selected-bg)',
        field: 'var(--control-field-bg)',
        hairline: 'var(--hairline)',
        highlight: 'var(--highlight)',
        'lift-1': 'var(--lift-1)',
        'lift-2': 'var(--lift-2)',
        'lift-3': 'var(--lift-3)',
        'lift-4': 'var(--lift-4)',
        // Feature palettes
        'trail-warm': 'rgb(var(--trail-warm) / <alpha-value>)',
        'trail-cool': 'rgb(var(--trail-cool) / <alpha-value>)',
      },
      fontFamily: {
        // Native OS font stack by default — matches the 'system' UI font option in
        // Settings, which is also the app default (App.tsx's NATIVE_FONT_STACK).
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
        serif: ['Georgia', 'ui-serif', 'serif'],
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
        lemma: ['var(--font-lemma)']
      },
      // Chrome typography scale (macOS-ish). Scripture/Notes bodies use their own settings.
      fontSize: {
        micro: ['var(--text-micro)', { lineHeight: '1.2' }],
        caption2: ['var(--text-caption2)', { lineHeight: '1.3' }],
        caption: ['var(--text-caption)', { lineHeight: '1.35' }],
        footnote: ['var(--text-footnote)', { lineHeight: '1.4' }],
        subhead: ['var(--text-subhead)', { lineHeight: '1.4' }],
        body: ['var(--text-body)', { lineHeight: '1.45' }],
        title3: ['var(--text-title3)', { lineHeight: '1.35' }],
        title2: ['var(--text-title2)', { lineHeight: '1.3' }],
        title1: ['var(--text-title1)', { lineHeight: '1.25' }]
      },
      // macOS 27 radius scale. `shell` / `shell-lg` are legacy aliases kept for migration.
      // macOS 27 radius scale, ROLE-named (Tailwind's own sm/md/lg/xl are left untouched so
      // legacy sites don't shift silently; lanes migrate them to these deliberately).
      // `shell` / `shell-lg` / `panel` are legacy aliases kept for migration.
      borderRadius: {
        chip: 'var(--radius-chip)',
        card: 'var(--radius-card)',
        row: 'var(--radius-row)',
        menu: 'var(--radius-menu)',
        sheet: 'var(--radius-sheet)',
        control: 'var(--radius-control)',
        panel: 'var(--radius-card)',
        shell: 'var(--radius-menu)',
        'shell-lg': 'var(--radius-sheet)'
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        focus: '0 0 0 1.5px rgb(var(--color-surface-1)), 0 0 0 3.5px var(--color-focus-ring)',
        control: 'var(--control-highlight), 0 1px 2px -1px rgb(0 0 0 / 0.25)'
      },
      zIndex: {
        raised: 'var(--z-raised)',
        overlay: 'var(--z-overlay)',
        menu: 'var(--z-menu)',
        popover: 'var(--z-popover)',
        modal: 'var(--z-modal)',
        critical: 'var(--z-critical)'
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)'
      },
      transitionTimingFunction: {
        mac: 'var(--motion-ease)',
        'mac-out': 'var(--motion-ease-out)'
      },
      spacing: {
        'traffic-lights': 'var(--traffic-light-inset)',
        header: 'var(--header-h)'
      }
    }
  },
  plugins: []
}
