import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Bold, Italic, List, Link2, MoreHorizontal, Underline, Strikethrough, Heading, Code, SquareCode, Quote, ListOrdered, Check, X, Unlink,
  type LucideIcon,
} from 'lucide-react'
import { Popover, PopoverTrigger, PopoverSurface, MenuItem, Tooltip } from '@/components/ui'
import type { ChatEditorHandle } from './ChatEditor'
import {
  toggleFormatMark, toggleBlock, setLink, linkRangeAt, normalizeHref, type ActiveFormats, type BlockFormat, type MarkFormat,
} from './chatEditorState'

export interface FormatItem {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  isActive: (a: ActiveFormats) => boolean
  run: (editor: ChatEditorHandle) => void
}

const mark = (id: Exclude<MarkFormat, 'link'>, label: string, icon: LucideIcon, shortcut?: string): FormatItem => ({
  id, label, icon, shortcut, isActive: (a) => a[id], run: (e) => { e.run(toggleFormatMark(id)) },
})
const block = (id: BlockFormat, label: string, icon: LucideIcon): FormatItem => ({
  id, label, icon, isActive: (a) => a[id], run: (e) => { e.run(toggleBlock(id)) },
})

export const PRIMARY_ITEMS: FormatItem[] = [
  mark('strong', 'Bold', Bold, '⌘B'),
  mark('em', 'Italic', Italic, '⌘I'),
  block('bullet_list', 'Bulleted List', List),
]
export const MORE_ITEMS: FormatItem[] = [
  mark('underline', 'Underline', Underline, '⌘U'),
  mark('strike', 'Strikethrough', Strikethrough, '⇧⌘X'),
  block('heading', 'Heading', Heading),
  mark('code', 'Inline Code', Code, '⌘E'),
  block('code_block', 'Code Block', SquareCode),
  block('blockquote', 'Quote', Quote),
  block('ordered_list', 'Numbered List', ListOrdered),
]

/** Keeps the editor's focus (and selection) when a toolbar control is pressed. */
const keepFocus = {
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
}

function ToolButton({ label, icon: Icon, shortcut, pressed, onClick, tooltip, size, expanded }: {
  label: string; icon: LucideIcon; shortcut?: string; pressed?: boolean; onClick: () => void; tooltip: boolean; size: number; expanded?: boolean
}) {
  const btn = (
    <button
      type="button"
      className="chat-fmt-btn no-drag"
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      {...keepFocus}
      onClick={onClick}
    >
      <Icon size={size} strokeWidth={pressed ? 2.25 : 1.75} aria-hidden />
    </button>
  )
  return tooltip ? <Tooltip label={label} shortcut={shortcut} side="top">{btn}</Tooltip> : btn
}

/**
 * Formatting controls for the Berean Chat composer: Bold, Italic, Bulleted List, Link and More
 * (Underline, Strikethrough, Heading, Inline Code, Code Block, Quote, Numbered List). Each acts on
 * the selection; with nothing selected a mark is armed for what's typed next and a block format
 * applies to the current line. ⌘K / Link opens a small address field in place of the buttons.
 * Desktop: tooltips with shortcuts and a menu for More. iPhone: larger glyphs; More goes through
 * `onMoreSheet` (the phone action sheet).
 */
export function FormatToolbar({ editor, active, variant, linkOpen, onLinkOpenChange, onMoreSheet, onMenuOpenChange }: {
  editor: RefObject<ChatEditorHandle | null>
  active: ActiveFormats
  variant: 'desktop' | 'phone'
  linkOpen: boolean
  onLinkOpenChange: (open: boolean) => void
  /** iPhone: present the More items as an action sheet. */
  onMoreSheet?: (items: FormatItem[]) => void
  /** Desktop: the More menu opened / closed (the composer keeps the row shown meanwhile). */
  onMenuOpenChange?: (open: boolean) => void
}) {
  const [moreOpen, setMoreOpenState] = useState(false)
  const setMoreOpen = (open: boolean) => { setMoreOpenState(open); onMenuOpenChange?.(open) }
  const desktop = variant === 'desktop'
  const size = desktop ? 15 : 18
  const run = (item: FormatItem) => { if (editor.current) item.run(editor.current) }

  if (linkOpen) return <LinkField editor={editor} onClose={() => onLinkOpenChange(false)} />

  const moreActive = MORE_ITEMS.some((i) => i.isActive(active))
  return (
    <div className="chat-fmt-bar" role="toolbar" aria-label="Formatting" data-variant={variant}>
      {PRIMARY_ITEMS.map((item) => (
        <ToolButton key={item.id} label={item.label} icon={item.icon} shortcut={item.shortcut} pressed={item.isActive(active)} tooltip={desktop} size={size} onClick={() => run(item)} />
      ))}
      <ToolButton label="Link" icon={Link2} shortcut="⌘K" pressed={active.link} tooltip={desktop} size={size} onClick={() => onLinkOpenChange(true)} />
      {desktop ? (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="chat-fmt-btn no-drag" aria-label="More Formatting" aria-haspopup="menu" aria-expanded={moreOpen} aria-pressed={moreActive} {...keepFocus}>
              <MoreHorizontal size={size} strokeWidth={1.75} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverSurface
            side="top" align="start" role="menu" innerClassName="p-1 min-w-[200px]"
            onEscapeKeyDown={(e) => e.stopPropagation()}
            onCloseAutoFocus={(e) => { e.preventDefault(); editor.current?.focus() }}
          >
            {MORE_ITEMS.map((item) => (
              <MenuItem
                key={item.id} role="menuitemcheckbox" icon={item.icon} label={item.label} shortcut={item.shortcut}
                active={item.isActive(active)}
                onClick={() => { setMoreOpen(false); run(item) }}
              />
            ))}
          </PopoverSurface>
        </Popover>
      ) : (
        <ToolButton label="More Formatting" icon={MoreHorizontal} pressed={moreActive} tooltip={false} size={size} onClick={() => onMoreSheet?.(MORE_ITEMS)} />
      )}
    </div>
  )
}

/** The inline address field (⌘K / Link): Return applies, Esc / ✕ closes, Remove unlinks. */
function LinkField({ editor, onClose }: { editor: RefObject<ChatEditorHandle | null>; onClose: () => void }) {
  const state = editor.current?.getState()
  const existing = state ? linkRangeAt(state) : null
  const [value, setValue] = useState(existing?.href ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() }) }, [])
  const close = () => { onClose(); editor.current?.focus() }
  const apply = () => {
    if (!value.trim()) { if (existing) editor.current?.run(setLink(null)); close(); return }
    const href = normalizeHref(value)
    if (!href) { setError('Use a web address (https://…)'); return }
    editor.current?.run(setLink(href))
    onClose()
  }
  return (
    <div className="chat-fmt-bar chat-fmt-link" role="group" aria-label="Link">
      <Link2 size={14} aria-hidden className="text-text-muted flex-none ml-1" />
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="https://"
        aria-label="Link address"
        value={value}
        aria-invalid={!!error}
        onChange={(e) => { setValue(e.target.value); setError(null) }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); apply() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
        }}
      />
      {error && <span className="chat-fmt-link-error" role="alert">{error}</span>}
      {existing && <button type="button" className="chat-fmt-btn" aria-label="Remove Link" {...keepFocus} onClick={() => { editor.current?.run(setLink(null)); onClose() }}><Unlink size={14} aria-hidden /></button>}
      <button type="button" className="chat-fmt-btn" aria-label="Apply Link" {...keepFocus} onClick={apply}><Check size={14} aria-hidden /></button>
      <button type="button" className="chat-fmt-btn" aria-label="Cancel Link" {...keepFocus} onClick={close}><X size={14} aria-hidden /></button>
    </div>
  )
}
