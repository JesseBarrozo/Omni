import { useState } from "react";
import { Settings2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type WorkspaceState } from "@/lib/api";
import { AccountProfiles } from "@/components/account-profiles";
const sections = [
  "Général",
  "Comptes",
  "Agents",
  "MCP",
  "Connecteurs",
  "Plugins",
] as const;
type Section = (typeof sections)[number];
export function SettingsPanel({
  state,
  refresh,
  addMcp,
  currentHarness,
  setDefaultHarness,
}: {
  state: WorkspaceState;
  refresh: () => Promise<unknown>;
  addMcp: () => void;
  currentHarness: string;
  setDefaultHarness: (id: string) => void;
}) {
  const [section, setSection] = useState<Section>("Général");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-page">
      <nav className="settings-nav" aria-label="Catégories des paramètres">
        <span>CONFIGURATION</span>
        {sections.map((name) => (
          <Button
            key={name}
            variant={name === section ? "secondary" : "ghost"}
            onClick={() => setSection(name)}
          >
            {name}
          </Button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-title">
          <Settings2 />
          <div>
            <h1>{section}</h1>
            <p>Configuration locale de votre espace Omni.</p>
          </div>
        </div>
        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}
        {section === "Général" && (
          <>
            <div className="settings-card">
              <h2>Agent par défaut</h2>
              <p>Utilisé pour les nouvelles sessions dans ce navigateur.</p>
              <Select value={currentHarness} onValueChange={setDefaultHarness}>
                <SelectTrigger aria-label="Agent par défaut">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {state.harnesses.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p>Les permissions des outils restent demandées par le harness.</p>
            </div>
            <div className="settings-card awake-settings-card">
              <h2>Empêcher la mise en veille</h2>
              <p>
                Maintient l’ordinateur éveillé en permanence ou pendant les
                exécutions d’agents. Le mode Agent ne s’active que lorsqu’une
                exécution Omni est en cours.
              </p>
              <Select
                value={state.awake?.mode ?? "off"}
                onValueChange={(mode) => void change("/settings/awake", { mode })}
                disabled={busy || !state.awake?.supported}
              >
                <SelectTrigger aria-label="Mode de prévention de la veille">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="on">Toujours activé</SelectItem>
                    <SelectItem value="auto">Pendant le travail des agents</SelectItem>
                    <SelectItem value="off">Désactivé</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className="awake-status" role="status">
                <span className={state.awake?.active ? "awake-dot active" : "awake-dot"} />
                {state.awake?.active
                  ? "Prévention de la veille active"
                  : state.awake?.mode === "auto"
                    ? `En attente${state.awake.workingAgents ? ` · ${state.awake.workingAgents} agent(s)` : " d’une exécution"}`
                    : "Prévention de la veille inactive"}
              </div>
              {!state.awake?.supported && (
                <p className="awake-note">La prévention automatique est disponible sur macOS et Linux.</p>
              )}
              {state.awake?.error && <p className="awake-note">{state.awake.error}</p>}
            </div>
          </>
        )}
        {section === "Comptes" && (
          <>
            <div className="settings-card">
              <h2>Fournisseurs et comptes</h2>
              <p>
                État connu du registre Omni. Les connexions OAuth se gèrent dans
                le terminal.
              </p>
              {state.providers.length ? (
                state.providers.map((p) => (
                  <div className="settings-row" key={p.id}>
                    <div>
                      <strong>{p.id}</strong>
                      <small>
                        {p.authStatus} · <code>omni auth status</code>
                      </small>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void change("/settings/registry", {
                          type: "provider",
                          id: p.id,
                          enabled: p.enabled === false,
                        })
                      }
                    >
                      {p.enabled === false ? "Activer" : "Désactiver"}
                    </Button>
                  </div>
                ))
              ) : (
                <p>
                  Aucun fournisseur enregistré. Lancez{" "}
                  <code>omni providers refresh</code>.
                </p>
              )}
              <p>
                Connexion : <code>omni auth login codex</code>,{" "}
                <code>omni auth login claude</code> ou{" "}
                <code>omni auth key set openai --stdin</code>.
              </p>
            </div>
            <AccountProfiles />
          </>
        )}
        {section === "Agents" && (
          <div className="settings-card">
            <h2>Harnesses</h2>
            <p>
              Activez ou désactivez les harnesses enregistrés. Actualisez le
              registre avec <code>omni harnesses refresh</code> si nécessaire.
            </p>
            {state.harnesses.map((h) => (
              <div className="settings-row" key={h.id}>
                <div>
                  <strong>{h.name}</strong>
                  <small>{h.description}</small>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || h.enabled === undefined}
                  onClick={() =>
                    void change("/settings/registry", {
                      type: "harness",
                      id: h.id,
                      enabled: !h.enabled,
                    })
                  }
                >
                  {h.enabled === undefined
                    ? "Non enregistré"
                    : h.enabled
                      ? "Désactiver"
                      : "Activer"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {section === "MCP" && (
          <div className="settings-card">
            <div className="settings-card-header">
              <div>
                <h2>Serveurs MCP</h2>
                <p>Les outils restent soumis aux permissions du harness.</p>
              </div>
              <Button size="sm" onClick={addMcp}>
                <Plus data-icon="inline-start" />
                Ajouter
              </Button>
            </div>
            {state.mcpServers.map((m) => (
              <div className="settings-row" key={m.name}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.transport} · {m.toolCount} outils
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  title={`Supprimer ${m.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Supprimer le serveur MCP ${m.name} ?`))
                      void change("/settings/mcp/remove", { name: m.name });
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
        {section === "Connecteurs" && (
          <div className="settings-card">
            <h2>GitHub</h2>
            <p>
              Omni utilise GitHub CLI et le remote Git du projet. Le panneau
              Tâches et les pull requests utilisent ce compte.
            </p>
            <p>
              <code>gh auth status</code> · <code>gh auth login</code>
            </p>
            <h2>Autres connexions</h2>
            <p>
              Configurez les serveurs MCP dans la section MCP. Les intégrations
              natives supplémentaires ne sont pas encore disponibles.
            </p>
          </div>
        )}
        {section === "Plugins" && (
          <div className="settings-card">
            <h2>Plugins</h2>
            <p>
              Omni ne dispose pas encore de registre ou de gestionnaire de
              plugins. Les serveurs MCP peuvent être ajoutés dans la section
              MCP.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
