// Renders a keyboard-shortcut label ("⌘⇧R", "↑↓", "⌘K / ⌘L", "Ctrl+Tab") as a row of
// small, uniform, roughly-square keycaps — one per key — instead of a single long
// pill of run-together glyphs (⌘⇧R read as one squished, oddly-kerned blob with no
// per-key separation, and every combo was a different length/shape depending on how
// many characters happened to be in it). Individual symbol/letter keys ("⌘", "T")
// render as true 1:1 squares; multi-letter word keys ("Esc", "Ctrl") stay a touch
// wider to fit their label, same as a physical keyboard's Shift/Ctrl keys being
// wider than a letter key — still a uniform row of rounded caps, just not literally
// square for those.
//
// The modifier/navigation glyphs (⌘⇧⌥⌃↵ + arrows) render via real SF Symbol icons
// (SFIcon.tsx, bundled PNGs from src/assets/icons/sf) instead of the raw unicode
// character — those render inconsistently across fonts/renderers and looked notably
// different from macOS's own native keycap glyphs. Plain letter/digit/punctuation
// keys ("T", "1", ",") stay as text — there's no icon for a letter, it's already
// just a letter. This is deliberately scoped to ONLY these ~11 shortcut glyphs, not
// a general app icon-library swap — see plan snappy-meandering-orbit.md.
import SFIcon from './SFIcon'
import { SF_ICONS } from '@/assets/icons/sf'

// The backtick is in the punctuation class because the notes editor's inline-code mark
// binds ⌘` — without it that shortcut tokenized to a lone ⌘ keycap and the actual key
// silently vanished from the hint.
const KEY_TOKEN_RE = /[⌘⇧⌥⌃↵↑↓←→]|[A-Za-z0-9,./`–]+/g

const KEY_ICON_MAP: Record<string, keyof typeof SF_ICONS> = {
  '⌘': 'command',
  '⇧': 'shift',
  '⌥': 'option',
  '⌃': 'control',
  '↵': 'return',
  '↑': 'arrow.up',
  '↓': 'arrow.down',
  '←': 'arrow.left',
  '→': 'arrow.right',
}

function Keycap({ children }: { children: string }) {
  const iconName = KEY_ICON_MAP[children]
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] font-mono text-[10px] leading-none">
      {iconName ? <SFIcon name={iconName} size={9} /> : children}
    </kbd>
  )
}

export default function ShortcutKeys({ keys, className = '' }: { keys: string; className?: string }) {
  // "⌘K / ⌘L" — alternative bindings for the same action, kept as separate keycap
  // groups joined by "or" rather than tokenized together into one confusing row.
  const alternatives = keys.split(' / ')
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {alternatives.map((alt, ai) => {
        const trimmed = alt.trim()
        // A descriptive label with real words and spaces in it ("Search icon") isn't
        // a key combo at all — keep it as ONE keycap holding the whole phrase instead
        // of exploding it into one square per word.
        const isPhrase = /\s/.test(trimmed)
        const tokens = isPhrase ? null : trimmed.match(KEY_TOKEN_RE)
        return (
          <span key={ai} className="inline-flex items-center gap-1">
            {ai > 0 && <span className="text-[9px] text-[rgb(var(--color-text-muted))]">or</span>}
            {tokens && tokens.length > 0 ? (
              tokens.map((tok, ti) => <Keycap key={ti}>{tok}</Keycap>)
            ) : (
              <Keycap>{trimmed}</Keycap>
            )}
          </span>
        )
      })}
    </span>
  )
}
