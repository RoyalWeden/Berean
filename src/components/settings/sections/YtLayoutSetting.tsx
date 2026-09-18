import { useAppStore } from '@/store'
import { YOUTUBE_LAYOUTS } from '@/lib/youtubeLayouts'
import { OptionCard } from '@/components/ui'

export default function YtLayoutSetting() {
  const layout = useAppStore((s) => s.defaultYoutubeLayout)
  const set = useAppStore((s) => s.setDefaultYoutubeLayout)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {YOUTUBE_LAYOUTS.map((def) => (
        <OptionCard
          key={def.id}
          selected={layout === def.id}
          onClick={() => set(def.id)}
          title={def.label}
          description={def.description}
        />
      ))}
    </div>
  )
}
