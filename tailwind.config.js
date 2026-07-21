/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
    './electron/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          1: 'rgb(var(--color-surface-1) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
          3: 'rgb(var(--color-surface-3) / <alpha-value>)',
          4: 'rgb(var(--color-surface-4) / <alpha-value>)'
        },
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)'
      },
      fontFamily: {
        // Native OS font stack by default — matches the 'system' UI font option in
        // Settings, which is also the app default (App.tsx's NATIVE_FONT_STACK).
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
        serif: ['Georgia', 'ui-serif', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      borderRadius: {
        panel: '8px',
        shell: '14px',
        'shell-lg': '20px'
      },
      boxShadow: {
        glass: '0 1px 0 0 rgb(var(--color-surface-4) / 0.4) inset, 0 8px 30px -8px rgb(0 0 0 / 0.45)'
      },
      backdropBlur: {
        glass: '20px'
      }
    }
  },
  plugins: []
}
