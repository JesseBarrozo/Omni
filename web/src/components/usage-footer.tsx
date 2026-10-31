// Account usage segment for the status bar, modelled on Orca's provider
// segments: one compact pill per configured provider. Phase A shows presence
// and a status; once windows arrive (phase B) each pill shows the tightest
// window as "{used}% · resets in {duration}".

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useTranslation } from "@/i18n";
import { displayedPercentage, formatResetDuration } from "@/lib/usage-format";
import type { UsageProvider, UsageSnapshot, UsageWindow } from "@/lib/usage-types";

// The window closest to exhaustion drives the pill, matching Orca's headline.
function tightestWindow(windows: UsageWindow[]): UsageWindow | null {
  if (windows.length === 0) return null;
  return windows.reduce((worst, window) => (window.usedPercent > worst.usedPercent ? window : worst));
}

export function UsageFooter() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setSnapshot(await api<UsageSnapshot>("/usage"));
    } catch {
      // The bar is ambient; a failed load leaves the previous snapshot in place.
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = snapshot?.providers.filter((provider) => provider.configured) ?? [];

  function pillText(provider: UsageProvider): string {
    const window = tightestWindow(provider.windows);
    if (window) {
      const percent = t("usage.percentUsed", { value: displayedPercentage(window.usedPercent, "used") });
      if (window.resetsAt) {
        const duration = formatResetDuration(window.resetsAt - Date.now());
        return `${percent} · ${t("usage.resetsIn", { duration })}`;
      }
      return percent;
    }
    return t("usage.unavailable");
  }

  return (
    <span className="usage-footer" aria-label={t("usage.title")}>
      {configured.length === 0 ? (
        <span className="usage-empty">{t("usage.none")}</span>
      ) : (
        configured.map((provider) => (
          <span key={provider.id} className="usage-pill" title={`${provider.label} · ${pillText(provider)}`}>
            <span className="usage-pill-label">{provider.label}</span>
            <span className="usage-pill-value">{pillText(provider)}</span>
          </span>
        ))
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("usage.refresh")}
        title={t("usage.refresh")}
        disabled={busy}
        onClick={() => void load()}
      >
        <RefreshCw className={busy ? "animate-spin" : undefined} />
      </Button>
    </span>
  );
}
