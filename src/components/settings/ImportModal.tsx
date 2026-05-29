import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, BookOpen, Sword } from 'lucide-react'
import { useAppStore } from '@/store'
import BibleGatewayImporter from './BibleGatewayImporter'
import ESwordImporter from './ESwordImporter'

type ImportTab = 'biblegateway' | 'esword'

export default function ImportModal() {
  const importModalOpen = useAppStore((s) => s.importModalOpen)
  const closeImportModal = useAppStore((s) => s.closeImportModal)
  const [activeTab, setActiveTab] = useState<ImportTab>('biblegateway')

  return (
    <Dialog.Root open={importModalOpen} onOpenChange={(open) => !open && closeImportModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="
            fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            z-[60] w-full max-w-lg max-h-[85vh]
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden flex flex-col
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">
              Import Notes
            </Dialog.Title>
            <button
              onClick={closeImportModal}
              className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 px-5">
            {([
              ['biblegateway', BookOpen, 'BibleGateway'],
              ['esword',       Sword,    'e-Sword'],
            ] as [ImportTab, typeof BookOpen, string][]).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
                  activeTab === id
                    ? 'border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]'
                    : 'border-transparent text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {activeTab === 'biblegateway' && <BibleGatewayImporter />}
            {activeTab === 'esword' && <ESwordImporter />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
