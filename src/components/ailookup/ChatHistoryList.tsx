import { useEffect, useState } from 'react'
import { Trash2, MessageSquare } from 'lucide-react'
import type { AiLookupChatSummary } from '@/types/electron'
import { IconButton, Button, ListRow } from '@/components/ui'

export default function ChatHistoryList({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) {
  const [chats, setChats] = useState<AiLookupChatSummary[]>([])

  function reload() {
    window.aiLookup.listChats().then(setChats).catch(() => {})
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {chats.length === 0 && (
        <p className="text-footnote text-text-muted text-center pt-6">No past chats yet.</p>
      )}
      {chats.map((c) => (
        <ListRow
          key={c.id}
          leading={<MessageSquare size={12} />}
          title={c.title}
          subtitle={new Date(c.updated_at).toLocaleString()}
          onClick={() => onSelect(c.id)}
          trailing={
            <IconButton
              icon={Trash2}
              label="Delete chat"
              size={20}
              danger
              onClick={(e) => { e.stopPropagation(); window.aiLookup.deleteChat(c.id).then(reload) }}
            />
          }
        />
      ))}
      <Button variant="ghost" size="sm" onClick={onClose} className="w-full mt-2">
        Close
      </Button>
    </div>
  )
}
