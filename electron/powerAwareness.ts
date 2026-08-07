import { BrowserWindow, powerMonitor } from 'electron'

// A resource-mode signal Berean's own background work (vault file-watcher polling cadence,
// YouTube tab's re-injection/transcript-sync polling, etc.) can throttle against, so a
// long-running session doesn't keep spending CPU/battery on those loops at full speed
// regardless of what else is competing for the machine.
//
// Electron has no API to detect that a DIFFERENT app (Zoom, etc.) is screen-sharing — that's
// simply not observable from outside the sharing process on any platform Electron targets.
// `on-battery` + macOS `thermal-state-change` are used as a practical proxy instead: a video
// call sharing a screen is exactly the kind of sustained CPU/GPU load that also tends to push
// a laptop onto its fans and, if unplugged, draw down the battery — the same signal is useful
// for "just running for hours unplugged" too, not only screen-share specifically.
export type ResourceMode = 'normal' | 'throttled'

let mode: ResourceMode = 'normal'
let onBattery = false
// 'critical'/'serious' are the two thermal-pressure states above 'nominal'/'fair' on macOS.
let thermalPressure = false
const listeners = new Set<(mode: ResourceMode) => void>()

function recompute() {
  const next: ResourceMode = onBattery || thermalPressure ? 'throttled' : 'normal'
  if (next === mode) return
  mode = next
  listeners.forEach((cb) => cb(mode))
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('app:resourceModeChanged', mode)
  })
}

export function getResourceMode(): ResourceMode {
  return mode
}

// Renderer-side consumers (YouTube tab polling, etc.) call this instead of hardcoding a
// multiplier inline, so the "how much do we back off" policy lives in one place.
export function throttledInterval(baseMs: number): number {
  return mode === 'throttled' ? baseMs * 2 : baseMs
}

export function onResourceModeChanged(cb: (mode: ResourceMode) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setupPowerAwareness() {
  try {
    onBattery = powerMonitor.isOnBatteryPower()
  } catch {
    onBattery = false
  }
  powerMonitor.on('on-battery', () => { onBattery = true; recompute() })
  powerMonitor.on('on-ac', () => { onBattery = false; recompute() })
  // macOS-only event; powerMonitor silently never fires it elsewhere.
  powerMonitor.on('thermal-state-change', () => {
    const state = powerMonitor.getCurrentThermalState()
    thermalPressure = state === 'critical' || state === 'serious'
    recompute()
  })
  recompute()
}
