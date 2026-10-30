import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileBox,
  FileText,
  LayoutDashboard,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/components/markdown";
import { api, type Conversation, type Project, type Run } from "@/lib/api";

export function AgentDashboard({
  conversations,
  runs,
  onOpen,
}: {
  conversations: Conversation[];
  runs: Run[];
  onOpen: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const activeIds = new Set(runs.map((run) => run.conversationId));
  const filtered = conversations.filter((conversation) =>
    `${conversation.title} ${conversation.modelId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [
    {
      id: "active",
      title: "EN ACTIVITÉ",
      icon: Activity,
      items: filtered.filter(
        (item) => activeIds.has(item.id) || item.status === "running",
      ),
    },
    {
      id: "attention",
      title: "À EXAMINER",
      icon: Clock3,
      items: filtered.filter(
        (item) =>
          !activeIds.has(item.id) &&
          ["failed", "error", "interrupted"].includes(item.status),
      ),
    },
    {
      id: "done",
      title: "TERMINÉ",
      icon: CheckCircle2,
      items: filtered.filter(
        (item) =>
          !activeIds.has(item.id) &&
          !["failed", "error", "interrupted", "running"].includes(item.status),
      ),
    },
  ];
  return (
    <section className="orca-page agents-page">
      <header className="orca-page-header">
        <div>
          <span className="orca-kicker">HARNESS OMNI</span>
          <h1>
            <LayoutDashboard /> Tableau de bord des agents{" "}
            <small>{conversations.length} au total</small>
          </h1>
        </div>
        <p>Suivez les conversations et les exécutions de vos agents.</p>
      </header>
      <div className="orca-toolbar">
        <Search />
        <Input
          aria-label="Rechercher les agents"
          placeholder="Rechercher une conversation ou un modèle…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="agent-board">
        {groups.map(({ id, title, icon: Icon, items }) => (
          <section className="agent-column" key={id}>
            <header>
              <span>
                <Icon /> {title}
              </span>
              <b>{items.length}</b>
            </header>
            {!items.length ? (
              <p className="orca-empty">Aucun</p>
            ) : (
              items.map((item) => (
                <button
                  className="agent-card"
                  key={item.id}
                  onClick={() => onOpen(item.id)}
                >
                  <strong>{item.title || "Nouvelle conversation"}</strong>
                  <span>
                    {item.modelId} · {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  <ArrowUpRight />
                </button>
              ))
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

type Skill = {
  id: string;
  name: string;
  source: string;
  description: string;
  content: string;
};
export function SkillsPage({ projectId }: { projectId: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("Tous");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<{ skills: Skill[] }>(
      `/skills?projectId=${encodeURIComponent(projectId)}`,
      undefined,
      controller.signal,
    )
      .then((result) => setSkills(result.skills))
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refreshToken]);
  const sources = ["Tous", ...new Set(skills.map((skill) => skill.source))];
  const visible = skills.filter(
    (skill) =>
      (source === "Tous" || source === skill.source) &&
      `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="orca-page skills-page">
      <header className="orca-page-header">
        <div>
          <span className="orca-kicker">CAPACITÉS DES AGENTS</span>
          <h1>
            <BookOpen /> Skills{" "}
            <small>
              {skills.length} skills · {sources.length - 1} sources
            </small>
          </h1>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Actualiser les skills"
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw />
        </Button>
      </header>
      <div className="orca-toolbar">
        <Search />
        <Input
          aria-label="Rechercher des skills"
          placeholder="Rechercher des skills"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="skill-filters"
        role="tablist"
        aria-label="Sources des skills"
      >
        {sources.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={source === item}
            className={source === item ? "selected" : ""}
            onClick={() => setSource(item)}
          >
            {item}
            {item === "Tous" ? ` ${skills.length}` : ""}
          </button>
        ))}
      </div>
      {error && (
        <p className="orca-error" role="alert">
          {error}
        </p>
      )}
      <div className="skill-list">
        {visible.map((skill) => (
          <button
            className="skill-row"
            key={skill.id}
            onClick={() =>
              setSelected(selected?.id === skill.id ? null : skill)
            }
          >
            <span className="skill-main">
              <strong>
                <BookOpen /> {skill.name}
              </strong>
              <small>{skill.description}</small>
              {selected?.id === skill.id && (
                <div
                  className="skill-content"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MarkdownContent text={skill.content} />
                </div>
              )}
            </span>
            <span className="skill-meta">{skill.source} · Agent Skill</span>
          </button>
        ))}
        {!visible.length && (
          <p className="orca-empty-page">
            {loading
              ? "Chargement des skills…"
              : skills.length
                ? "Aucun skill ne correspond à la recherche."
                : "Aucun skill installé dans les emplacements pris en charge."}
          </p>
        )}
      </div>
    </section>
  );
}

type Artifact = { path: string; name: string; size: number; updatedAt: string };
export function ArtifactsPage({
  project,
  onOpen,
}: {
  project: Project | undefined;
  onOpen: (path: string) => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (!project) {
      setArtifacts([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<{ artifacts: Artifact[] }>(
      `/artifacts?projectId=${encodeURIComponent(project.id)}`,
      undefined,
      controller.signal,
    )
      .then((result) => setArtifacts(result.artifacts))
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project, refreshToken]);
  const visible = useMemo(
    () =>
      artifacts.filter((item) =>
        `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [artifacts, query],
  );
  return (
    <section className="orca-page artifacts-page">
      <header className="orca-page-header">
        <div>
          <span className="orca-kicker">ESPACE DE TRAVAIL</span>
          <h1>
            <FileBox /> Artéfacts <small>{artifacts.length} fichiers</small>
          </h1>
          <p>
            Livrables trouvés dans artifacts/, outputs/ et .context/artifacts/.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Actualiser les artéfacts"
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw />
        </Button>
      </header>
      <div className="orca-toolbar">
        <Search />
        <Input
          aria-label="Rechercher des artéfacts"
          placeholder="Rechercher des artéfacts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <p className="orca-error" role="alert">
          {error}
        </p>
      )}
      <div className="artifact-list">
        {visible.map((item) => (
          <button
            className="artifact-row"
            key={item.path}
            onClick={() => onOpen(item.path)}
          >
            <FileText />
            <span>
              <strong>{item.name}</strong>
              <small>{item.path}</small>
            </span>
            <small>
              {(item.size / 1024).toFixed(1)} Ko ·{" "}
              {new Date(item.updatedAt).toLocaleDateString()}
            </small>
            <ArrowUpRight />
          </button>
        ))}
        {!visible.length && (
          <p className="orca-empty-page">
            {loading
              ? "Recherche des artéfacts…"
              : artifacts.length
                ? "Aucun fichier correspondant."
                : "Aucun artéfact trouvé pour ce projet."}
          </p>
        )}
      </div>
    </section>
  );
}
