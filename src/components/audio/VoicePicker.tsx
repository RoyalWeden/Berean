import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Search, Check, ChevronDown } from 'lucide-react'
import type { TTSVoiceOption } from '@/lib/tts/ttsBackend'

interface VoicePickerProps {
  voices: TTSVoiceOption[]
  value: string | null
  onChange: (voiceURI: string | null) => void
  /** Smaller trigger/text sizing for the floating player's inline picker. */
  compact?: boolean
}

function localeLabel(lang: string): string {
  try {
    const [langCode, region] = lang.split(/[-_]/)
    const langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(langCode) ?? langCode
    const regionName = region ? new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase()) : null
    return regionName ? `${langName} (${regionName})` : langName
  } catch {
    return lang
  }
}

function TierBadge({ tier }: { tier: 'Premium' | 'Enhanced' | null }) {
  if (!tier) return null
  return (
    <span className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--color-accent))] px-1 py-0.5 rounded bg-[rgb(var(--color-accent))/12]">
      {tier}
    </span>
  )
}

/**
 * Searchable, locale-grouped voice picker — replaces a plain <select>, which stops being
 * usable once someone has downloaded a handful of Enhanced/Premium voices (the list gets long
 * and there's no way to tell tiers apart at a glance). Shared between AudioSection.tsx
 * (Settings → Audio) and AudioPlayer.tsx's inline picker.
 */
export default function VoicePicker({ voices, value, onChange, compact }: VoicePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = voices.find((v) => v.voiceURI === value) ?? null

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? voices.filter((v) => v.name.toLowerCase().includes(q)) : voices
    const byLocale = new Map<string, TTSVoiceOption[]>()
    for (const v of filtered) {
      const label = localeLabel(v.lang)
      if (!byLocale.has(label)) byLocale.set(label, [])
      byLocale.get(label)!.push(v)
    }
    for (const list of byLocale.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return [...byLocale.entries()].sort(([a], [b]) => {
      if (a.startsWith('English (United States)')) return -1
      if (b.startsWith('English (United States)')) return 1
      return a.localeCompare(b)
    })
  }, [voices, query])

  function select(voiceURI: string | null) {
    onChange(voiceURI)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <Popover.Trigger asChild>
        <button
          className={`flex-1 min-w-0 flex items-center justify-between gap-1.5 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none cursor-pointer hover:bg-[rgb(var(--color-surface-4))] transition-colors ${compact ? 'text-[11px] px-2 py-1.5' : 'text-sm px-3 py-1.5'}`}
        >
          <span className="truncate flex items-center gap-1.5 min-w-0">
            {/* The tier badge (Premium/Enhanced) is dropped here in compact mode — it was
                squeezing the actual voice NAME down to nothing in the player's tight inline row
                (a fixed-width badge chip surviving while flex-1 text truncated to empty is
                exactly "it just shows Premium, not the voice"). Still shown in the dropdown list
                below, where there's room for both. */}
            <span className="truncate">{selected ? selected.name : 'Choose a voice'}</span>
            {selected && !compact && <TierBadge tier={selected.tier ?? null} />}
          </span>
          <ChevronDown size={compact ? 12 : 14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start" sideOffset={6}
          className="z-[300] w-[290px] rounded-xl shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))/98] backdrop-blur overflow-hidden"
        >
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-[rgb(var(--color-surface-3))]">
            <Search size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search voices…"
              className="flex-1 min-w-0 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))]"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            <button
              onClick={() => select(null)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <span className={!value ? 'text-[rgb(var(--color-text-primary))] font-medium' : 'text-[rgb(var(--color-text-secondary))]'}>System default</span>
              {!value && <Check size={13} className="text-[rgb(var(--color-accent))]" />}
            </button>
            {groups.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-[rgb(var(--color-text-muted))] text-center">No voices match "{query}"</p>
            )}
            {groups.map(([locale, group]) => (
              <div key={locale}>
                <p className="px-2.5 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{locale}</p>
                {group.map((v) => {
                  const isSelected = v.voiceURI === value
                  return (
                    <button
                      key={v.voiceURI}
                      onClick={() => select(v.voiceURI)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
                    >
                      <span className={`flex items-center gap-1.5 min-w-0 ${isSelected ? 'text-[rgb(var(--color-text-primary))] font-medium' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                        <span className="truncate">{v.name}</span>
                        <TierBadge tier={v.tier ?? null} />
                      </span>
                      {isSelected && <Check size={13} className="text-[rgb(var(--color-accent))] flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
