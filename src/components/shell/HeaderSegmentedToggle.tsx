import type { LucideIcon } from 'lucide-react'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  title?: string
}

/**
 * Shared pill-style segmented toggle for tab-panel headers (Notes' Raw/Edit/View,
 * Lexicon's All/Heb/Grk, etc). Each header previously styled its own version of
 * this with a different radius/padding — this is the one shared shape.
 */
export default function HeaderSegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  title?: string
}) {
  return (
    <div
      className="flex items-center bg-[rgb(var(--color-surface-3))] rounded-shell p-0.5 gap-px flex-shrink-0"
      title={title}
    >
      {options.map(({ value: v, label, icon: Icon, title: segTitle }) => (
        <button
          key={v}
          title={segTitle}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-shell text-[10px] font-medium transition-all cursor-pointer select-none ${
            value === v
              ? 'bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] shadow-sm'
              : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
          }`}
        >
          {Icon && <Icon size={11} strokeWidth={value === v ? 2.2 : 1.8} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
