import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, ListTodo, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type Project } from "@/lib/api";

type Task = {
  number: number;
  title: string;
  url: string | null;
  updatedAt: string;
  author?: { login: string };
  headRefName?: string;
  reviewDecision?: string;
  reviewRequests?: { login?: string; name?: string }[];
  statusCheckRollup?: {
    status?: string;
    conclusion?: string;
    state?: string;
  }[];
  mergeStateStatus?: string;
  project: Project;
};
type Failure = { project: string; message: string };
export function TasksPanel({
  projects,
  activeProject,
  onWork,
}: {
  projects: Project[];
  activeProject: string;
  onWork: (project: Project, task: Task) => void;
}) {
  const [kind, setKind] = useState<"issues" | "prs">("issues");
  const [filter, setFilter] = useState<"open" | "mine" | "review">("open");
  const [scope, setScope] = useState(activeProject || "all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Task[]>([]);
  const [errors, setErrors] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setErrors([]);
      const targets =
        scope === "all"
          ? projects
          : projects.filter((project) => project.id === scope);
      const results = await Promise.all(
        targets.map(async (project) => {
          try {
            const data = await api<{ rows: Omit<Task, "project">[] }>(
              `/projects/${encodeURIComponent(project.id)}/github-tasks?kind=${kind}&filter=${filter}`,
              undefined,
              signal,
            );
            return { rows: data.rows.map((row) => ({ ...row, project })) };
          } catch (error) {
            return {
              error: {
                project: project.name,
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }),
      );
      if (signal.aborted) return;
      setRows(results.flatMap((item) => item.rows ?? []));
      setErrors(results.flatMap((item) => (item.error ? [item.error] : [])));
      setLoading(false);
    },
    [projects, scope, kind, filter],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);
  const visible = rows
    .filter((row) =>
      `${row.number} ${row.title} ${row.project.name} ${row.author?.login ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <section className="tasks-page">
      <header className="tasks-heading">
        <div>
          <span className="tasks-kicker">ESPACE DE TRAVAIL</span>
          <h1>
            <ListTodo /> Tâches
          </h1>
          <p>Tickets et pull requests de vos projets GitHub.</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Actualiser les tâches"
          onClick={() => setRefresh((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw />
        </Button>
      </header>
      <div className="tasks-controls">
        <div className="tasks-tabs">
          <Button
            size="sm"
            variant={kind === "issues" ? "secondary" : "ghost"}
            onClick={() => {
              setKind("issues");
              setFilter("open");
            }}
          >
            Tickets
          </Button>
          <Button
            size="sm"
            variant={kind === "prs" ? "secondary" : "ghost"}
            onClick={() => {
              setKind("prs");
              setFilter("open");
            }}
          >
            Pull requests
          </Button>
        </div>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label="Projet des tâches">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Tous les projets</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="tasks-board">
        <div className="tasks-filters">
          <Button
            size="sm"
            variant={filter === "open" ? "secondary" : "ghost"}
            onClick={() => setFilter("open")}
          >
            Ouvert
          </Button>
          <Button
            size="sm"
            variant={filter === "mine" ? "secondary" : "ghost"}
            onClick={() => setFilter("mine")}
          >
            À moi
          </Button>
          {kind === "prs" && (
            <Button
              size="sm"
              variant={filter === "review" ? "secondary" : "ghost"}
              onClick={() => setFilter("review")}
            >
              En attente de relecture
            </Button>
          )}
        </div>
        <div className="tasks-search">
          <Search />
          <Input
            aria-label="Rechercher dans les tâches"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par titre, numéro, projet ou auteur…"
          />
        </div>
        {errors.length > 0 && (
          <div role="alert" className="tasks-errors">
            {errors.map((error) => (
              <div key={error.project}>
                {error.project} : {error.message}
              </div>
            ))}
          </div>
        )}
        <div className="tasks-table-wrap">
          <table className="tasks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>TITRE / CONTEXTE</th>
                {kind === "prs" && (
                  <>
                    <th>RELECTURE</th>
                    <th>VÉRIFICATIONS</th>
                    <th>MERGE</th>
                  </>
                )}
                <th>MIS À JOUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const checks = row.statusCheckRollup ?? [];
                const failed = checks.filter((c) =>
                  ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(
                    c.conclusion ?? c.state ?? "",
                  ),
                ).length;
                const pending = checks.filter(
                  (c) =>
                    (c.status && c.status !== "COMPLETED") ||
                    c.state === "PENDING",
                ).length;
                return (
                  <tr key={`${row.project.id}-${row.number}`}>
                    <td>#{row.number}</td>
                    <td>
                      <strong>{row.title}</strong>
                      <small>
                        {row.project.name} · {row.author?.login ?? "GitHub"}
                        {row.headRefName ? ` · ${row.headRefName}` : ""}
                      </small>
                    </td>
                    {kind === "prs" && (
                      <>
                        <td>{row.reviewDecision || "—"}</td>
                        <td>
                          {!checks.length
                            ? "—"
                            : failed
                              ? `${failed} échec(s)`
                              : pending
                                ? `${pending} en cours`
                                : `${checks.length} réussie(s)`}
                        </td>
                        <td>{row.mergeStateStatus || "—"}</td>
                      </>
                    )}
                    <td>
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      <div className="task-actions">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onWork(row.project, row)}
                        >
                          Confier à Omni
                        </Button>
                        {row.url && (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Ouvrir #${row.number} sur GitHub`}
                          >
                            <ExternalLink />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="tasks-empty">
            <strong>
              {loading
                ? "Chargement des tâches…"
                : errors.length === 0
                  ? "Aucun travail GitHub correspondant"
                  : "Aucun résultat disponible"}
            </strong>
            <span>
              {loading
                ? "Connexion aux projets sélectionnés."
                : "Modifiez les filtres ou actualisez la liste."}
            </span>
          </div>
        )}
        <p className="tasks-footnote">
          Jusqu’à 50 éléments ouverts par projet · recherche dans les résultats
          chargés.
        </p>
      </div>
    </section>
  );
}
