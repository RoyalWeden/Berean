// Read-only presentational glyph for a note's page icon (Note.icon — a single emoji, see
// types/index.ts). Falls back to a generic page glyph when unset so every title surface (list
// row, board card) reserves a consistent icon slot instead of the row's title shifting
// left/right depending on whether an icon happens to be set. Purely display — the only
// interactive/editable rendering lives in NotesPanel.tsx's editor header (a plain `<input>`
// styled as a small button, not this component; see that file for why).
import { NotepadText } from 'lucide-react'

export default function NoteIcon({ icon, size = 14, className = '' }: { icon?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 leading-none select-none ${className}`}
      style={{ fontSize: size, width: size + 4, height: size + 4 }}
      aria-hidden={!icon}
    >
      {icon || <NotepadText size={size} />}
    </span>
  )
}
