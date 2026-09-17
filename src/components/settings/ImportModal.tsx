import { useState } from 'react'
import { BookOpen, Sword } from 'lucide-react'
import { useAppStore } from '@/store'
import { Sheet, SegmentedControl } from '@/components/ui'
import BibleGatewayImporter from './BibleGatewayImporter'
import ESwordImporter from './ESwordImporter'

type ImportTab = 'biblegateway' | 'esword'

export default function ImportModal() {
  const importModalOpen = useAppStore((s) => s.importModalOpen)
  const closeImportModal = useAppStore((s) => s.closeImportModal)
  const [activeTab, setActiveTab] = useState<ImportTab>('biblegateway')

  return (
    <Sheet
      open={importModalOpen}
      onOpenChange={(open) => !open && closeImportModal()}
      size="lg"
      title="Import Notes"
      bodyClassName="flex flex-col"
    >
      <div className="px-5 pt-1 pb-3 flex-shrink-0">
        <SegmentedControl
          size="md"
          aria-label="Import source"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'biblegateway', icon: BookOpen, label: 'BibleGateway' },
            { value: 'esword', icon: Sword, label: 'e-Sword' },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {activeTab === 'biblegateway' && <BibleGatewayImporter />}
        {activeTab === 'esword' && <ESwordImporter />}
      </div>
    </Sheet>
  )
}
