import { useState } from 'react'
import { useAppStore } from '@/store'

interface DangerAction {
  id: string
  title: string
  description: string
  confirmWord: string
  buttonLabel: string
  onConfirm: () => Promise<void>
}

function DangerCard({ action }: { action: DangerAction }) {
  const [inputValue, setInputValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const isReady = inputValue.trim().toLowerCase() === action.confirmWord.toLowerCase()

  async function handleClick() {
    if (!isReady || status === 'busy') return
    setStatus('busy')
    try {
      await action.onConfirm()
      setStatus('done')
      setInputValue('')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred')
      setStatus('error')
      setTimeout(() => { setStatus('idle'); setErrorMsg('') }, 4000)
    }
  }

  return (
    <div className="border border-red-500/25 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-red-500/8 border-b border-red-500/20">
        <p className="text-sm font-semibold text-red-400">{action.title}</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">{action.description}</p>
      </div>
      {/* Confirmation input + button */}
      <div className="px-4 py-3 bg-[rgb(var(--color-surface-3))] flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mb-1">
            Type <span className="font-mono font-semibold text-[rgb(var(--color-text-secondary))]">{action.confirmWord}</span> to confirm
          </p>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setStatus('idle') }}
            placeholder={action.confirmWord}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-[rgb(var(--color-surface-4))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none focus:border-red-500/50 transition-colors"
          />
        </div>
        <button
          onClick={handleClick}
          disabled={!isReady || status === 'busy'}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${
            status === 'done'
              ? 'bg-green-600/20 text-green-400 border border-green-600/30'
              : status === 'error'
              ? 'bg-red-600/20 text-red-400 border border-red-600/30'
              : isReady
              ? 'bg-red-600 hover:bg-red-700 text-white border border-red-600'
              : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] border border-[rgb(var(--color-surface-4))] opacity-50'
          }`}
        >
          {status === 'busy' ? 'Working…' : status === 'done' ? 'Done' : status === 'error' ? (errorMsg || 'Error') : action.buttonLabel}
        </button>
      </div>
    </div>
  )
}

export default function DangerSection() {
  const clearHistory = useAppStore((s) => s.clearHistory)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)

  const actions: DangerAction[] = [
    {
      id: 'clear-history',
      title: 'Clear browsing history',
      description: 'Removes the entire navigation history log (scripture chapters, notes, lexicon entries, searches). Your notes and highlights are not affected.',
      confirmWord: 'history',
      buttonLabel: 'Clear history',
      onConfirm: async () => {
        clearHistory()
      },
    },
    {
      id: 'delete-bg-notes',
      title: 'Delete all BibleGateway notes',
      description: 'Permanently deletes every note imported from BibleGateway (tagged "biblegateway"). Other notes are not affected.',
      confirmWord: 'biblegateway',
      buttonLabel: 'Delete BibleGateway notes',
      onConfirm: async () => {
        await window.notes.deleteByTag('biblegateway')
        bumpNoteToken()
      },
    },
    {
      id: 'delete-esword-notes',
      title: 'Delete all e-Sword notes',
      description: 'Permanently deletes every note imported from e-Sword (tagged "esword"). Other notes are not affected.',
      confirmWord: 'esword',
      buttonLabel: 'Delete e-Sword notes',
      onConfirm: async () => {
        await window.notes.deleteByTag('esword')
        bumpNoteToken()
      },
    },
    {
      id: 'delete-all-notes',
      title: 'Delete all notes',
      description: 'Permanently deletes every note — verse notes, general notes, YouTube timestamp notes, and daily notes. This cannot be undone.',
      confirmWord: 'notes',
      buttonLabel: 'Delete all notes',
      onConfirm: async () => {
        await window.notes.deleteAllNotes()
        bumpNoteToken()
      },
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-red-400 mb-0.5">Danger zone</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          These actions are permanent and cannot be undone. Each action requires you to type a confirmation word before the button activates.
        </p>
      </div>
      <div className="space-y-4">
        {actions.map((a) => (
          <DangerCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  )
}
