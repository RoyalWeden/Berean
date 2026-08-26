import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ExternalLink, PictureInPicture2, CornerUpLeft, GitBranch, Flag, Trash2 } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import { navigateTrailRef, trailRefOpenFloating, trailRefLabel, type TrailRef } from './trailNav'
import { bookName } from '@/lib/parseRef'

// Shared right-click menu for every chapter/Strong's label in the Study Trail window.
//
// Every item is one vertical row, icon on the left and its label to the right — per direct
// feedback: a compact icon-only row (tried first) wasn't identifiable at a glance, and a row of
// icon+caption-underneath (tried next) still read as an unfamiliar grid rather than an ordinary
// menu. Back to the standard "icon, then text" menu-item shape throughout, just consistently
// applied to every item including the Tangent/New-topic toggles (moved HERE from the note
// popover — see ReasonPromptPopover.tsx's own comment on why), whose active state now shows as
// a filled/tinted row rather than a checkbox.
export function useTrailRefMenu() {
  return usePositionedMenu<{
    ref: TrailRef
    onJumpToOrigin?: () => void
    onDelete?: () => void
    topicBreak?: { active: boolean; onToggle: () => void }
    tangentToggle?: { active: boolean; onToggle: () => void }
  }>()
}

export function openTrailRefMenu(
  openMenu: (data: {
    ref: TrailRef
    onJumpToOrigin?: () => void
    onDelete?: () => void
    topicBreak?: { active: boolean; onToggle: () => void }
    tangentToggle?: { active: boolean; onToggle: () => void }
    x: number; y: number
  }) => void,
  ref: TrailRef,
  e: React.MouseEvent,
  onJumpToOrigin?: () => void,
  onDelete?: () => void,
  topicBreak?: { active: boolean; onToggle: () => void },
  tangentToggle?: { active: boolean; onToggle: () => void },
) {
  e.preventDefault()
  e.stopPropagation()
  openMenu({ ref, onJumpToOrigin, onDelete, topicBreak, tangentToggle, x: e.clientX, y: e.clientY })
}

function MenuItem({ icon, label, title, onClick, active, color }: {
  icon: React.ReactNode; label: string; title?: string; onClick: () => void; active?: boolean; color?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="trail-ctx-btn"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
        background: active ? 'rgb(var(--color-accent) / 0.14)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
        color: color ?? (active ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-primary))'), textAlign: 'left', fontSize: 12,
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: 0.85 }}>{icon}</span>
      {label}
    </button>
  )
}

export function TrailRefContextMenu({
  menu, menuRef, onClose,
}: {
  menu: ({
    ref: TrailRef
    onJumpToOrigin?: () => void
    onDelete?: () => void
    topicBreak?: { active: boolean; onToggle: () => void }
    tangentToggle?: { active: boolean; onToggle: () => void }
  } & { x: number; y: number }) | null
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
  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed', top: menu.y, left: menu.x, zIndex: 10001, minWidth: 190,
        background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 5,
      }}
    >
      <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', padding: '3px 8px 5px' }}>{label}</div>

      <MenuItem icon={<ArrowRight size={13} />} label="Open in current tab" onClick={() => { navigateTrailRef(menu.ref, false); onClose() }} />
      <MenuItem icon={<ExternalLink size={13} />} label="Open in new tab" onClick={() => { navigateTrailRef(menu.ref, true); onClose() }} />
      <MenuItem icon={<PictureInPicture2 size={13} />} label="Open in floating tab" onClick={() => { trailRefOpenFloating(menu.ref); onClose() }} />

      {(menu.tangentToggle || menu.topicBreak) && <div style={{ height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' }} />}
      {menu.tangentToggle && (
        <MenuItem
          icon={<GitBranch size={13} />} active={menu.tangentToggle.active}
          label={menu.tangentToggle.active ? 'Tangent (unmark)' : 'Mark as tangent'}
          onClick={() => { menu.tangentToggle!.onToggle(); onClose() }}
        />
      )}
      {menu.topicBreak && (
        <MenuItem
          icon={<Flag size={13} />} active={menu.topicBreak.active}
          label={menu.topicBreak.active ? 'New topic (remove)' : 'Mark as new topic'}
          onClick={() => { menu.topicBreak!.onToggle(); onClose() }}
        />
      )}

      {menu.onJumpToOrigin && (
        <>
          <div style={{ height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' }} />
          <MenuItem icon={<CornerUpLeft size={13} />} label="Scroll to where this came from" onClick={() => { menu.onJumpToOrigin!(); onClose() }} />
        </>
      )}

      {menu.onDelete && (
        <>
          <div style={{ height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' }} />
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 4, padding: '2px 4px' }}>
              <button
                className="trail-ctx-btn" onClick={() => { menu.onDelete!(); onClose() }}
                style={{ ...menuBtnStyle, color: '#e08468', flex: 1 }}
              >Delete</button>
              <button className="trail-ctx-btn" onClick={() => setConfirmingDelete(false)} style={{ ...menuBtnStyle, flex: 1 }}>Cancel</button>
            </div>
          ) : (
            <MenuItem icon={<Trash2 size={13} />} label="Delete" color="#e08468" onClick={() => setConfirmingDelete(true)} />
          )}
        </>
      )}
    </div>,
    document.body,
  )
}

const menuBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', fontSize: 12, padding: '6px 8px',
  background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
  color: 'rgb(var(--color-text-primary))',
}
