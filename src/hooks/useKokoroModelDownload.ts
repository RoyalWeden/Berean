import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  downloadReducer, initialModelDownloadState, isModelReady, canStartDownload,
  type ModelDownloadState,
} from '@/lib/tts/kokoro/modelDownloadState'

/**
 * Read Aloud (TTS) — drives AudioSection.tsx's Kokoro download UI. Wraps the pure
 * `downloadReducer` (modelDownloadState.ts) around the actual `window.ttsModel` IPC bridge, and
 * mirrors the final ready/not-ready outcome into the store's `kokoroModelReady` flag so
 * `ttsEngine.ts`'s active backend gets swapped the moment a download completes (see
 * store/index.ts's `setKokoroModelReady`).
 */
export function useKokoroModelDownload() {
  const [state, dispatch] = useReducer(downloadReducer, initialModelDownloadState)
  const setKokoroModelReady = useAppStore((s) => s.setKokoroModelReady)
  const mountedRef = useRef(true)
  // True once `getStatus()` reports an existing pack that's complete except for the ORT WASM
  // runtime file added after this feature first shipped (see ttsModelManifest.ts's
  // `needsRuntimeFile`). Steers BOTH the auto-triggered upgrade below and any user-initiated
  // retry (the same "Download neural voice model" button, re-clicked after a failure) towards
  // the small `downloadRuntimeFile` IPC call instead of re-running the whole ~125MB `download`.
  const runtimeOnlyRef = useRef(false)
  useEffect(() => () => { mountedRef.current = false }, [])

  const runDownload = useCallback(async (fn: () => Promise<{ success: true } | { success: false; error: string }>) => {
    dispatch({ type: 'START' })
    try {
      const result = await fn()
      // The GLOBAL store write must happen whether or not this hook is still mounted. Settings is
      // a modal, and a ~125MB download easily outlives the user's patience for sitting on that
      // screen — closing it unmounts this hook. The old code returned on `!mountedRef.current`
      // BEFORE this point, so a download that finished after the modal was closed left
      // `kokoroModelReady` false indefinitely: the pack was complete on disk, but nothing told
      // the app until the next mount-time `getStatus()` re-checked it. That is precisely the
      // reported "I have to close Settings and reopen it before it shows as ready."
      // `mountedRef` correctly guards `dispatch` (local reducer state — pointless to update once
      // unmounted); it was never the right guard for global state.
      if (result.success) setKokoroModelReady(true)
      if (!mountedRef.current) return
      if (result.success) {
        dispatch({ type: 'READY' })
      } else if (result.error === 'Cancelled') {
        dispatch({ type: 'CANCELLED' })
      } else {
        dispatch({ type: 'FAILED', error: result.error })
      }
    } catch (e) {
      if (mountedRef.current) dispatch({ type: 'FAILED', error: String((e as Error)?.message ?? e) })
    }
  }, [setKokoroModelReady])

  // Check the on-disk status once on mount — a previous session may have already downloaded
  // (or the user may have cleared it since), independent of whatever this component's own
  // in-memory `state` starts as.
  useEffect(() => {
    let cancelled = false
    window.ttsModel?.getStatus().then((status) => {
      if (cancelled) return
      if (status.ready) {
        dispatch({ type: 'READY' })
        setKokoroModelReady(true)
      } else if (status.needsRuntimeFile) {
        // Auto-upgrade, no user click required — this is a small (~21.6MB), one-time fetch of a
        // file that simply didn't exist in the manifest schema when this pack was first
        // downloaded, not a new opt-in the user needs to approve again (they already opted into
        // the neural engine once). The existing "Downloading… X / ~Y MB" UI just shows the
        // small total instead of the full pack's.
        runtimeOnlyRef.current = true
        void runDownload(() => window.ttsModel.downloadRuntimeFile())
      }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.ttsModel?.onDownloadProgress((p) => {
      dispatch({ type: 'PROGRESS', receivedBytes: p.receivedBytes, totalBytes: p.totalBytes })
    })
    window.ttsModel?.onDownloadVerifying(() => dispatch({ type: 'VERIFYING' }))
  }, [])

  const startDownload = useCallback(async () => {
    if (!canStartDownload(state)) return
    // Deliberately does NOT reset `runtimeOnlyRef` — if the mount-time check above already
    // determined this is a runtime-file-only upgrade, a user-initiated retry (after FAILED) must
    // stay on that same small download, not silently escalate into a full ~125MB re-download.
    await runDownload(runtimeOnlyRef.current ? () => window.ttsModel.downloadRuntimeFile() : () => window.ttsModel.download())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, runDownload])

  const cancelDownload = useCallback(() => {
    void window.ttsModel?.cancelDownload()
  }, [])

  const clearModelCache = useCallback(async () => {
    await window.ttsModel?.clearModelCache()
    runtimeOnlyRef.current = false
    dispatch({ type: 'RESET' })
    setKokoroModelReady(false)
  }, [setKokoroModelReady])

  return {
    state: state as ModelDownloadState,
    ready: isModelReady(state),
    canStart: canStartDownload(state),
    startDownload,
    cancelDownload,
    clearModelCache,
  }
}
