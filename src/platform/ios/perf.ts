/** Boot / first-render timings (R110), logged once as `[perf] <name> +<ms>` so a device run can
 *  be read from the console; `performance.now()` counts from the WebView's navigation start. */
export const perfMarks: Record<string, number> = {}
export function perfMark(name: string): void {
  if (name in perfMarks) return
  perfMarks[name] = Math.round(performance.now())
  console.log(`[perf] ${name} +${perfMarks[name]}ms`)
}
