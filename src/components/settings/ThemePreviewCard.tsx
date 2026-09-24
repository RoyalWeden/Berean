import React from 'react'

/**
 * A tiny "what reading looks like" card drawn from a theme's own colors (T23-033): the
 * background fill, a line of sample Scripture in the text color, and the verse number in the
 * accent color. Pure inline styles so it previews a theme that is NOT the one applied to <html>.
 * Shared by the iPhone preset picker and the desktop ThemePicker / Theme settings section.
 */
export function ThemePreviewCard({ background, text, accent, width = 112, height = 44, className, style }: {
  background: string; text: string; accent: string
  width?: number | string; height?: number | string
  className?: string; style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden',
        width, height, padding: '0 8px', borderRadius: 8, boxSizing: 'border-box',
        background, color: text,
        boxShadow: `inset 0 0 0 1px ${text}26`,
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 11, lineHeight: 1.3,
        ...style,
      }}
    >
      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        <sup style={{ color: accent, fontWeight: 700, fontFamily: 'system-ui, sans-serif', fontSize: 8, marginRight: 2 }}>1</sup>
        In the beginning God created the heaven and the earth.
      </span>
    </span>
  )
}
