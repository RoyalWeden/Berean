import { useState } from 'react'
import { Pencil, Trash2, Archive as ArchiveIcon, RotateCcw, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { TextField, Button, IconButton } from '@/components/ui'

/**
 * Real, findable home for sessions + archived tab groups — previously the
 * only way to manage either was a small icon-only trigger (sidebar bottom
 * row for sessions, a top-bar icon for archives), with no explanation and
 * no Settings entry at all. The sidebar's own session popover now stays a
 * fast quick-switcher (see Sidebar.tsx); the fiddlier rename/icon/delete
 * controls live only here.
 */
export default function SessionsSection() {
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const renameSession = useAppStore((s) => s.renameSession)
  const setSessionIcon = useAppStore((s) => s.setSessionIcon)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const createSession = useAppStore((s) => s.createSession)

  const archivedGroups = useAppStore((s) => s.archivedGroups)
  const restoreArchivedGroup = useAppStore((s) => s.restoreArchivedGroup)
  const dismissArchivedGroup = useAppStore((s) => s.dismissArchivedGroup)
  const clearAllArchivedGroups = useAppStore((s) => s.clearAllArchivedGroups)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)
  const [archiveFilter, setArchiveFilter] = useState('')

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
  }
  function commitRename() {
    if (renamingId && renameValue.trim()) renameSession(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  const filteredArchives = archiveFilter.trim()
    ? archivedGroups.filter((g) => g.label.toLowerCase().includes(archiveFilter.trim().toLowerCase()))
    : archivedGroups

  return (
    <div className="space-y-6">
      {/* ── Sessions ── */}
      <div>
        <p className="text-subhead font-medium text-text-primary mb-1">Sessions</p>
        <p className="s-desc text-caption text-text-muted mb-3">
          A session is a full, independent set of open tabs. Switch between sessions to keep separate study threads apart — e.g. one for a weekly teaching prep, another for personal reading.
        </p>
        <div className="space-y-1.5">
          {sessions.map((session) => {
            const SessionIcon = (SESSION_ICONS.find((i) => i.name === session.icon) ?? SESSION_ICONS[0]).Icon
            return (
              <div key={session.id} className="relative flex items-center gap-2 px-3 py-2 rounded-row bg-surface-elevated">
                <IconButton
                  icon={SessionIcon}
                  label="Change icon"
                  size={24}
                  onClick={() => setIconPickerFor(iconPickerFor === session.id ? null : session.id)}
                />
                {iconPickerFor === session.id && (
                  <div className="absolute left-0 top-full mt-1 z-menu p-1.5 grid grid-cols-7 gap-0.5 material-popover rounded-menu">
                    {SESSION_ICONS.map(({ name, Icon }) => (
                      <IconButton
                        key={name}
                        icon={Icon}
                        label={name}
                        size={24}
                        selected={session.icon === name}
                        onClick={() => { setSessionIcon(session.id, name); setIconPickerFor(null) }}
                      />
                    ))}
                  </div>
                )}
                {renamingId === session.id ? (
                  <TextField
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    onBlur={commitRename}
                    autoFocus
                    bare
                    wrapperClassName="flex-1"
                    className="border-b border-accent rounded-none"
                  />
                ) : (
                  <span className={`flex-1 text-footnote truncate ${session.id === currentSessionId ? 'text-accent font-medium' : 'text-text-primary'}`}>
                    {session.name}{session.id === currentSessionId ? ' (current)' : ''}
                  </span>
                )}
                {session.id !== currentSessionId && (
                  <Button size="sm" variant="ghost" className="flex-shrink-0" onClick={() => switchSession(session.id)}>
                    Switch
                  </Button>
                )}
                <IconButton icon={Pencil} label="Rename" size={20} onClick={() => startRename(session.id, session.name)} />
                {sessions.length > 1 && (
                  <IconButton icon={Trash2} label="Delete session" size={20} danger onClick={() => deleteSession(session.id)} />
                )}
              </div>
            )
          })}
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => createSession()}>
          + New session
        </Button>
      </div>

      {/* ── Archived tab groups ── */}
      <div className="pt-4 border-t border-separator">
        <p className="text-subhead font-medium text-text-primary mb-1">Archived tabs</p>
        <p className="s-desc text-caption text-text-muted mb-3">
          Tabs you archived (individually, or all at once from the top bar) stay here until restored or cleared — they don't count toward your open-tab list.
        </p>
        {archivedGroups.length === 0 ? (
          <p className="s-desc text-caption text-text-muted text-center py-4">No archived tabs</p>
        ) : (
          <>
            {archivedGroups.length > 6 && (
              <TextField
                value={archiveFilter}
                onChange={(e) => setArchiveFilter(e.target.value)}
                placeholder="Filter archived groups…"
                wrapperClassName="w-full mb-2"
              />
            )}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {filteredArchives.map((group) => (
                <div key={group.id} className="flex items-center gap-2 px-3 py-2 rounded-row bg-surface-elevated">
                  <ArchiveIcon size={12} className="text-text-muted flex-shrink-0" />
                  <span className="flex-1 text-footnote text-text-primary truncate">{group.label}</span>
                  <span className="text-caption2 text-text-muted flex-shrink-0">{group.tabs.length} tab{group.tabs.length === 1 ? '' : 's'}</span>
                  <IconButton icon={RotateCcw} label="Restore" size={20} onClick={() => restoreArchivedGroup(group.id)} />
                  <IconButton icon={X} label="Delete permanently" size={20} danger onClick={() => dismissArchivedGroup(group.id)} />
                </div>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2 hover:text-destructive" onClick={() => clearAllArchivedGroups()}>
              Clear all archived tabs
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
