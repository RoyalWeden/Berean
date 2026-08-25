import { createElement, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import { navigateTrailRef, trailRefOpenFloating, trailRefLabel, type TrailRef } from './trailNav'
import { bookName } from '@/lib/parseRef'

// Shared right-click menu for every chapter/Strong's label in the Study Trail window —
// "Open in new tab" / "Open in floating tab", the same pair VerseRow.tsx and
// BibleRightPanel.tsx already offer for a cross-ref (see those files' indicatorMenu /
// sideCtxMenu popovers), rebuilt here with this window's own inline-style convention since
// those components are tightly coupled to their host's own popover state machine and aren't
// meant to be imported across windows.
export function useTrailRefMenu() {
  return usePositionedMenu<{ ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; topicBreak?: { active: boolean; onToggle: () => void } }>()
}

export function openTrailRefMenu(
  openMenu: (data: { ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; topicBreak?: { active: boolean; onToggle: () => void }; x: number; y: number }) => void,
  ref: TrailRef,
  e: React.MouseEvent,
  onJumpToOrigin?: () => void,
  onDelete?: () => void,
  topicBreak?: { active: boolean; onToggle: () => void },
) {
  e.preventDefault()
  e.stopPropagation()
  openMenu({ ref, onJumpToOrigin, onDelete, topicBreak, x: e.clientX, y: e.clientY })
}

export function TrailRefContextMenu({
  menu, menuRef, onClose,
}: {
  menu: ({ ref: TrailRef; onJumpToOrigin?: () => void; onDelete?: () => void; topicBreak?: { active: boolean; onToggle: () => void } } & { x: number; y: number }) | null
  menuRef: React.RefObject<HTMLDivElement>
  onClose: () => void
}) {
  // Delete needs a second confirming click (no native confirm() — matches the session rail's
  // own inline "Delete? Yes / Cancel" idiom elsewhere in this window) — reset whenever a
  // different menu opens (or closes) so a stale "confirm?" state never carries over.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => { setConfirmingDelete(false) }, [menu])
  if (!menu) return null
  const label = trailRefLabel(menu.ref, bookName)
  // Portaled to document.body — same reason as TrailHoverCard: MapView's zoom feature wraps
  // the spine in `transform: scale(...)`, which makes that ancestor the containing block for
  // `position: fixed` descendants instead of the real viewport.
  return createPortal(createElement('div', {
    ref: menuRef,
    style: {
      position: 'fixed', top: menu.y, left: menu.x, zIndex: 10001, minWidth: 170,
      background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
      borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 5,
    },
  },
    createElement('div', { style: { fontSize: 10.5, color: 'rgb(var(--color-text-muted))', padding: '3px 8px 5px' } }, label),
    createElement('button', {
      className: 'trail-ctx-btn', onClick: () => { navigateTrailRef(menu.ref, false); onClose() },
      style: menuBtnStyle,
    }, 'Open in current tab'),
    createElement('button', {
      className: 'trail-ctx-btn', onClick: () => { navigateTrailRef(menu.ref, true); onClose() },
      style: menuBtnStyle,
    }, 'Open in new tab'),
    createElement('button', {
      className: 'trail-ctx-btn', onClick: () => { trailRefOpenFloating(menu.ref); onClose() },
      style: menuBtnStyle,
    }, 'Open in floating tab'),
    ...(menu.onJumpToOrigin ? [
      createElement('div', { key: 'divider', style: { height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' } }),
      createElement('button', {
        key: 'jump', className: 'trail-ctx-btn', onClick: () => { menu.onJumpToOrigin!(); onClose() }, style: menuBtnStyle,
      }, 'Scroll to where this came from'),
    ] : []),
    // Dedicated topic-break toggle — per direct feedback ("have a button in the study trail to
    // put a break/separate topics"), this doesn't need to go through the "ask why" popup at
    // all; right-click a chapter bullet and toggle it directly.
    ...(menu.topicBreak ? [
      createElement('div', { key: 'topic-divider', style: { height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' } }),
      createElement('button', {
        key: 'topic', className: 'trail-ctx-btn', onClick: () => { menu.topicBreak!.onToggle(); onClose() }, style: menuBtnStyle,
      }, menu.topicBreak.active ? 'Remove topic break' : 'Mark as new topic (break here)'),
    ] : []),
    ...(menu.onDelete ? [
      createElement('div', { key: 'del-divider', style: { height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' } }),
      confirmingDelete
        ? createElement('div', { key: 'del-confirm', style: { display: 'flex', gap: 4, padding: '2px 4px' } },
            createElement('button', {
              className: 'trail-ctx-btn', onClick: () => { menu.onDelete!(); onClose() },
              style: { ...menuBtnStyle, color: '#e08468', flex: 1 },
            }, 'Delete'),
            createElement('button', {
              className: 'trail-ctx-btn', onClick: () => setConfirmingDelete(false),
              style: { ...menuBtnStyle, flex: 1 },
            }, 'Cancel'),
          )
        : createElement('button', {
            key: 'del', className: 'trail-ctx-btn', onClick: () => setConfirmingDelete(true),
            style: { ...menuBtnStyle, color: '#e08468' },
          }, 'Delete'),
    ] : []),
  ), document.body)
}

const menuBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', fontSize: 12, padding: '6px 8px',
  background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
  color: 'rgb(var(--color-text-primary))',
}
