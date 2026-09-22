import React, { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { useActionSheet } from '../primitives/ActionSheet'
import { TranscriptPacksPage } from '../youtube/TranscriptPacksPage'
import { haptic } from '../primitives/haptics'

type WatchHistoryEntry = Awaited<ReturnType<typeof window.youtube.getWatchHistory>>[number]

/**
 * Settings → YouTube on the phone (Phase 18, R087). The desktop section's controls, mapped:
 *  - Watch history (jump / remove / clear) — same `window.youtube` calls as desktop.
 *  - Transcript packs + the pack server URL (`transcriptPacksBaseUrl` setting; blank = the
 *    GitHub release for the bundled index version) — phone-only, since the desktop app ships
 *    every transcript in youtube_seed.db.
 *  - Default layout (side-by-side panels) and Auto Picture-in-Picture do not apply: the phone
 *    always shows one video, and the native player keeps playing when the YouTube space is left
 *    (system PiP comes from the fullscreen control). YouTube account sign-in is not offered: the
 *    embed player has no login (docs/mobile/implementation-progress.md, known limitations).
 */
export function YouTubeSettingsPage({ onBack }: { onBack?: () => void }) {
  const nav = useNavigation()
  const actions = useActionSheet()
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const [history, setHistory] = useState<WatchHistoryEntry[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [savedUrl, setSavedUrl] = useState('')

  const load = useCallback(() => {
    window.youtube.getWatchHistory().then(setHistory).catch(() => setHistory([]))
    window.settings.get('transcriptPacksBaseUrl').then((v) => { const s = typeof v === 'string' ? v : ''; setBaseUrl(s); setSavedUrl(s) }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const jump = (videoId: string) => {
    setActiveSpace('youtube')
    setTimeout(() => window.dispatchEvent(new CustomEvent('berean:openYouTubeVideo', { detail: { videoId } })), 150)
  }
  const remove = async (videoId: string) => {
    await window.youtube.removeFromHistory(videoId).catch(() => {})
    setHistory((prev) => prev.filter((h) => h.videoId !== videoId))
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
  }
  const clearAll = async () => {
    if (!confirm('Clear the whole watch history?')) return
    await window.youtube.clearWatchHistory().catch(() => {})
    setHistory([])
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
    void haptic.light()
  }
  const saveBaseUrl = async () => {
    const v = baseUrl.trim()
    await window.settings.set('transcriptPacksBaseUrl', v || null)
    setSavedUrl(v)
    void haptic.light()
  }

  // Group by calendar day, newest first (the desktop list groups by month → day).
  const byDay = new Map<string, WatchHistoryEntry[]>()
  for (const e of history) {
    const d = new Date(e.lastWatched)
    const key = isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  return (
    <Page title="YouTube" onBack={onBack}>
      <ListSection title="Transcripts">
        <Row title="Transcript packs" subtitle="Download channel transcripts for offline search" chevron onClick={() => nav.push('transcripts', <TranscriptPacksPage onBack={nav.pop} />)} />
        <div className="mobile-embedded-section">
          <label className="mobile-field-label" htmlFor="packs-base-url">Pack server</label>
          <input
            id="packs-base-url"
            className="mobile-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Default: GitHub release for this version"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => { if (baseUrl.trim() !== savedUrl) void saveBaseUrl() }}
          />
          <p className="mobile-field-hint">Where transcript packs are downloaded from. Leave blank for the published packs; set a URL to self-host them (a folder holding manifest.json and the pack files).</p>
        </div>
      </ListSection>
      <ListSection title={`Watch history${history.length ? ` (${history.length})` : ''}`}>
        {history.length === 0 && <Row title="No watch history yet" subtitle="Videos you watch and where you left off appear here" />}
        {[...byDay.entries()].map(([day, entries]) => (
          <React.Fragment key={day}>
            <Row title={<span className="mobile-row-group">{day}</span>} />
            {entries.map((e) => {
              const mins = Math.floor(e.positionSeconds / 60), secs = Math.floor(e.positionSeconds % 60)
              return (
                <Row
                  key={e.videoId}
                  leading={e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" className="mobile-thumb" /> : undefined}
                  title={e.title || e.videoId}
                  subtitle={`${e.channelName ? `${e.channelName} · ` : ''}Watched to ${mins}:${String(secs).padStart(2, '0')}`}
                  chevron
                  onClick={() => actions(`history-${e.videoId}`, e.title || e.videoId, [
                    { id: 'open', label: 'Open video', onSelect: () => jump(e.videoId) },
                    { id: 'remove', label: 'Remove from history', destructive: true, onSelect: () => { void remove(e.videoId) } },
                  ])}
                />
              )
            })}
          </React.Fragment>
        ))}
        {history.length > 0 && <Row title="Clear watch history" destructive onClick={() => { void clearAll() }} />}
      </ListSection>
    </Page>
  )
}
