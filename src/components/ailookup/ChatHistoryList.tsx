import { useEffect, useState } from 'react'
import { Trash2, MessageSquare } from 'lucide-react'
import type { AiLookupChatSummary } from '@/types/electron'

export default function ChatHistoryList({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) {
  const [chats, setChats] = useState<AiLookupChatSummary[]>([])

  function reload() {
    window.aiLookup.listChats().then(setChats).catch(() => {})
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {chats.length === 0 && (
        <p className="text-xs text-[rgb(var(--color-text-muted))] text-center pt-6">No past chats yet.</p>
      )}
      {chats.map((c) => (
        <div key={c.id} className="group flex items-center gap-2 rounded-shell px-2 py-1.5 hover:bg-[rgb(var(--color-surface-2))] cursor-pointer" onClick={() => onSelect(c.id)}>
          <MessageSquare size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[rgb(var(--color-text-primary))] truncate">{c.title}</p>
            <p className="text-[9px] text-[rgb(var(--color-text-muted))]">{new Date(c.updated_at).toLocaleString()}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); window.aiLookup.deleteChat(c.id).then(reload) }}
            title="Delete chat"
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer transition-opacity"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <button onClick={onClose} className="w-full mt-2 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer text-center py-1">
        Close
      </button>
    </div>
  )
}
