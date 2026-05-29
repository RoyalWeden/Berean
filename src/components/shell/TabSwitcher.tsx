import type { SpaceId, Tab, BibleTabState, NoteTabState, LexiconTabState, YouTubeTabState, SearchTabState } from '@/types'

interface SwitcherTab {
  spaceId: SpaceId
  tabId: string
  title: string
  tab: Tab
}

interface TabSwitcherProps {
  tabs: SwitcherTab[]
  selectedIndex: number
}

const SPACE_CONFIG: Record<SpaceId, { abbrev: string; color: string; label: string }> = {
  scripture: { abbrev: 'S',  color: 'rgb(var(--color-accent))',  label: 'Scripture' },
  notes:     { abbrev: 'N',  color: 'rgb(234,179,8)',            label: 'Notes'     },
  lexicon:   { abbrev: 'L',  color: 'rgb(52,211,153)',           label: 'Lexicon'   },
  youtube:   { abbrev: 'Y',  color: 'rgb(239,68,68)',            label: 'YouTube'   },
  search:    { abbrev: '⌕', color: 'rgb(167,139,250)',          label: 'Search'    },
}

// ── Mini content preview rendered inside each tab card ──────────────────────

function BiblePreview({ state }: { state: BibleTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Translation badge */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-[8px] font-bold tracking-wide px-1 py-0.5 rounded bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))] leading-none">
          {state.translation?.toUpperCase() ?? 'KJVA'}
        </span>
        {state.compareMode && (
          <span className="text-[8px] font-bold tracking-wide px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] leading-none">
            CMP
          </span>
        )}
      </div>
      {/* Simulated verse lines */}
      <div className="flex flex-col gap-[3px] mt-0.5 flex-1 overflow-hidden">
        {[70, 90, 55, 80, 65].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] opacity-30" style={{ width: `${w}%` }} />
        ))}
        <div className="h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] opacity-20" style={{ width: '40%' }} />
      </div>
    </div>
  )
}

function NotePreview({ state }: { state: NoteTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Title line */}
      <div className="h-[4px] rounded-full bg-[rgb(var(--color-text-primary))] opacity-40" style={{ width: '80%' }} />
      {/* Note lines */}
      <div className="flex flex-col gap-[3px] mt-1 flex-1 overflow-hidden">
        {[95, 85, 70, 90, 60].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] opacity-25" style={{ width: `${w}%` }} />
        ))}
        <div className="h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] opacity-15" style={{ width: '50%' }} />
      </div>
      {/* Verse tag if applicable */}
      {state.verseRef && (
        <div className="flex-shrink-0 h-[3px] rounded-full bg-[rgb(234,179,8)] opacity-40" style={{ width: '55%' }} />
      )}
    </div>
  )
}

function LexiconPreview({ state }: { state: LexiconTabState }) {
  const isHebrew = state.strongsNum?.startsWith('H')
  const color = isHebrew ? 'rgb(251,191,36)' : 'rgb(99,102,241)'
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 overflow-hidden">
      {state.strongsNum ? (
        <>
          <span
            className="text-[11px] font-bold leading-none"
            style={{ color }}
          >
            {state.strongsNum}
          </span>
          {/* Simulated definition lines */}
          <div className="flex flex-col gap-[3px] w-full">
            <div className="h-[3px] rounded-full" style={{ background: color, opacity: 0.35, width: '90%' }} />
            <div className="h-[3px] rounded-full" style={{ background: color, opacity: 0.2, width: '65%' }} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-[3px] w-full items-center">
          <div className="h-[3px] rounded-full bg-[rgb(52,211,153)] opacity-30" style={{ width: '70%' }} />
          <div className="h-[3px] rounded-full bg-[rgb(52,211,153)] opacity-20" style={{ width: '50%' }} />
        </div>
      )}
    </div>
  )
}

function YouTubePreview() {
  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      {/* Mini video thumbnail placeholder */}
      <div className="w-full h-full rounded-sm bg-[rgb(var(--color-surface-4))] flex items-center justify-center relative overflow-hidden">
        {/* 16:9 letterbox lines */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-black/30" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-black/30" />
        {/* Play button */}
        <div className="w-0 h-0 border-l-[7px] border-l-[rgb(239,68,68)] border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent" />
      </div>
    </div>
  )
}

function SearchPreview({ state }: { state: SearchTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Search bar line */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <div className="w-[6px] h-[6px] rounded-full border border-[rgb(167,139,250)] opacity-50 flex-shrink-0" />
        <div className="flex-1 h-[3px] rounded-full bg-[rgb(167,139,250)] opacity-25" />
      </div>
      {/* Result lines */}
      <div className="flex flex-col gap-[3px] mt-0.5 flex-1 overflow-hidden">
        {[75, 60, 85, 55].map((w, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="w-[3px] h-[3px] rounded-full bg-[rgb(167,139,250)] opacity-40 flex-shrink-0" />
            <div className="h-[2.5px] rounded-full bg-[rgb(var(--color-text-muted))] opacity-20" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TabPreview({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'bible':   return <BiblePreview   state={tab.state as BibleTabState}   />
    case 'note':    return <NotePreview    state={tab.state as NoteTabState}    />
    case 'lexicon': return <LexiconPreview state={tab.state as LexiconTabState} />
    case 'youtube': return <YouTubePreview />
    case 'search':  return <SearchPreview  state={tab.state as SearchTabState}  />
    default:        return null
  }
}

// ────────────────────────────────────────────────────────────────────────────

export default function TabSwitcher({ tabs, selectedIndex }: TabSwitcherProps) {
  if (tabs.length === 0) return null

  const selected = tabs[selectedIndex]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      {/* Switcher card */}
      <div className="relative pointer-events-none bg-[rgb(var(--color-surface-2))]/95 border border-[rgb(var(--color-surface-4))] rounded-2xl shadow-2xl px-5 py-4 flex flex-col items-center gap-4 min-w-[240px] max-w-[min(90vw,760px)]">

        {/* Tab cards row */}
        <div className="flex flex-wrap justify-center gap-2.5">
          {tabs.map((tab, i) => {
            const cfg = SPACE_CONFIG[tab.spaceId]
            const isSelected = i === selectedIndex
            return (
              <div
                key={`${tab.spaceId}-${tab.tabId}`}
                className={`flex flex-col w-[96px] rounded-xl overflow-hidden transition-all duration-75 ${
                  isSelected
                    ? 'bg-[rgb(var(--color-surface-4))]'
                    : 'bg-[rgb(var(--color-surface-3))]'
                }`}
                style={isSelected ? { outline: `2px solid ${cfg.color}`, outlineOffset: '-2px' } : undefined}
              >
                {/* Visual preview area */}
                <div
                  className="w-full h-[60px] px-2 pt-2 pb-1.5 relative overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${cfg.color}08 0%, ${cfg.color}03 100%)` }}
                >
                  <TabPreview tab={tab.tab} />
                </div>

                {/* Footer: badge + title */}
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[rgb(var(--color-surface-4))/50]">
                  {/* Space badge pill */}
                  <div
                    className="w-4 h-4 rounded-md flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: cfg.color }}
                  >
                    {cfg.abbrev}
                  </div>
                  {/* Tab title */}
                  <p
                    className={`text-[9px] leading-tight truncate flex-1 min-w-0 ${
                      isSelected
                        ? 'text-[rgb(var(--color-text-primary))] font-medium'
                        : 'text-[rgb(var(--color-text-muted))]'
                    }`}
                  >
                    {tab.title}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Selected tab status bar */}
        {selected && (
          <div className="text-xs text-[rgb(var(--color-text-secondary))] border-t border-[rgb(var(--color-surface-4))] pt-3 w-full text-center">
            <span className="font-medium" style={{ color: SPACE_CONFIG[selected.spaceId].color }}>
              {SPACE_CONFIG[selected.spaceId].label}
            </span>
            {' · '}
            <span className="text-[rgb(var(--color-text-primary))] font-medium">{selected.title}</span>
          </div>
        )}
      </div>
    </div>
  )
}
