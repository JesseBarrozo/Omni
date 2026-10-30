import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  X,
  Home,
  Globe,
  Lock,
  Compass,
  Copy,
  Check,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  ShieldCheck,
  ShieldAlert,
  Search,
  Clock,
  Trash2,
  Layers,
  Code2,
  Server,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type BrowserViewportPreset = "desktop" | "tablet" | "mobile";

export type OpenBrowserTab = {
  id: string;
  url: string;
  title: string;
  mode: "direct" | "proxy";
  viewportPreset: BrowserViewportPreset;
  history: string[];
  historyIndex: number;
  loading: boolean;
};

export type BrowserHistoryEntry = {
  url: string;
  title: string;
  timestamp: number;
};

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\d{2,5}$/.test(trimmed)) return `http://localhost:${trimmed}`;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function formatBrowserTabTitle(url: string): string {
  if (!url || url === "about:blank") return "Nouvel onglet";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return `Localhost${parsed.port ? `:${parsed.port}` : ""}`;
    }
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const LOCAL_PRESETS = [
  {
    name: "Vite Dev Server",
    url: "http://localhost:5173",
    description: "Port par défaut Vite / React / Vue",
    icon: Code2,
  },
  {
    name: "Next.js / Node Server",
    url: "http://localhost:3000",
    description: "Port par défaut Next.js, CRA, Express",
    icon: Server,
  },
  {
    name: "API Backend",
    url: "http://localhost:8080",
    description: "Serveur API ou micro-service",
    icon: Layers,
  },
  {
    name: "Omni Workspace GUI",
    url: "http://127.0.0.1:4318",
    description: "Interface locale du harness Omni",
    icon: Globe,
  },
];

const DOC_PRESETS = [
  {
    name: "GitHub",
    url: "https://github.com",
    description: "Dépôts, pull requests et issues",
    icon: Globe,
  },
  {
    name: "MDN Web Docs",
    url: "https://developer.mozilla.org",
    description: "Référence HTML, CSS et JavaScript",
    icon: BookOpen,
  },
  {
    name: "Tailwind CSS",
    url: "https://tailwindcss.com/docs",
    description: "Documentation des classes utilitaires",
    icon: BookOpen,
  },
  {
    name: "Documentation Antigravity",
    url: "https://cloud.google.com",
    description: "Guides et services de développement",
    icon: BookOpen,
  },
];

export function BrowserPane({
  tab,
  onUpdateTab,
  onCloseTab,
  onOpenNewTab,
  history,
  onAddHistory,
  onClearHistory,
}: {
  tab: OpenBrowserTab;
  onUpdateTab: (updates: Partial<OpenBrowserTab>) => void;
  onCloseTab: () => void;
  onOpenNewTab: (url?: string) => void;
  history: BrowserHistoryEntry[];
  onAddHistory: (url: string, title?: string) => void;
  onClearHistory: () => void;
}) {
  const [addressInput, setAddressInput] = useState(
    tab.url === "about:blank" ? "" : tab.url,
  );
  const [copied, setCopied] = useState(false);
  const [showIframeNotice, setShowIframeNotice] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setAddressInput(tab.url === "about:blank" ? "" : tab.url);
  }, [tab.url]);

  const navigateTo = useCallback(
    (targetUrl: string, recordHistory = true) => {
      const normalized = normalizeBrowserUrl(targetUrl);
      const title = formatBrowserTabTitle(normalized);
      const historyList = [...tab.history.slice(0, tab.historyIndex + 1), normalized];
      const newIndex = historyList.length - 1;

      onUpdateTab({
        url: normalized,
        title,
        loading: normalized !== "about:blank",
        ...(recordHistory ? { history: historyList, historyIndex: newIndex } : {}),
      });

      if (normalized !== "about:blank") {
        onAddHistory(normalized, title);
      }
    },
    [tab.history, tab.historyIndex, onUpdateTab, onAddHistory],
  );

  const handleAddressSubmit = () => {
    if (!addressInput.trim()) return;
    navigateTo(addressInput);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddressSubmit();
    } else if (event.key === "Escape") {
      setAddressInput(tab.url === "about:blank" ? "" : tab.url);
    }
  };

  const goBack = () => {
    if (tab.historyIndex > 0) {
      const nextIndex = tab.historyIndex - 1;
      const targetUrl = tab.history[nextIndex];
      onUpdateTab({
        url: targetUrl,
        title: formatBrowserTabTitle(targetUrl),
        historyIndex: nextIndex,
        loading: targetUrl !== "about:blank",
      });
    }
  };

  const goForward = () => {
    if (tab.historyIndex < tab.history.length - 1) {
      const nextIndex = tab.historyIndex + 1;
      const targetUrl = tab.history[nextIndex];
      onUpdateTab({
        url: targetUrl,
        title: formatBrowserTabTitle(targetUrl),
        historyIndex: nextIndex,
        loading: targetUrl !== "about:blank",
      });
    }
  };

  const handleReload = () => {
    if (tab.loading) {
      onUpdateTab({ loading: false });
    } else {
      onUpdateTab({ loading: true });
      if (iframeRef.current) {
        try {
          iframeRef.current.src = iframeRef.current.src;
        } catch {
          // Cross-origin reload
          const cur = iframeRef.current.src;
          iframeRef.current.src = "about:blank";
          setTimeout(() => {
            if (iframeRef.current) iframeRef.current.src = cur;
          }, 50);
        }
      }
    }
  };

  const copyUrl = async () => {
    if (!tab.url || tab.url === "about:blank") return;
    try {
      await navigator.clipboard.writeText(tab.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
    }
  };

  const openExternal = () => {
    if (tab.url && tab.url !== "about:blank") {
      window.open(tab.url, "_blank", "noopener,noreferrer");
    }
  };

  const toggleMode = () => {
    const nextMode = tab.mode === "direct" ? "proxy" : "direct";
    onUpdateTab({ mode: nextMode, loading: true });
  };

  const resolvedIframeSrc =
    tab.url === "about:blank"
      ? "about:blank"
      : tab.mode === "proxy"
        ? `/api/browser/proxy?url=${encodeURIComponent(tab.url)}`
        : tab.url;

  const isBlank = tab.url === "about:blank" || !tab.url;

  return (
    <section className="browser-pane">
      {/* Browser Chrome Header / Navigation Toolbar */}
      <header className="browser-toolbar">
        <div className="browser-nav-group">
          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            disabled={tab.historyIndex <= 0}
            onClick={goBack}
            title="Précédent"
            aria-label="Précédent"
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            disabled={tab.historyIndex >= tab.history.length - 1}
            onClick={goForward}
            title="Suivant"
            aria-label="Suivant"
          >
            <ArrowRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            onClick={handleReload}
            title={tab.loading ? "Arrêter" : "Actualiser"}
            aria-label={tab.loading ? "Arrêter" : "Actualiser"}
          >
            {tab.loading ? <X className="text-destructive" /> : <RefreshCw />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            onClick={() => navigateTo("about:blank")}
            title="Page d'accueil"
            aria-label="Page d'accueil"
          >
            <Home />
          </Button>
        </div>

        {/* Address Bar */}
        <div className="browser-address-container">
          <div className="browser-address-bar">
            {tab.url.startsWith("https://") ? (
              <Lock className="browser-protocol-icon is-secure" />
            ) : isBlank ? (
              <Compass className="browser-protocol-icon" />
            ) : (
              <Globe className="browser-protocol-icon" />
            )}
            <Input
              className="browser-address-input"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Saisissez une URL (ex: localhost:5173, github.com) ou une recherche…"
              aria-label="Barre d'adresse du navigateur"
            />
            {addressInput && (
              <button
                type="button"
                className="browser-address-clear"
                onClick={() => setAddressInput("")}
                title="Effacer"
              >
                <X />
              </button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "browser-mode-badge",
                tab.mode === "proxy" ? "is-proxy" : "is-direct",
              )}
              onClick={toggleMode}
              title={`Mode actuel : ${tab.mode === "proxy" ? "Proxy Omni (contourne CORS/X-Frame-Options)" : "Direct (iframe natif)"}. Cliquez pour basculer.`}
            >
              {tab.mode === "proxy" ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5" /> Proxy
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" /> Direct
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Viewport Presets & Secondary Actions */}
        <div className="browser-actions-group">
          <div className="browser-presets-switch" role="group" aria-label="Affichage de la vue">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "browser-btn",
                tab.viewportPreset === "desktop" && "is-selected",
              )}
              onClick={() => onUpdateTab({ viewportPreset: "desktop" })}
              title="Bureau (100%)"
              aria-label="Bureau (100%)"
            >
              <Monitor />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "browser-btn",
                tab.viewportPreset === "tablet" && "is-selected",
              )}
              onClick={() => onUpdateTab({ viewportPreset: "tablet" })}
              title="Tablette (768px)"
              aria-label="Tablette (768px)"
            >
              <Tablet />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "browser-btn",
                tab.viewportPreset === "mobile" && "is-selected",
              )}
              onClick={() => onUpdateTab({ viewportPreset: "mobile" })}
              title="Mobile (375px)"
              aria-label="Mobile (375px)"
            >
              <Smartphone />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            onClick={copyUrl}
            disabled={isBlank}
            title={copied ? "Copié !" : "Copier l'adresse URL"}
            aria-label="Copier l'adresse URL"
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            onClick={openExternal}
            disabled={isBlank}
            title="Ouvrir dans une fenêtre externe"
            aria-label="Ouvrir dans une fenêtre externe"
          >
            <ExternalLink />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="browser-btn"
            onClick={() => onOpenNewTab()}
            title="Nouvel onglet de navigation"
            aria-label="Nouvel onglet de navigation"
          >
            <Globe />
          </Button>
        </div>
      </header>

      {/* Loading Progress Line */}
      {tab.loading && <div className="browser-progress-bar" />}

      {/* Browser Surface */}
      <div className="browser-viewport-container">
        {isBlank ? (
          <BrowserNewTabPage
            onNavigate={(url) => navigateTo(url)}
            history={history}
            onClearHistory={onClearHistory}
          />
        ) : (
          <div
            className={cn(
              "browser-viewport-frame",
              tab.viewportPreset === "tablet" && "is-tablet",
              tab.viewportPreset === "mobile" && "is-mobile",
            )}
          >
            {tab.viewportPreset !== "desktop" && (
              <div className="browser-viewport-label">
                <span>{tab.viewportPreset === "tablet" ? "768px (Tablette)" : "375px (Mobile)"}</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={resolvedIframeSrc}
              className="browser-iframe"
              title={tab.title || "Navigateur interne"}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              onLoad={() => {
                onUpdateTab({ loading: false });
              }}
            />
            {showIframeNotice && tab.mode === "direct" && (
              <div className="browser-iframe-banner">
                <span>
                  Certains sites (ex. GitHub, Google) refusent l'affichage en iframe natif.
                </span>
                <div className="browser-iframe-banner-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={toggleMode}
                  >
                    Activer le Proxy Omni
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={openExternal}
                  >
                    Ouvrir en externe <ExternalLink className="ml-1 w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowIframeNotice(false)}
                    title="Masquer cet avertissement"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function BrowserNewTabPage({
  onNavigate,
  history,
  onClearHistory,
}: {
  onNavigate: (url: string) => void;
  history: BrowserHistoryEntry[];
  onClearHistory: () => void;
}) {
  const [query, setQuery] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    onNavigate(query);
  };

  return (
    <div className="browser-new-tab">
      <div className="browser-hero">
        <div className="browser-hero-icon">
          <Globe />
        </div>
        <h1>Navigateur Interne Omni</h1>
        <p>
          Prévisualisez vos serveurs de développement, explorez la documentation technique et naviguez sans quitter votre environnement agentique.
        </p>

        <form onSubmit={handleSubmit} className="browser-hero-search">
          <Search className="browser-hero-search-icon" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher sur le web ou entrer une URL (ex: 5173, localhost:3000, github.com)…"
            className="browser-hero-input"
            autoFocus
          />
          <Button type="submit" size="sm" className="browser-hero-btn">
            Naviguer
          </Button>
        </form>
      </div>

      {/* Dev Servers Section */}
      <div className="browser-section">
        <div className="browser-section-header">
          <h2>
            <Server /> Serveurs Locaux
          </h2>
          <small>Développement et aperçus temps réel</small>
        </div>
        <div className="browser-card-grid">
          {LOCAL_PRESETS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.url}
                className="browser-tile"
                onClick={() => onNavigate(item.url)}
              >
                <div className="browser-tile-icon">
                  <Icon />
                </div>
                <div className="browser-tile-info">
                  <strong>{item.name}</strong>
                  <span className="browser-tile-url">{item.url}</span>
                  <small>{item.description}</small>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Documentation Section */}
      <div className="browser-section">
        <div className="browser-section-header">
          <h2>
            <BookOpen /> Documentation & Outils
          </h2>
          <small>Ressources et références utiles pour vos tâches</small>
        </div>
        <div className="browser-card-grid">
          {DOC_PRESETS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.url}
                className="browser-tile"
                onClick={() => onNavigate(item.url)}
              >
                <div className="browser-tile-icon">
                  <Icon />
                </div>
                <div className="browser-tile-info">
                  <strong>{item.name}</strong>
                  <span className="browser-tile-url">{item.url}</span>
                  <small>{item.description}</small>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* History Section */}
      {history.length > 0 && (
        <div className="browser-section">
          <div className="browser-section-header">
            <h2>
              <Clock /> Historique Récent
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearHistory}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Effacer l'historique
            </Button>
          </div>
          <div className="browser-history-list">
            {history.slice(0, 10).map((entry, index) => (
              <button
                key={`${entry.url}-${index}`}
                className="browser-history-row"
                onClick={() => onNavigate(entry.url)}
              >
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="browser-history-title">
                  {entry.title || entry.url}
                </span>
                <span className="browser-history-url">{entry.url}</span>
                <small className="browser-history-time">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

