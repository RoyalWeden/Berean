import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Settings, Pencil, Palette, Hash, Trash2, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import { IconButton, Button, MenuSurface, MenuItem, MenuSeparator, MenuLabel, TextField, Popover, PopoverTrigger, PopoverSurface } from '@/components/ui'
import { SESSION_ICONS } from './Sidebar'

/**
 * The workspace (session) switcher — a toolbar control at the head of the main navigation
 * cluster ([Session] [Sidebar] [Back / Forward …]), not a row inside the sidebar (TEST
 * 2026-10-05). Click: the session list (switch, New session ⌘⇧0, Manage sessions…). Right-click
 * the control or a row: rename / change icon / delete. The control shows the current session's
 * symbol; its name is in the tooltip and accessible label.
 */
export function SessionSwitcher({ variant }: { variant?: 'ghost' } = {}) {
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const createSession = useAppStore((s) => s.createSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const renameSession = useAppStore((s) => s.renameSession)
  const setSessionIcon = useAppStore((s) => s.setSessionIcon)
  const openSettingsToSessions = useAppStore((s) => s.openSettingsToSessions)
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [mode, setMode] = useState<'default' | 'rename' | 'icon'>('default')
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? sessions[0]
  const currentIdx = sessions.findIndex((s) => s.id === currentSessionId)
  const CurrentIcon = (SESSION_ICONS.find((i) => i.name === currentSession?.icon) ?? SESSION_ICONS[0]).Icon
  const currentName = currentSession ? currentSession.name : `Session ${currentIdx + 1}`

  useEffect(() => {
    if (!menu) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setMenu(null); setMode('default') }
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') { setMenu(null); setMode('default') } }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onEsc) }
  }, [menu])

  // Right-clicking a row INSIDE the open list keeps the list visible behind the submenu.
  function openMenu(x: number, y: number, sessionId: string, name: string, closeList = true) {
    if (closeList) setOpen(false)
    setMode('default')
    setRenameValue(name)
    setMenu({ x, y, sessionId })
  }

  const menuSession = menu ? sessions.find((s) => s.id === menu.sessionId) : undefined
  const MenuSessionIcon = (SESSION_ICONS.find((i) => i.name === menuSession?.icon) ?? SESSION_ICONS[0]).Icon

  return (
    <>
      <Popover open={open} onOpenChange={(v) => { if (v) { setMenu(null); setMode('default') }; setOpen(v) }}>
        <PopoverTrigger asChild>
          {/* Labelled (TEST 2026-10-05: "it's not clear that it's for session because it's just
              the icon"): the word names the control; the symbol is the current session's; the
              chevron says it opens a switcher. The session's own name is in the tooltip. Over the
              glass sidebar pane it is a plain (ghost) item — no glass on glass. */}
          <Button
            variant={variant === 'ghost' ? 'ghost' : 'menu'}
            icon={CurrentIcon}
            selected={open}
            tooltip={`Session: ${currentName} — switch, create or manage sessions`}
            aria-label={`Session: ${currentName}. Switch session`}
            aria-haspopup="menu"
            onContextMenu={(e) => { e.preventDefault(); if (currentSession) openMenu(e.clientX, e.clientY, currentSession.id, currentSession.name) }}
          >
            Session
            {variant === 'ghost' && <ChevronDown size={12} strokeWidth={2} className="-mr-0.5 opacity-60" aria-hidden />}
          </Button>
        </PopoverTrigger>
        <PopoverSurface
          side="bottom" align="start" sideOffset={6}
          innerClassName="min-w-[220px] p-1"
          // The rename/icon/delete submenu is portaled separately; clicks inside it are not
          // "outside" this list.
          onInteractOutside={(e) => { if (menuRef.current && menuRef.current.contains(e.target as Node)) e.preventDefault() }}
        >
          <MenuLabel>Sessions</MenuLabel>
          {sessions.map((session) => {
            const Icon = (SESSION_ICONS.find((i) => i.name === session.icon) ?? SESSION_ICONS[0]).Icon
            return (
              <MenuItem
                key={session.id}
                icon={Icon}
                label={session.name}
                active={session.id === currentSessionId}
                onClick={() => { if (session.id !== currentSessionId) { switchSession(session.id); setOpen(false) } }}
                onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, session.id, session.name, false) }}
              />
            )
          })}
          <MenuSeparator />
          <MenuItem icon={Plus} label="New Session" shortcut="⌘⇧0" onClick={() => { createSession(); setOpen(false) }} />
          <MenuItem icon={Settings} label="Manage Sessions…" onClick={() => { openSettingsToSessions(); setOpen(false) }} />
        </PopoverSurface>
      </Popover>

      {menu && createPortal(
        <MenuPositioner ref={menuRef} x={menu.x} y={menu.y}>
          <MenuSurface className={mode === 'icon' ? 'w-48' : 'min-w-44'}>
            <div className="flex items-center gap-2 px-2.5 py-1.5 mb-1 border-b border-separator">
              <MenuSessionIcon size={12} className="text-text-muted flex-shrink-0" />
              <span className="flex-1 text-caption font-medium text-text-secondary truncate">{menuSession?.name ?? 'Session'}</span>
            </div>
            {mode === 'rename' ? (
              <TextField
                autoFocus
                size="sm"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => { if (renameValue.trim()) renameSession(menu.sessionId, renameValue.trim()); setMode('default') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                  if (e.key === 'Escape') { e.preventDefault(); setMenu(null); setMode('default') }
                }}
                wrapperClassName="px-1"
              />
            ) : mode === 'icon' ? (
              <>
                <MenuLabel>Session icon</MenuLabel>
                <div className="grid grid-cols-7 gap-0.5 p-1">
                  <IconButton icon={Hash} label="No icon (show number)" size={24} active={!menuSession?.icon} onClick={() => setSessionIcon(menu.sessionId, '')} />
                  {SESSION_ICONS.map(({ name, Icon }) => (
                    <IconButton key={name} icon={Icon} label={name} size={24} active={menuSession?.icon === name} onClick={() => setSessionIcon(menu.sessionId, name)} />
                  ))}
                </div>
                <MenuItem label="Done" className="justify-center" onClick={() => setMode('default')} />
              </>
            ) : (
              <>
                <MenuItem icon={Pencil} label="Rename" onClick={() => setMode('rename')} />
                <MenuItem icon={Palette} label="Change Icon" onClick={() => setMode('icon')} />
                <MenuSeparator />
                <MenuItem icon={Settings} label="Manage Sessions…" onClick={() => { openSettingsToSessions(); setMenu(null) }} />
                {sessions.length > 1 && (
                  <MenuItem icon={Trash2} label="Delete Session" danger onClick={() => { deleteSession(menu.sessionId); setMenu(null) }} />
                )}
              </>
            )}
          </MenuSurface>
        </MenuPositioner>,
        document.body,
      )}
    </>
  )
}
