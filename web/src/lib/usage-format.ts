// Pure usage formatting, ported from Orca (src/shared/rate-limit-reset-format.ts
// and src/shared/usage-percentage-display.ts) without its i18n coupling. Labels
// are composed in the component through Omni's own i18n.

export type UsagePercentageDisplay = "used" | "remaining";

// Floor durations to whole units (47m, 3h 54m, 6d 7h); nonpositive returns "now".
export function formatResetDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Round and clamp a used percentage to 0..100; non-finite input is treated as 0
// so invalid provider data never reads as full capacity.
export function clampUsedPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.max(0, Math.min(100, Math.round(usedPercent)));
}

// The number to show, as used or remaining. Used is rounded before complementing
// so raw and pre-rounded inputs agree (20.5 used -> 79 remaining, not 80).
export function displayedPercentage(usedPercent: number, display: UsagePercentageDisplay): number {
  // Invalid provider data must not read as 100% remaining capacity.
  if (!Number.isFinite(usedPercent)) return 0;
  const rounded = clampUsedPercent(usedPercent);
  return display === "used" ? rounded : 100 - rounded;
}
