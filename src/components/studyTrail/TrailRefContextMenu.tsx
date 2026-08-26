import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ExternalLink, PictureInPicture2, CornerUpLeft, GitBranch, Flag, Trash2 } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import { navigateTrailRef, trailRefOpenFloating, trailRefLabel, type TrailRef } from './trailNav'
import { bookName } from '@/lib/parseRef'

// Shared right-click menu for every chapter/Strong's label in the Study Trail window.
//
// Redesigned to be compact — per direct feedback ("the rightclick menu is now getting really
// busy... find a way to clean it up and make it simple or compact"): the three "Open in ___"
// actions collapse into one row of icon buttons (was three full-width text rows), and the
// Tangent/New-topic toggles (moved HERE from the note popover, see ReasonPromptPopover.tsx's own
// comment on why) are a second compact icon row instead of two more full rows — active state
// shown by fill color, not a checkbox. Only "Scroll to origin" and "Delete" stay as their own
// text rows, since those are one-shot actions/destructive, not a quick toggle to glance at.
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

// A short caption under the icon — per direct feedback ("the rightclick menu is now too
// simplified because i cant figure out what each thing is by just the icons"), icon-only wasn't
// actually readable at a glance. Keeps the row compact (one row instead of a full-width text
// button per action) while still being self-explanatory without hovering for a tooltip first.
function IconBtn({ icon, caption, title, onClick, active }: { icon: React.ReactNode; caption: string; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="trail-ctx-btn"
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '6px 2px',
        background: active ? 'rgb(var(--color-accent) / 0.16)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
        color: active ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-primary))',
      }}
    >
      {icon}
      <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1 }}>{caption}</span>
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
        position: 'fixed', top: menu.y, left: menu.x, zIndex: 10001, minWidth: 200,
        background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', padding: 5,
      }}
    >
      <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', padding: '3px 8px 5px' }}>{label}</div>

      <div style={{ display: 'flex', gap: 2, marginBottom: (menu.topicBreak || menu.tangentToggle) ? 2 : 0 }}>
        <IconBtn icon={<ArrowRight size={14} />} caption="This tab" title="Open in current tab" onClick={() => { navigateTrailRef(menu.ref, false); onClose() }} />
        <IconBtn icon={<ExternalLink size={14} />} caption="New tab" title="Open in new tab" onClick={() => { navigateTrailRef(menu.ref, true); onClose() }} />
        <IconBtn icon={<PictureInPicture2 size={14} />} caption="Floating" title="Open in floating tab" onClick={() => { trailRefOpenFloating(menu.ref); onClose() }} />
      </div>

      {/* Tangent/New-topic — a compact icon+caption row, active state shown by fill color
          rather than a checkbox, per direct feedback on decluttering this menu. */}
      {(menu.tangentToggle || menu.topicBreak) && (
        <div style={{ display: 'flex', gap: 2 }}>
          {menu.tangentToggle && (
            <IconBtn
              icon={<GitBranch size={14} />} caption="Tangent" active={menu.tangentToggle.active}
              title={menu.tangentToggle.active ? 'Tangent (on) — click to unmark' : 'Mark as tangent'}
              onClick={() => { menu.tangentToggle!.onToggle(); onClose() }}
            />
          )}
          {menu.topicBreak && (
            <IconBtn
              icon={<Flag size={14} />} caption="New topic" active={menu.topicBreak.active}
              title={menu.topicBreak.active ? 'New topic (on) — click to remove' : 'Mark as new topic'}
              onClick={() => { menu.topicBreak!.onToggle(); onClose() }}
            />
          )}
        </div>
      )}

      {menu.onJumpToOrigin && (
        <>
          <div style={{ height: 1, background: 'rgb(var(--color-surface-4))', margin: '4px 0' }} />
          <button
            className="trail-ctx-btn" onClick={() => { menu.onJumpToOrigin!(); onClose() }} style={menuBtnStyle}
          ><CornerUpLeft size={12} style={{ marginRight: 6, verticalAlign: -2 }} />Scroll to where this came from</button>
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
            <button
              className="trail-ctx-btn" onClick={() => setConfirmingDelete(true)}
              style={{ ...menuBtnStyle, color: '#e08468' }}
            ><Trash2 size={12} style={{ marginRight: 6, verticalAlign: -2 }} />Delete</button>
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
