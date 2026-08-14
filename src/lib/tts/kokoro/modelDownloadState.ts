/**
 * Read Aloud (TTS) — pure state machine for the Kokoro model download UI (AudioSection.tsx).
 * The actual download (streaming files from GitHub Releases into `userData`, see
 * `electron/ipc/ttsModel.ts`) lives in the main process; this reducer only tracks what the
 * renderer should SHOW, driven by IPC progress events fed into `downloadReducer` one at a time.
 * Kept separate from that IPC plumbing so the state transitions — especially the "a failed or
 * partial download must clean up and fall back to Web Speech" requirement — are testable without
 * mocking Electron at all.
 */

export type ModelDownloadStatus = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error'

export interface ModelDownloadState {
  status: ModelDownloadStatus
  receivedBytes: number
  totalBytes: number
  error: string | null
}

export const initialModelDownloadState: ModelDownloadState = {
  status: 'idle',
  receivedBytes: 0,
  totalBytes: 0,
  error: null,
}

export type ModelDownloadAction =
  | { type: 'START' }
  | { type: 'PROGRESS'; receivedBytes: number; totalBytes: number }
  | { type: 'VERIFYING' }
  | { type: 'READY' }
  | { type: 'FAILED'; error: string }
  | { type: 'CANCELLED' }
  | { type: 'RESET' }

/**
 * `idle`/`error` → START → `downloading` → (repeated PROGRESS) → VERIFYING → `verifying` →
 * READY → `ready`. FAILED/CANCELLED from any in-flight state (`downloading`/`verifying`) drop
 * back to `error`/`idle` respectively — the byte counters are zeroed either way, since whatever
 * partial bytes existed on disk are the download function's own responsibility to delete before
 * dispatching either action (see ttsModel.ts's cleanup-on-failure requirement; this reducer
 * only reflects that it happened, it doesn't perform the fs cleanup itself).
 */
export function downloadReducer(state: ModelDownloadState, action: ModelDownloadAction): ModelDownloadState {
  switch (action.type) {
    case 'START':
      return { status: 'downloading', receivedBytes: 0, totalBytes: 0, error: null }
    case 'PROGRESS':
      // Ignore stray progress events that arrive after a download has already left the
      // in-flight states (e.g. a late event from a just-cancelled download's still-unwinding
      // fetch) — without this guard a race could resurrect a "downloading" UI after the user
      // already saw it cancel/fail.
      if (state.status !== 'downloading' && state.status !== 'verifying') return state
      return { ...state, status: 'downloading', receivedBytes: action.receivedBytes, totalBytes: action.totalBytes }
    case 'VERIFYING':
      if (state.status !== 'downloading') return state
      return { ...state, status: 'verifying' }
    case 'READY':
      return { status: 'ready', receivedBytes: state.totalBytes, totalBytes: state.totalBytes, error: null }
    case 'FAILED':
      return { status: 'error', receivedBytes: 0, totalBytes: 0, error: action.error }
    case 'CANCELLED':
      return { ...initialModelDownloadState }
    case 'RESET':
      return { ...initialModelDownloadState }
    default:
      return state
  }
}

/** Whether the CURRENT state represents a download that's actually usable for playback —
 *  callers (AudioSection.tsx, selectBackend.ts) use this instead of comparing `status === 'ready'`
 *  directly so the "what counts as ready" definition lives in exactly one place. */
export function isModelReady(state: ModelDownloadState): boolean {
  return state.status === 'ready'
}

/** True for any state where a fresh download can be started (nothing already in flight). */
export function canStartDownload(state: ModelDownloadState): boolean {
  return state.status === 'idle' || state.status === 'error'
}
