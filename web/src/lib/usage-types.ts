// Shape of the account usage snapshot from GET /api/usage. It mirrors the
// server builder in src/usage.mjs. Phase A leaves `windows` empty; phase B fills
// it from the per-provider fetchers ported from Orca.

export type UsageAuthKind = "oauth" | "api-key";
export type UsageStatus = "ok" | "unavailable" | "not-configured" | "error";

export type UsageWindow = {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
};

export type UsageProvider = {
  id: string;
  label: string;
  configured: boolean;
  authKinds: UsageAuthKind[];
  status: UsageStatus;
  windows: UsageWindow[];
};

export type UsageSnapshot = {
  providers: UsageProvider[];
  updatedAt: string;
};
