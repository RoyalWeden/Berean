import { SF_ICONS } from '@/assets/icons/sf'

// Renders a bundled SF Symbol PNG as a mono-color glyph via CSS masking (bg-current +
// mask-image) rather than an <img> — the PNG is a plain black shape on a transparent
// background, so masking lets it inherit whatever `text-*` color class the call site
// applies, the same way the ShortcutKeys.tsx keycaps it's used in already pick up
// theme colors. Scoped to the ~11 keyboard-shortcut glyphs in SF_ICONS (⌘⇧⌥⌃↵ + arrows)
// — not a general icon-library replacement, see plan snappy-meandering-orbit.md.
export default function SFIcon({ name, size = 12, className = '' }: { name: keyof typeof SF_ICONS; size?: number; className?: string }) {
  const url = SF_ICONS[name]
  return (
    <span
      aria-hidden="true"
      className={`inline-block flex-shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  )
}
