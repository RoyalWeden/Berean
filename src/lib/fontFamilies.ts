/**
 * Font-family choices (Settings → Display) → CSS. Shared by the desktop App.tsx and the mobile
 * shell — extracted verbatim from App.tsx's font effect.
 */
// The real OS UI font, not a web font — 'system' previously silently mapped to Inter for the
// UI font specifically, while scripture/notes used 'inherit' for the same choice. Both now
// resolve to the same native stack.
export const NATIVE_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'

export const FONT_MAP: Record<string, string> = {
  system:     NATIVE_FONT_STACK,
  serif:      'Georgia, "Times New Roman", Times, serif',
  sansserif:  'Inter, ui-sans-serif, system-ui, sans-serif',
  mono:       '"JetBrains Mono", "Fira Code", "Menlo", monospace',
  garamond:   '"EB Garamond", Garamond, Georgia, serif',
  palatino:   '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  merriweather: '"Merriweather", Georgia, serif',
  lora:       '"Lora", Georgia, serif',
  crimson:    '"Crimson Text", Georgia, serif',
  sourceserif: '"Source Serif 4", Georgia, serif',
  nunito:     '"Nunito", Inter, sans-serif',
}

export function applyFontFamilies(o: { scriptureFontFamily: string; notesFontFamily: string; uiFontFamily: string }): void {
  document.documentElement.style.setProperty('--font-scripture', FONT_MAP[o.scriptureFontFamily] ?? 'inherit')
  document.documentElement.style.setProperty('--font-notes', FONT_MAP[o.notesFontFamily] ?? 'inherit')
  // UI font — applied to body so all chrome (sidebar, settings, tabs) inherits it;
  // scripture and notes sections override it with their own vars.
  const uiFont = o.uiFontFamily === 'system' ? NATIVE_FONT_STACK : (FONT_MAP[o.uiFontFamily] ?? 'inherit')
  document.body.style.fontFamily = uiFont
  document.documentElement.style.setProperty('--font-ui', uiFont)
}
