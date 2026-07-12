import { useState } from 'react'
import { Pencil, Trash2, Archive as ArchiveIcon, RotateCcw, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { SESSION_ICONS } from '@/components/shell/Sidebar'

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
        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Sessions</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">
          A session is a full, independent set of open tabs. Switch between sessions to keep separate study threads apart — e.g. one for a weekly teaching prep, another for personal reading.
        </p>
        <div className="space-y-1.5">
          {sessions.map((session) => {
            const SessionIcon = (SESSION_ICONS.find((i) => i.name === session.icon) ?? SESSION_ICONS[0]).Icon
            return (
              <div key={session.id} className="relative flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
                <button
                  onClick={() => setIconPickerFor(iconPickerFor === session.id ? null : session.id)}
                  title="Change icon"
                  className="flex-shrink-0 text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
                >
                  <SessionIcon size={14} />
                </button>
                {iconPickerFor === session.id && (
                  <div className="absolute left-0 top-full mt-1 z-10 p-1.5 grid grid-cols-7 gap-0.5 rounded-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl">
                    {SESSION_ICONS.map(({ name, Icon }) => (
                      <button
                        key={name}
                        onClick={() => { setSessionIcon(session.id, name); setIconPickerFor(null) }}
                        className={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] ${session.icon === name ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : ''}`}
                      >
                        <Icon size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {renamingId === session.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    onBlur={commitRename}
                    autoFocus
                    className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none border-b border-[rgb(var(--color-accent))]"
                  />
                ) : (
                  <span className={`flex-1 text-xs truncate ${session.id === currentSessionId ? 'text-[rgb(var(--color-accent))] font-medium' : 'text-[rgb(var(--color-text-primary))]'}`}>
                    {session.name}{session.id === currentSessionId ? ' (current)' : ''}
                  </span>
                )}
                {session.id !== currentSessionId && (
                  <button
                    onClick={() => switchSession(session.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
                  >
                    Switch
                  </button>
                )}
                <button
                  onClick={() => startRename(session.id, session.name)}
                  title="Rename"
                  className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
                >
                  <Pencil size={12} />
                </button>
                {sessions.length > 1 && (
                  <button
                    onClick={() => deleteSession(session.id)}
                    title="Delete session"
                    className="text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button
          onClick={() => createSession()}
          className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          + New session
        </button>
      </div>

      {/* ── Archived tab groups ── */}
      <div className="pt-4 border-t border-[rgb(var(--color-surface-4))]">
        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Archived tabs</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">
          Tabs you archived (individually, or all at once from the top bar) stay here until restored or cleared — they don't count toward your open-tab list.
        </p>
        {archivedGroups.length === 0 ? (
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] text-center py-4">No archived tabs</p>
        ) : (
          <>
            {archivedGroups.length > 6 && (
              <input
                type="text"
                value={archiveFilter}
                onChange={(e) => setArchiveFilter(e.target.value)}
                placeholder="Filter archived groups…"
                className="w-full mb-2 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
              />
            )}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {filteredArchives.map((group) => (
                <div key={group.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
                  <ArchiveIcon size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))] truncate">{group.label}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">{group.tabs.length} tab{group.tabs.length === 1 ? '' : 's'}</span>
                  <button
                    onClick={() => restoreArchivedGroup(group.id)}
                    title="Restore"
                    className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer flex-shrink-0"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    onClick={() => dismissArchivedGroup(group.id)}
                    title="Delete permanently"
                    className="text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => clearAllArchivedGroups()}
              className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-colors cursor-pointer"
            >
              Clear all archived tabs
            </button>
          </>
        )}
      </div>
    </div>
  )
}
