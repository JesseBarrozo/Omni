import { useEffect, useState } from "react";
import { Archive, Bell, ChevronDown, ChevronRight, FolderGit2, FolderPlus, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { api, type Project, type Run, type Approval } from "@/lib/api";

type Worktree = { path: string; branch: string; mainWorktree: boolean; locked: boolean; prunable: boolean; projectId: string | null };
type ProjectSummary = { available: boolean; branch: string | null; mainWorktree?: boolean; worktrees?: Worktree[] };

export function ProjectsNav({ projects, active, activeBranch, runs, approvals, onSelect, onEdit, onArchive, onOpenWorkspace, onCreateWorkspace, onRemoveWorkspace, onAddProject, onOpenAgent }: {
  projects: Project[];
  active: string;
  activeBranch?: string | null;
  runs: Run[];
  approvals: Approval[];
  onSelect: (id: string) => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onOpenWorkspace: (project: Project, path: string) => void;
  onCreateWorkspace: (project: Project) => void;
  onRemoveWorkspace: (project: Project, worktree: Worktree) => void;
  onAddProject: () => void;
  onOpenAgent: (run: Run) => void;
}) {
  const [summaries, setSummaries] = useState<Record<string, ProjectSummary>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("omni.projects.collapsed") || "{}"); }
    catch { return {}; }
  });
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    try { localStorage.setItem("omni.projects.collapsed", JSON.stringify(collapsed)); }
    catch { /* La navigation reste disponible si le stockage est désactivé. */ }
  }, [collapsed]);
  useEffect(() => {
    const controller = new AbortController();
    for (const project of projects) {
      void api<ProjectSummary>(`/projects/${project.id}/summary`, undefined, controller.signal)
        .then((info) => setSummaries((previous) => ({ ...previous, [project.id]: info })))
        .catch(() => {
          if (!controller.signal.aborted)
            setSummaries((previous) => ({ ...previous, [project.id]: { available: false, branch: null } }));
        });
    }
    return () => controller.abort();
  }, [projects, activeBranch]);

  const childIds = new Set(projects.flatMap((project) => {
    const summary = summaries[project.id];
    return summary?.mainWorktree ? (summary.worktrees ?? []).filter((w) => !w.mainWorktree && w.projectId).map((w) => w.projectId!) : [];
  }));
  const visibleProjects = projects.filter((project) => {
    if (childIds.has(project.id)) return false;
    const summary = summaries[project.id];
    const relatedIds = [project.id, ...(summary?.worktrees ?? []).map((item) => item.projectId).filter(Boolean)];
    if (filter === "active" && !runs.some((run) => run.projectId && relatedIds.includes(run.projectId))) return false;
    if (filter === "available" && !summary?.available) return false;
    const text = `${project.name} ${project.rootPath} ${(summary?.worktrees ?? []).map((item) => item.branch).join(" ")}`;
    return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  const activeProject = projects.find((project) => project.id === active);

  return (
    <section className="workspace-projects" aria-label="Espace de travail">
    <div className="projects-toolbar">
      <span>Projets</span>
      <div className="projects-toolbar-actions">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild><button type="button" className="projects-toolbar-button project-notifications" aria-label={`Autorisations en attente : ${approvals.length}`} title="Autorisations en attente"><Bell />{approvals.length > 0 && <b>{approvals.length}</b>}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="project-action-menu" sideOffset={6} align="end">
            <DropdownMenu.Label className="projects-menu-heading">Autorisations en attente</DropdownMenu.Label>
            {approvals.length === 0 && <div className="projects-menu-empty">Aucune autorisation en attente</div>}
            {approvals.map((approval) => {
              const run = runs.find((item) => item.id === approval.runId);
              return <DropdownMenu.Item key={approval.id} className="project-action-menu-item" disabled={!run} onSelect={() => run && onOpenAgent(run)}>{String(approval.request.toolName ?? approval.request.method ?? "Action d’agent")}</DropdownMenu.Item>;
            })}
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="projects-toolbar-button" aria-label="Rechercher un projet" title="Rechercher un projet" aria-pressed={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setQuery(""); }}><Search /></button>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild><button type="button" className="projects-toolbar-button" aria-label="Filtrer les projets" title="Filtrer les projets"><SlidersHorizontal /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="project-action-menu" sideOffset={6} align="end">
            <DropdownMenu.Label className="projects-menu-heading">Afficher les projets</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={filter} onValueChange={setFilter}>
              {[{ value: "all", label: "Tous" }, { value: "active", label: "Avec agents actifs" }, { value: "available", label: "Dossiers Git disponibles" }].map((item) => <DropdownMenu.RadioItem key={item.value} value={item.value} className="project-action-menu-item"><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>{item.label}</DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="projects-toolbar-button" aria-label="Ouvrir un projet" title="Ouvrir un projet" onClick={onAddProject}><FolderPlus /></button>
        <button type="button" className="projects-toolbar-button" aria-label="Créer un espace de travail" title="Créer un espace dans le projet sélectionné" disabled={!activeProject || !summaries[active]?.available} onClick={() => activeProject && onCreateWorkspace(activeProject)}><Plus /></button>
      </div>
    </div>
    {searchOpen && <div className="projects-search"><Search /><input autoFocus aria-label="Rechercher dans les projets" placeholder="Rechercher un projet ou une branche…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>}
    <nav className="project-tree" aria-label="Projets">
      {visibleProjects.map((project) => {
        const summary = summaries[project.id];
        const isCollapsed = Boolean(collapsed[project.id]);
        const worktrees = summary?.available && summary.worktrees?.length
          ? summary.worktrees
          : [{ path: project.rootPath, branch: summary ? "Dossier indisponible ou sans Git" : "Chargement…", mainWorktree: false, locked: false, prunable: false, projectId: project.id }];
        return (
          <section key={project.id} className="project-tree-item">
            <div className="project-header">
              <button type="button" className="project-header-title" aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Afficher" : "Réduire"} les espaces de ${project.name}`}
                onClick={() => setCollapsed((previous) => ({ ...previous, [project.id]: !previous[project.id] }))}>
                <FolderGit2 aria-hidden="true" /><span title={project.name}>{project.name}</span>
              </button>
              <div className="project-header-actions">
                <button type="button" className="project-header-action" aria-label={`${isCollapsed ? "Afficher" : "Réduire"} ${project.name}`} aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((previous) => ({ ...previous, [project.id]: !previous[project.id] }))}>
                  <ChevronDown className={isCollapsed ? "is-collapsed" : undefined} />
                </button>
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild><button type="button" className="project-header-action" aria-label={`Actions pour ${project.name}`}><MoreHorizontal /></button></DropdownMenu.Trigger>
                  <DropdownMenu.Portal><DropdownMenu.Content className="project-action-menu" align="end" sideOffset={5}>
                    <DropdownMenu.Item className="project-action-menu-item" onSelect={() => onEdit(project)}><Pencil /> Modifier le projet</DropdownMenu.Item>
                    <DropdownMenu.Item className="project-action-menu-item" onSelect={() => onArchive(project)}><Archive /> Supprimer de l’espace de travail</DropdownMenu.Item>
                  </DropdownMenu.Content></DropdownMenu.Portal>
                </DropdownMenu.Root>
                {summary?.available && <button type="button" className="project-header-action" aria-label={`Créer un espace pour ${project.name}`} title="Créer un espace de travail" onClick={() => onCreateWorkspace(project)}><Plus /></button>}
              </div>
            </div>
            {!isCollapsed && worktrees.map((worktree) => {
              const agents = runs.filter((run) => run.projectId && run.projectId === worktree.projectId);
              const waiting = agents.filter((run) => approvals.some((approval) => approval.runId === run.id)).length;
              return (
              <div className={`project-workspace-row${active === worktree.projectId ? " selected" : ""}`} key={worktree.path}>
                <button type="button" className="project-workspace" title={worktree.path}
                  onClick={() => worktree.projectId ? onSelect(worktree.projectId) : onOpenWorkspace(project, worktree.path)}
                  aria-current={active === worktree.projectId ? "page" : undefined}>
                  <span className="project-workspace-line">
                    <i className={summary?.available && !worktree.prunable ? "available" : ""} />
                    <span className="project-workspace-branch">{worktree.branch}</span>
                    {worktree.mainWorktree && <span className="project-workspace-primary">principal</span>}
                  </span>
                  <span className="project-workspace-detail">{summary?.available ? (worktree.mainWorktree ? worktree.branch : worktree.path.split("/").filter(Boolean).at(-1)) : worktree.path}</span>
                </button>
                {!summary?.available ? (
                  <button
                    type="button"
                    className="project-workspace-remove"
                    aria-label={`Supprimer le projet ${project.name}`}
                    title="Supprimer ce projet de l’espace de travail"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(project);
                    }}
                  >
                    <Trash2 />
                  </button>
                ) : (
                  !worktree.mainWorktree && !worktree.locked && worktree.path !== project.rootPath && (
                    <button
                      type="button"
                      className="project-workspace-remove"
                      aria-label={`Supprimer l’espace ${worktree.branch}`}
                      title="Supprimer cet espace de travail"
                      onClick={() => onRemoveWorkspace(project, worktree)}
                    >
                      <Trash2 />
                    </button>
                  )
                )}
                {agents.length > 0 && <div className="project-agents">
                  <button type="button" className="project-agents-summary" aria-expanded={Boolean(expandedAgents[worktree.path])} onClick={() => setExpandedAgents((previous) => ({ ...previous, [worktree.path]: !previous[worktree.path] }))}>
                    <span className={waiting ? "project-agent-status waiting" : "project-agent-status"} />
                    <span>{waiting ? `${waiting} en attente` : `${agents.length} agent${agents.length > 1 ? "s" : ""} actif${agents.length > 1 ? "s" : ""}`}</span>
                    <ChevronRight className={expandedAgents[worktree.path] ? "expanded" : ""} />
                  </button>
                  {expandedAgents[worktree.path] && agents.map((run) => <button key={run.id} type="button" className="project-agent-item" onClick={() => onOpenAgent(run)}><span className={approvals.some((approval) => approval.runId === run.id) ? "project-agent-status waiting" : "project-agent-status"} />{run.harnessId} <small>{approvals.some((approval) => approval.runId === run.id) ? "Autorisation demandée" : "En cours"}</small></button>)}
                </div>}
              </div>
            ); })}
          </section>
        );
      })}
      {!visibleProjects.length && <p className="project-tree-empty">{projects.length ? "Aucun projet ne correspond aux filtres." : "Aucun projet. Ouvrez un dossier pour commencer."}</p>}
    </nav>
    </section>
  );
}
