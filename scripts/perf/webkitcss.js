// Throwaway DOM only (never saved): 300 rich rows in a container; time inserting one row at the
// top with the app's CSS as shipped, then with Tailwind 3's universal sibling rules added back.
const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px'; document.body.appendChild(host)
const row = () => { const r = document.createElement('div'); r.className = 'chat-row px-3'; r.innerHTML = '<div class="group flex"><div class="chat-ai-column"><div class="chat-rich chat-md">' + '<p>Grace that bringeth salvation <b>teaches</b> us</p><ul class="chat-list"><li><p>one</p></li><li><p>two</p></li></ul><table class="chat-table"><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>'.repeat(2) + '</div></div></div>'; return r }
for (let i = 0; i < 300; i++) host.appendChild(row())
const time = () => { const xs = []; for (let k = 0; k < 5; k++) { void host.offsetHeight; const x = row(); const t0 = performance.now(); host.insertBefore(x, host.firstChild); void host.offsetHeight; xs.push(performance.now() - t0); x.remove() } xs.sort((a, b) => a - b); return Math.round(xs[2] * 10) / 10 }
const shipped = time()
const st = document.createElement('style'); st.textContent = '.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 12px } .chat-rich > * + * { margin-top: 4px } .x + * { margin-top: 0 }'; document.head.appendChild(st)
const withOld = time()
st.remove(); host.remove()
return JSON.stringify({ shippedCssMs: shipped, withUniversalSiblingRulesMs: withOld })
