// Shared CDP driver for keyboard benchmarks: real Input.dispatchKeyEvent, latency measured in-page
// from the event's own timeStamp to the next painted frame after a condition holds.
export async function connect(match = 'main') {
  const list = (await (await fetch('http://127.0.0.1:9224/json')).json()).filter((t) => t.type === 'page')
  const t = match === 'main' ? list.find((x) => x.url.startsWith('file:') && !/[?&](chat|viewer|studyTrail|float|versePicker)=1/.test(x.url)) : list.find((x) => x.url.includes(match))
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
  let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m) }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value }
  const KEYS = { Enter: 13, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowRight: 39, ArrowLeft: 37, Tab: 9 }
  const key = async (k, mods = []) => {
    const m = (mods.includes('meta') ? 4 : 0) | (mods.includes('shift') ? 8 : 0) | (mods.includes('alt') ? 1 : 0) | (mods.includes('ctrl') ? 2 : 0)
    const code = k.length === 1 ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : k === ' ' ? 'Space' : '') : k
    const vk = KEYS[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0)
    const text = k.length === 1 && !(m & 4) ? k : undefined
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, modifiers: m, windowsVirtualKeyCode: vk, text, unmodifiedText: text })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: m, windowsVirtualKeyCode: vk })
  }
  // Arm: next keydown's timeStamp → condition → 2 rAFs. Returns ms (or -1 on timeout).
  const arm = (cond, timeout = 4000) => ev(`window.__armed = new Promise((res) => { let t0 = null; const on = (e) => { if (t0 == null) t0 = e.timeStamp }; window.addEventListener('keydown', on, true); const s = performance.now(); const poll = () => { if (t0 != null && (${cond})) { requestAnimationFrame(() => requestAnimationFrame(() => { window.removeEventListener('keydown', on, true); res(Math.round((performance.now() - t0) * 10) / 10) })) } else if (performance.now() - s > ${timeout}) { window.removeEventListener('keydown', on, true); res(-1) } else setTimeout(poll, 0) }; poll() }); 1`)
  const result = () => ev('window.__armed')
  return { send, ev, key, arm, result, close: () => ws.close() }
}
export const stats = (a0) => { const a = a0.filter((x) => x >= 0).sort((p, q) => p - q); const q = (f) => a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))]; return { n: a.length, med: q(0.5), p95: q(0.95), max: a[a.length - 1], fails: a0.length - a.length } }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
