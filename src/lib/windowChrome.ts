/**
 * Shared window-chrome constants. The traffic-light inset and header height are read by
 * ShellHeader.tsx (and referenced in comments elsewhere) — pulled out to one place so the two
 * files that care about "how tall is the bar" / "how much room do the traffic lights need"
 * don't each hardcode the same numbers.
 */
// 84 = the traffic lights' x (20, inside the glass sidebar pane — electron/main.ts) + their 56pt
// cluster + 8pt clearance.
export const TRAFFIC_LIGHT_INSET = 84
// TEST-010: bumped 44→52 for more vertical breathing room around the bar's controls (per
// direct feedback) — the single metric everything else (traffic-light y in electron/main.ts,
// docs/design-system.md) derives from, rather than nudging individual buttons.
export const HEADER_HEIGHT = 52
// The inner Toolbar is 44px (h-11) holding 36px controls; ShellHeader centres it vertically in
// this bar (flex column, justify-center), so the controls sit (HEADER_HEIGHT - 36) / 2 = 8px from
// both the top and bottom edges, on the same centre line as the traffic lights (y 20, 12px tall).
// Change HEADER_HEIGHT and the main-window trafficLightPosition y (electron/main.ts) together.
