import { useAppStore } from '@/store'
import { YOUTUBE_LAYOUTS } from '@/lib/youtubeLayouts'

export default function YtLayoutSetting() {
  const layout = useAppStore((s) => s.defaultYoutubeLayout)
  const set = useAppStore((s) => s.setDefaultYoutubeLayout)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {YOUTUBE_LAYOUTS.map((def) => (
        <button
          key={def.id}
          onClick={() => set(def.id)}
          className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left border transition-all cursor-pointer text-xs
            ${layout === def.id
              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/20]'
              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
            }`}
        >
          <span className="font-semibold">{def.label}</span>
          <span className="text-[9px] text-[rgb(var(--color-text-muted))] leading-snug">{def.description}</span>
        </button>
      ))}
    </div>
  )
}
