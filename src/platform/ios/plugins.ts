import { registerPlugin } from '@capacitor/core'

/**
 * TypeScript faces of Berean's local Capacitor plugins (ios/App/BereanNative). Each interface
 * mirrors the Swift `pluginMethods` exactly; the Swift side is the source of truth.
 */

export type SqliteJsonValue = string | number | null | { __blob: string }

export interface BereanSQLitePlugin {
  /** `path` is symbolic: `bundle:data/kjva.db`, `appsupport:berean.db` or `memory:`. */
  open(opts: { path: string; readOnly?: boolean }): Promise<{ handle: number; readOnly: boolean }>
  close(opts: { handle: number }): Promise<void>
  exec(opts: { handle: number; sql: string }): Promise<void>
  run(opts: { handle: number; sql: string; params?: SqliteJsonValue[] }): Promise<{ changes: number; lastInsertRowid: number }>
  query(opts: { handle: number; sql: string; params?: SqliteJsonValue[] }): Promise<{ rows: Record<string, SqliteJsonValue>[] }>
  batch(opts: { handle: number; statements: Array<{ sql: string; params?: SqliteJsonValue[]; kind?: 'run' | 'query' }> }): Promise<{ results: Array<{ changes?: number; lastInsertRowid?: number; rows?: Record<string, SqliteJsonValue>[] }> }>
  attach(opts: { handle: number; path: string; alias: string }): Promise<void>
  detach(opts: { handle: number; alias: string }): Promise<void>
  fileInfo(opts: { path: string }): Promise<{ exists: boolean; size: number; readOnly: boolean }>
}

export const BereanSQLite = registerPlugin<BereanSQLitePlugin>('BereanSQLite')

export interface CloudEntry { name: string; isDir: boolean; downloaded: boolean }
export interface CloudStatus { available: boolean; signedIn: boolean; reason?: string; containerId: string; path?: string; deviceName: string }
export interface CloudChange { paths: string[]; initial: boolean }

/** iCloud Drive container access for the sync journal (ios/App/BereanNative/.../BereanCloudPlugin.swift).
 *  Paths are relative to `<container>/Documents/sync/v1`. */
export interface BereanCloudPlugin {
  status(): Promise<CloudStatus>
  mkdir(opts: { path: string }): Promise<void>
  list(opts: { path: string }): Promise<{ entries: CloudEntry[] }>
  /** `text` is null while `downloading` (iCloud has the file but it is not local yet). */
  read(opts: { path: string }): Promise<{ exists: boolean; downloading: boolean; text: string | null }>
  write(opts: { path: string; text: string }): Promise<void>
  remove(opts: { path: string }): Promise<void>
  startWatching(): Promise<void>
  stopWatching(): Promise<void>
  addListener(event: 'change', cb: (change: CloudChange) => void): Promise<{ remove: () => Promise<void> }>
}

export const BereanCloud = registerPlugin<BereanCloudPlugin>('BereanCloud')

/** Audio session + lock-screen controls for Read Aloud (BereanAudioPlugin.swift). */
export interface BereanAudioPlugin {
  activateSession(): Promise<void>
  deactivateSession(): Promise<void>
  setNowPlaying(info: { title: string; artist?: string; album?: string; duration?: number; position?: number; isPlaying: boolean; rate?: number }): Promise<void>
  clearNowPlaying(): Promise<void>
  addListener(event: 'command', cb: (e: { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'stop' }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanAudio = registerPlugin<BereanAudioPlugin>('BereanAudio')

/** System speech voices for Read Aloud (BereanSpeechPlugin.swift). */
export interface BereanSpeechPlugin {
  voices(): Promise<{ voices: Array<{ id: string; name: string; lang: string; quality: 'Default' | 'Enhanced' | 'Premium' }> }>
  speak(opts: { id: string; text: string; voice?: string | null; lang?: string; rate?: number }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  status(): Promise<{ speaking: boolean; paused: boolean }>
  addListener(event: 'start' | 'end' | 'cancel', cb: (e: { id: string }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'boundary', cb: (e: { id: string; charIndex: number; charLength: number }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanSpeech = registerPlugin<BereanSpeechPlugin>('BereanSpeech')

/** Native YouTube player web view (BereanWebViewPlugin.swift). Rect in CSS px of the app web view. */
export interface BereanWebViewPlugin {
  open(opts: { videoId: string; startTime?: number; rect: { x: number; y: number; width: number; height: number } }): Promise<void>
  setRect(opts: { rect: { x: number; y: number; width: number; height: number } }): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  command(opts: { func: string; args?: unknown[] }): Promise<void>
  close(): Promise<void>
  addListener(event: 'ready', cb: () => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'state', cb: (e: { state: number }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'error', cb: (e: { code: number }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'position', cb: (e: { t: number; d: number }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanWebView = registerPlugin<BereanWebViewPlugin>('BereanWebView')

/** Resumable, cancellable downloads with SHA-256 on completion (BereanDownloadsPlugin.swift). */
export interface BereanDownloadsPlugin {
  start(opts: { id: string; url: string; name: string }): Promise<{ resumed: boolean }>
  cancel(opts: { id: string }): Promise<{ resumable: boolean }>
  remove(opts: { name: string }): Promise<void>
  list(): Promise<{ files: Array<{ name: string; bytes: number }> }>
  addListener(event: 'progress', cb: (e: { id: string; received: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'done', cb: (e: { id: string; name: string; path: string; sha256: string; bytes: number }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'error', cb: (e: { id: string; message: string; resumable?: boolean }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'cancelled', cb: (e: { id: string; resumable: boolean }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanDownloads = registerPlugin<BereanDownloadsPlugin>('BereanDownloads')

/** AirPrint / PDF export of note HTML (BereanPrintPlugin.swift). */
export interface BereanPrintPlugin {
  printHtml(opts: { html: string; title?: string }): Promise<{ success: boolean }>
  exportPdf(opts: { html: string; name: string; pageSize?: string }): Promise<{ success: boolean; canceled?: boolean }>
}
export const BereanPrint = registerPlugin<BereanPrintPlugin>('BereanPrint')

/** Core Spotlight indexing (BereanSpotlightPlugin.swift); `open` carries the tapped item's deep link. */
export interface BereanSpotlightPlugin {
  isAvailable(): Promise<{ available: boolean }>
  index(opts: { items: Array<{ url: string; title: string; text?: string; keywords?: string[]; updatedAt?: number }> }): Promise<{ indexed: number }>
  remove(opts: { urls: string[] }): Promise<void>
  clear(): Promise<void>
  addListener(event: 'open', cb: (e: { url: string }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanSpotlight = registerPlugin<BereanSpotlightPlugin>('BereanSpotlight')

/** Power / thermal awareness (BereanPowerPlugin.swift): Low Power Mode or serious/critical thermal state → 'throttled'. */
export interface BereanPowerPlugin {
  getResourceMode(): Promise<{ mode: 'normal' | 'throttled'; lowPowerMode: boolean; thermalState: number }>
  addListener(event: 'change', cb: (e: { mode: 'normal' | 'throttled' }) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanPower = registerPlugin<BereanPowerPlugin>('BereanPower')

/** App Group inbox filled by the Share Extension (BereanShareInboxPlugin.swift). */
export interface ShareInboxItem { id?: string; kind: 'text' | 'url' | 'pdf'; text?: string; url?: string; file?: string; name?: string; receivedAt?: number }
export interface BereanShareInboxPlugin {
  /** Pending items — nothing is removed until `ack`. */
  take(): Promise<{ items: ShareInboxItem[] }>
  readFile(opts: { file: string }): Promise<{ base64: string; bytes: number }>
  /** Remove handled items and their files (idempotent). */
  ack(opts: { ids: string[]; files?: string[] }): Promise<void>
}
export const BereanShareInbox = registerPlugin<BereanShareInboxPlugin>('BereanShareInbox')

/** Accessibility signals (BereanA11yPlugin.swift): Dynamic Type scale, VoiceOver, Reduce Motion, Bold Text, Increase Contrast. */
export interface BereanA11yState { contentSize: string; scale: number; voiceOver: boolean; reduceMotion: boolean; boldText: boolean; increaseContrast: boolean; reduceTransparency?: boolean }
export interface BereanA11yPlugin {
  getState(): Promise<BereanA11yState>
  addListener(event: 'change', cb: (e: BereanA11yState) => void): Promise<{ remove: () => Promise<void> }>
}
export const BereanA11y = registerPlugin<BereanA11yPlugin>('BereanA11y')
