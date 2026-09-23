import { createPortal } from 'react-dom'
import { useAppStore } from '@/store'
import { selectionLabel, selectionKind } from '@/lib/verseSelection'

/**
 * The range badge that follows the pointer while a verse-number drag is in progress (TEST-001):
 * "Genesis 1:3–7 · 5 verses". Together with the selected-row treatment it makes the range being
 * built obvious before the pointer is released. Mounted once by each shell.
 */
export default function VerseDragIndicator() {
  const drag = useAppStore((s) => s.verseDrag)
  const sel = useAppStore((s) => (s.verseDrag ? s.selectedVersesByTab[s.verseDrag.tabId] : undefined))
  if (!drag || !drag.pointer || !sel?.length) return null
  const count = sel.length
  const text = `${selectionLabel(sel)}${selectionKind(sel) === 'range' ? ` · ${count} verses` : ''}`
  const x = Math.min(drag.pointer.x + 16, window.innerWidth - 220)
  const y = Math.max(drag.pointer.y - 36, 8)
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="verse-drag-indicator fixed z-menu pointer-events-none px-2.5 py-1 rounded-control text-footnote font-semibold text-white bg-accent shadow-lg"
      style={{ left: x, top: y }}
    >
      {text}
    </div>,
    document.body,
  )
}
