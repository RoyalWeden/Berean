import { useState, useEffect } from 'react'
import { BookOpen, Sword } from 'lucide-react'
import { useAppStore } from '@/store'
import BibleGatewayImporter from '../BibleGatewayImporter'
import ESwordImporter from '../ESwordImporter'

type ImportTab = 'biblegateway' | 'esword'

export default function ImportSection() {
  const importInitialTab = useAppStore((s) => s.importInitialTab)
  const [activeTab, setActiveTab] = useState<ImportTab>(importInitialTab)

  // Sync to whatever tab was requested when the modal was opened
  useEffect(() => {
    setActiveTab(importInitialTab)
  }, [importInitialTab])

  return (
    <div className="space-y-0 -mx-6 -mt-6">
      {/* Tab bar */}
      <div className="flex border-b border-[rgb(var(--color-surface-4))] px-6 mb-0">
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
      <div className="px-6 pt-5">
        {activeTab === 'biblegateway' && <BibleGatewayImporter />}
        {activeTab === 'esword' && <ESwordImporter />}
      </div>
    </div>
  )
}
