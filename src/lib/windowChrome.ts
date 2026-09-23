/**
 * Shared window-chrome constants. The traffic-light inset and header height are read by
 * ShellHeader.tsx (and referenced in comments elsewhere) — pulled out to one place so the two
 * files that care about "how tall is the bar" / "how much room do the traffic lights need"
 * don't each hardcode the same numbers.
 */
export const TRAFFIC_LIGHT_INSET = 76
// TEST-010: bumped 44→52 for more vertical breathing room around the bar's controls (per
// direct feedback) — the single metric everything else (traffic-light y in electron/main.ts,
// docs/design-system.md) derives from, rather than nudging individual buttons.
export const HEADER_HEIGHT = 52
