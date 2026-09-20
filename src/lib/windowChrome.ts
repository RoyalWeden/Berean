/**
 * Shared window-chrome constants. The traffic-light inset and header height are read by
 * ShellHeader.tsx (and referenced in comments elsewhere) — pulled out to one place so the two
 * files that care about "how tall is the bar" / "how much room do the traffic lights need"
 * don't each hardcode the same numbers.
 */
export const TRAFFIC_LIGHT_INSET = 76
export const HEADER_HEIGHT = 44
