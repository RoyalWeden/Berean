import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Download, X, Trash2, Check } from 'lucide-react'
import {
  voicePackStore, refreshVoicePack, startVoicePackDownload, cancelVoicePackDownload, removeVoicePack,
  type VoicePackState,
} from '@/platform/ios/voicePack'
import { KOKORO_VOICE_OPTIONS } from '@/lib/tts/kokoro/kokoroVoices'
import { ListSection, Row } from '../primitives/Page'

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/** The Berean Voices download state, live (survives leaving the screen mid-download). */
export function useVoicePack(): VoicePackState {
  const st = useSyncExternalStore(voicePackStore.subscribe, voicePackStore.get)
  useEffect(() => { void refreshVoicePack() }, [])
  return st
}

/** One-line status for the rows that lead here (Settings root, Read Aloud, the player). */
export function voicePackSubtitle(st: VoicePackState): string {
  switch (st.status) {
    case 'ready': return 'Installed — natural voices, offline'
    case 'downloading': return `Downloading… ${Math.min(99, Math.floor((st.receivedBytes / Math.max(1, st.totalBytes)) * 100))}%`
    case 'verifying': return 'Finishing…'
    case 'error': return 'Download didn’t finish — tap to try again'
    default: return `Natural voices, offline — one download (${mb(st.totalBytes)})`
  }
}

/**
 * Settings → Read Aloud → Berean Voices (and the player's Voice view). Berean's own neural voices —
 * the same ones as the Mac (Kokoro) — downloaded once with one tap and then read offline, run
 * natively on the iPhone (src/platform/ios/voicePack.ts, BereanVoicePackPlugin.swift). Until they
 * are downloaded Read Aloud uses the iPhone's system voice.
 */
export function GetVoicesView() {
  const st = useVoicePack()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const busy = st.status === 'downloading' || st.status === 'verifying'
  const pct = Math.min(100, Math.floor((st.receivedBytes / Math.max(1, st.totalBytes)) * 100))
  return (
    <div className="get-voices">
      <div className="settings-section-note">
        Berean’s own natural-sounding voices — the same ones as Berean on the Mac. Download them once and Read Aloud
        works offline, with no internet needed.
      </div>
      {st.status === 'ready' ? (
        <>
          <ListSection title="Berean Voices">
            <Row leading={<Check size={18} aria-hidden />} title="Installed" subtitle="Read Aloud uses Berean Voices. Choose one in Voice." />
          </ListSection>
          <ListSection>
            {confirmRemove ? (
              <>
                <Row leading={<Trash2 size={18} aria-hidden />} title={<span className="get-voices-destructive">Remove Berean Voices</span>} subtitle={`Frees about ${mb(st.totalBytes)}. Read Aloud goes back to the iPhone’s system voice.`} onClick={() => { setConfirmRemove(false); void removeVoicePack() }} />
                <Row title="Keep Them" onClick={() => setConfirmRemove(false)} />
              </>
            ) : (
              <Row leading={<Trash2 size={18} aria-hidden />} title="Remove Berean Voices…" subtitle={`Uses about ${mb(st.totalBytes)}`} onClick={() => setConfirmRemove(true)} />
            )}
          </ListSection>
        </>
      ) : (
        <ListSection title="Berean Voices">
          {busy ? (
            <>
              <div className="get-voices-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Downloading Berean Voices">
                <div className="get-voices-progress-label">
                  <span>{st.status === 'verifying' ? 'Finishing…' : 'Downloading…'}</span>
                  <span>{mb(st.receivedBytes)} of {mb(st.totalBytes)}</span>
                </div>
                <div className="get-voices-progress-track"><div className="get-voices-progress-fill" style={{ width: `${pct}%` }} /></div>
              </div>
              {st.status === 'downloading' && <Row leading={<X size={18} aria-hidden />} title="Cancel Download" onClick={cancelVoicePackDownload} />}
            </>
          ) : (
            <Row
              leading={<Download size={18} aria-hidden />}
              title={st.status === 'error' ? 'Try Again' : 'Download Berean Voices'}
              subtitle={st.status === 'error' ? st.error ?? 'The download didn’t finish.' : `${mb(st.totalBytes)} · free · ${KOKORO_VOICE_OPTIONS.length} voices`}
              onClick={() => { void startVoicePackDownload() }}
            />
          )}
        </ListSection>
      )}
      {st.status !== 'ready' && (
        <div className="settings-section-note">Use Wi‑Fi if you can, and keep Berean open until the download finishes.</div>
      )}
    </div>
  )
}
