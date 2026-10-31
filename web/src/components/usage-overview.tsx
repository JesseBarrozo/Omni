import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Coins, DatabaseZap, RefreshCw, Sparkles, Bot, Clock3, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Overview = {
  agentsLaunched: number;
  workMs: number;
  prsCreated: number;
  totalTokens: number;
  estimatedCostUsd: number;
  activeDays: number;
  cacheShare: number | null;
  daily: { date: string; value: number }[];
  providerTokens: Record<string, number>;
  lastUpdatedAt: string | null;
};

const formatTokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.round(value));
const formatWork = (value: number) => {
  const minutes = Math.round(value / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

function StatCard({ icon: Icon, value, label }: { icon: typeof Bot; value: string; label: string }) {
  return <div className="usage-stat-card"><span className="usage-stat-icon"><Icon /></span><span><strong>{value}</strong><small>{label}</small></span></div>;
}

export function UsageOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Overview>("/usage/overview")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const maxDay = useMemo(() => Math.max(1, ...(data?.daily.map((day) => day.value) ?? [])), [data]);
  const providers = useMemo(() => Object.entries(data?.providerTokens ?? {}).sort((a, b) => b[1] - a[1]), [data]);
  if (loading && !data) return <section className="usage-overview"><p className="usage-overview-loading">Chargement des statistiques…</p></section>;
  return <section className="usage-overview" aria-label="Statistiques et usage">
    <div className="usage-overview-actions">
      <div className="usage-card-heading usage-overview-heading">
        <div>
          <h2>Statistiques &amp; usage</h2>
        </div>
      </div>
      <Button variant="outline" size="icon" aria-label="Actualiser les statistiques" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
    </div>
    {error && error !== "Route introuvable." && <p className="orca-error" role="alert">{error}</p>}
    <div className="usage-stat-grid">
      <StatCard icon={Bot} value={String(data?.agentsLaunched ?? 0)} label="Agents lancés" />
      <StatCard icon={Clock3} value={formatWork(data?.workMs ?? 0)} label="Temps de travail des agents" />
      <StatCard icon={GitPullRequest} value={String(data?.prsCreated ?? 0)} label="PRs créées" />
    </div>
    <div className="usage-overview-card"><div className="usage-card-heading"><div><h2>Vue d’ensemble de l’utilisation</h2></div><Activity /></div>
      <div className="usage-metric-grid">
        <StatCard icon={Sparkles} value={formatTokens(data?.totalTokens ?? 0)} label="Total de tokens" />
        <StatCard icon={Coins} value={`$${(data?.estimatedCostUsd ?? 0).toFixed(2)}`} label="Coût estimé" />
        <StatCard icon={CalendarDays} value={String(data?.activeDays ?? 0)} label="Jours actifs" />
        <StatCard icon={DatabaseZap} value={data?.cacheShare == null ? "—" : `${Math.round(data.cacheShare * 100)}%`} label="Part du cache" />
      </div>
      <div className="usage-detail-grid"><div className="usage-detail-card"><h3>Intensité quotidienne</h3><p>Activité récente combinée des tokens.</p><div className="usage-grid" aria-label="Intensité quotidienne">{Array.from({ length: 42 }, (_, index) => { const day = data?.daily.at(-(42 - index)); const level = day ? Math.min(4, Math.ceil((day.value / maxDay) * 4)) : 0; return <span key={day?.date ?? index} className={`usage-grid-cell level-${level}`} title={day ? `${day.date} · ${formatTokens(day.value)} tokens` : "Aucune activité"} />; })}</div><div className="usage-axis"><span>Moins</span><span>Plus</span></div></div><div className="usage-detail-card"><h3>Répartition des tokens</h3><p>Tokens cumulés par fournisseur actif.</p><div className="usage-provider-bar">{providers.map(([provider, value]) => <span key={provider} style={{ width: `${(value / Math.max(1, data?.totalTokens ?? 1)) * 100}%` }} title={`${provider} · ${formatTokens(value)}`} />)}</div>{providers.length ? providers.map(([provider, value]) => <div className="usage-provider-row" key={provider}><span>{provider}</span><strong>{formatTokens(value)}</strong></div>) : <p className="usage-empty">Aucune utilisation enregistrée.</p>} </div></div>
    </div>
  </section>;
}
