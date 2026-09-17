import { useState, useEffect } from 'react'
import { BookOpen, Sword } from 'lucide-react'
import { useAppStore } from '@/store'
import { SegmentedControl } from '@/components/ui'
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
      <div className="px-6 pt-4 pb-0 mb-0">
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
      {/* Content */}
      <div className="px-6 pt-5">
        {activeTab === 'biblegateway' && <BibleGatewayImporter />}
        {activeTab === 'esword' && <ESwordImporter />}
      </div>
    </div>
  )
}
