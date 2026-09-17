import { useEffect, useState } from 'react'
import { Trash2, MessageSquare } from 'lucide-react'
import type { AiLookupChatSummary } from '@/types/electron'
import { IconButton, Button } from '@/components/ui'

export default function ChatHistoryList({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) {
  const [chats, setChats] = useState<AiLookupChatSummary[]>([])

  function reload() {
    window.aiLookup.listChats().then(setChats).catch(() => {})
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {chats.length === 0 && (
        <p className="text-xs text-text-muted text-center pt-6">No past chats yet.</p>
      )}
      {chats.map((c) => (
        <div key={c.id} className="group flex items-center gap-2 rounded-row px-2 py-1.5 hover:bg-surface-hover cursor-pointer" onClick={() => onSelect(c.id)}>
          <MessageSquare size={12} className="flex-shrink-0 text-text-muted" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-primary truncate">{c.title}</p>
            <p className="text-micro text-text-muted">{new Date(c.updated_at).toLocaleString()}</p>
          </div>
          <IconButton
            icon={Trash2}
            label="Delete chat"
            size={20}
            danger
            className="opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); window.aiLookup.deleteChat(c.id).then(reload) }}
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={onClose} className="w-full mt-2">
        Close
      </Button>
    </div>
  )
}
