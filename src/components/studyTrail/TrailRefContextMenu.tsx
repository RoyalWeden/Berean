import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ExternalLink, PictureInPicture2, CornerUpLeft, GitBranch, Flag, Trash2, Scissors, Heading, StickyNote } from 'lucide-react'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import { navigateTrailRef, trailRefOpenFloating, trailRefLabel, type TrailRef } from './trailNav'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { MenuSurface, MenuItem, MenuSeparator, MenuLabel, Button } from '@/components/ui'

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
    /** Node rows only. `onSplitHere` starts a NEW session at this stop, moving it and everything
     *  after it — the direct answer to "there needs to be better organization of the sessions":
     *  a run that turned out to be two studies can be cut apart after the fact instead of having
     *  to be planned in advance. `onAddSection` / `onAddNote` place a v39 sticky here. Grouped
     *  into one object rather than three more positional args on openTrailRefMenu, which was
     *  already at seven. */
    nodeActions?: { onSplitHere?: () => void; onAddSection?: () => void; onAddNote?: () => void }
  }>()
}

export function openTrailRefMenu(
  openMenu: (data: {
    ref: TrailRef
    onJumpToOrigin?: () => void
    onDelete?: () => void
    topicBreak?: { active: boolean; onToggle: () => void }
    tangentToggle?: { active: boolean; onToggle: () => void }
    nodeActions?: { onSplitHere?: () => void; onAddSection?: () => void; onAddNote?: () => void }
    x: number; y: number
  }) => void,
  ref: TrailRef,
  e: React.MouseEvent,
  onJumpToOrigin?: () => void,
  onDelete?: () => void,
  topicBreak?: { active: boolean; onToggle: () => void },
  tangentToggle?: { active: boolean; onToggle: () => void },
  nodeActions?: { onSplitHere?: () => void; onAddSection?: () => void; onAddNote?: () => void },
) {
  e.preventDefault()
  e.stopPropagation()
  openMenu({ ref, onJumpToOrigin, onDelete, topicBreak, tangentToggle, nodeActions, x: e.clientX, y: e.clientY })
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
    nodeActions?: { onSplitHere?: () => void; onAddSection?: () => void; onAddNote?: () => void }
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
  const label = trailRefLabel(menu.ref, bookChapterVerseLabel)
  // Portaled to document.body — same reason as TrailHoverCard: MapView's zoom feature wraps
  // the spine in `transform: scale(...)`, which makes that ancestor the containing block for
  // `position: fixed` descendants instead of the real viewport.
  return createPortal(
    <div ref={menuRef} style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 'var(--z-menu)' as unknown as number, minWidth: 190 }}>
      <MenuSurface>
        <MenuLabel>{label}</MenuLabel>

        <MenuItem icon={ArrowRight} label="Open in current tab" onClick={() => { navigateTrailRef(menu.ref, false); onClose() }} />
        <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { navigateTrailRef(menu.ref, true); onClose() }} />
        <MenuItem icon={PictureInPicture2} label="Open in floating tab" onClick={() => { trailRefOpenFloating(menu.ref); onClose() }} />

        {(menu.tangentToggle || menu.topicBreak) && <MenuSeparator />}
        {menu.tangentToggle && (
          <MenuItem
            icon={GitBranch} active={menu.tangentToggle.active}
            label={menu.tangentToggle.active ? 'Tangent (unmark)' : 'Mark as tangent'}
            onClick={() => { menu.tangentToggle!.onToggle(); onClose() }}
          />
        )}
        {menu.topicBreak && (
          <MenuItem
            icon={Flag} active={menu.topicBreak.active}
            label={menu.topicBreak.active ? 'New topic (remove)' : 'Mark as new topic'}
            onClick={() => { menu.topicBreak!.onToggle(); onClose() }}
          />
        )}

        {menu.nodeActions && (menu.nodeActions.onSplitHere || menu.nodeActions.onAddSection || menu.nodeActions.onAddNote) && (
          <>
            <MenuSeparator />
            {menu.nodeActions.onAddSection && (
              <MenuItem
                icon={Heading} label="Add a section here"
                description="A labelled divider on the spine — everything below belongs to it until the next one"
                onClick={() => { menu.nodeActions!.onAddSection!(); onClose() }}
              />
            )}
            {menu.nodeActions.onAddNote && (
              <MenuItem
                icon={StickyNote} label="Add a note here"
                description="A resizable sticky pinned beside this stop"
                onClick={() => { menu.nodeActions!.onAddNote!(); onClose() }}
              />
            )}
            {menu.nodeActions.onSplitHere && (
              <MenuItem
                icon={Scissors} label="Start a new session here"
                description="Moves this stop and everything after it into a brand-new session"
                onClick={() => { menu.nodeActions!.onSplitHere!(); onClose() }}
              />
            )}
          </>
        )}
        {menu.onJumpToOrigin && (
          <>
            <MenuSeparator />
            <MenuItem icon={CornerUpLeft} label="Scroll to where this came from" onClick={() => { menu.onJumpToOrigin!(); onClose() }} />
          </>
        )}

        {menu.onDelete && (
          <>
            <MenuSeparator />
            {confirmingDelete ? (
              <div className="flex gap-1 px-1 py-0.5">
                <Button variant="destructive" size="sm" className="flex-1" onClick={() => { menu.onDelete!(); onClose() }}>Delete</Button>
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <MenuItem icon={Trash2} label="Delete" danger onClick={() => setConfirmingDelete(true)} />
            )}
          </>
        )}
      </MenuSurface>
    </div>,
    document.body,
  )
}
