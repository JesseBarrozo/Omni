import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import {
  Plus,
  Search,
  PanelRightClose,
  PanelRightOpen,
  FolderOpen,
  MessageSquare,
  Settings2,
  ArrowUp,
  Square,
  ChevronRight,
  GitBranch,
  FileCode2,
  Terminal,
  Check,
  ShieldCheck,
  ShieldAlert,
  Hand,
  FilePenLine,
  Plug,
  RefreshCw,
  Copy,
  LoaderCircle,
  ArrowUpRight,
  Layers,
  Workflow,
  X,
  Eye,
  Code2,
  CheckCheck,
  Save,
  ListTodo,
  LayoutDashboard,
  BookOpen,
  FileBox,
  Mic,
  MicOff,
  Paperclip,
  Archive,
  ArchiveRestore,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Minus,
  Sparkles,
  CloudDownload,
  CloudUpload,
  ArrowDownToLine,
  Globe,
  FilePlus,
  Smartphone,
} from "lucide-react";
import {
  BrowserPane,
  type OpenBrowserTab,
  type BrowserHistoryEntry,
  formatBrowserTabTitle,
} from "@/components/browser-pane";
import { TerminalPane } from "@/components/terminal-pane";
import { TabCreateDropdown } from "@/components/tab-create-dropdown";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "@/components/ui/code-block";
import { MarkdownContent } from "@/components/markdown";
import { ToolTrace } from "@/components/tool-trace";
import { TasksPanel } from "@/components/tasks-panel";
import {
  AgentDashboard,
  ArtifactsPage,
  SkillsPage,
} from "@/components/orca-pages";
import { ProjectsNav } from "@/components/projects-nav";
import { SettingsPanel } from "@/components/settings-panel";
import { AwakeStatusSegment } from "@/components/awake-status-segment";
import { GitHistory, type GitCommit } from "@/components/git-history";
import { FileIcon } from "@/components/file-icon";
import { FileTree } from "@/components/file-tree";
import { AtlasViewer } from "@/components/atlas-viewer";
import { useTranslation } from "@/i18n";
import { UsageFooter } from "@/components/usage-footer";
import {
  PermissionModePicker,
  type PermissionMode,
} from "@/components/permission-mode-picker";
import {
  api,
  type Project,
  type Conversation,
  type WorkspaceState,
  type OmniEvent,
  type Approval,
  type Run,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Context = { root: string; files: { path: string; characters: number }[] };
type AtlasStatus = {
  present: boolean;
  path: string;
  digest?: string;
  stack?: string[];
  pages?: { name: string; title: string }[];
  sourceFiles?: number;
  entryPoints?: number;
  scripts?: number;
  documents?: number;
  externalHosts?: number;
  capabilities?: number;
  tables?: number;
};
type FileEntry = { name: string; path: string; directory: boolean };
type OpenFileTab = {
  id: string;
  path: string;
  content: string;
  original?: string;
  revision?: string;
  readOnly?: boolean;
  projectId?: string;
  mode: "preview" | "edit";
  line?: number;
};
type OpenTerminalTab = {
  id: string;
  title: string;
  cwd?: string;
};
export type OpenChatTab = {
  id: string;
  conversationId: string | null;
  title: string;
  draft?: string;
  harness?: string;
  model?: string;
};
type Git = {
  available: boolean;
  branch: string;
  status: string;
  diff: string;
  branches?: string[];
  history?: GitCommit[];
  changes?: { code: string; path: string; oldPath?: string }[];
  github?: { connected: boolean; url: string | null };
};
type PendingAttachment = { id: string; name: string; text: string };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
const FileEditor = lazy(() => import("@/components/file-editor"));
const shortPath = (path: string) =>
  path.split("/").filter(Boolean).slice(-2).join("/");
const defaultModel = (harness: string) =>
  harness === "auto"
    ? "auto-orchestrator"
    : harness === "claude-code"
      ? "claude"
      : harness;

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [projectId, setProjectId] = useState("");
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<Conversation[]>([]);
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [renamingSession, setRenamingSession] = useState<Conversation | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [events, setEvents] = useState<OmniEvent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [harness, setHarness] = useState(
    () => localStorage.getItem("omni.defaultHarness") || "auto",
  );
  const [model, setModel] = useState("auto-orchestrator");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () =>
      (localStorage.getItem("omni.permissionDefault") as PermissionMode) ||
      "ask",
  );
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [atlas, setAtlas] = useState<AtlasStatus | null>(null);
  const [atlasBusy, setAtlasBusy] = useState(false);
  const [atlasError, setAtlasError] = useState("");
  const [git, setGit] = useState<Git | null>(null);
  const [panel, setPanel] = useState(true);
  const [connected, setConnected] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState<
    "chat" | "tasks" | "agents" | "skills" | "artifacts" | "settings"
  >("chat");
  const [openProject, setOpenProject] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [projectError, setProjectError] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [workspaceProject, setWorkspaceProject] = useState<Project | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceBranch, setWorkspaceBranch] = useState("");
  const [contextVersion, setContextVersion] = useState(0);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [openBrowserTabs, setOpenBrowserTabs] = useState<OpenBrowserTab[]>([]);
  const [openTerminalTabs, setOpenTerminalTabs] = useState<OpenTerminalTab[]>(
    [],
  );
  const [openChatTabs, setOpenChatTabs] = useState<OpenChatTab[]>([
    { id: "chat", conversationId: null, title: "Chat", draft: "" },
  ]);
  const [newTabDropdownOpen, setNewTabDropdownOpen] = useState(false);
  const [browserHistory, setBrowserHistory] = useState<BrowserHistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem("omni_browser_history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [activeTabId, setActiveTabId] = useState("chat");
  const [savingFile, setSavingFile] = useState(false);
  const [fileError, setFileError] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const commitMessageRef = useRef("");
  const [gitBusy, setGitBusy] = useState(false);
  const [gitError, setGitError] = useState("");
  const [generatingCommit, setGeneratingCommit] = useState(false);
  const [suggestedCommit, setSuggestedCommit] = useState("");
  const [pullRequests, setPullRequests] = useState<
    | { number: number; title: string; url: string | null; branch: string }[]
    | null
  >(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("[]");
  const [copyDone, setCopyDone] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dictating, setDictating] = useState(false);
  const selected = useRef<string | null>(null);
  const projectRef = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const project = state?.projects.find((p) => p.id === projectId);
  const viewFile = openFileTabs.find((file) => file.id === activeTabId) ?? null;
  const activeBrowserTab =
    openBrowserTabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeTerminalTab =
    openTerminalTabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeChatTab =
    openChatTabs.find((tab) => tab.id === activeTabId) ?? null;
  const isChatActive =
    activeChatTab !== null ||
    (!viewFile && !activeBrowserTab && !activeTerminalTab);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const conversationRef = useRef(conversation);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const openChatTabsRef = useRef(openChatTabs);
  useEffect(() => {
    openChatTabsRef.current = openChatTabs;
  }, [openChatTabs]);

  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => { commitMessageRef.current = commitMessage; }, [commitMessage]);
  useEffect(() => setPullRequests(null), [projectId]);
  const busy =
    sending || runs.some((r) => r.conversationId === conversation?.id);
  const pending = approvals.filter(
    (a) => a.conversationId === conversation?.id,
  );
  const messages = conversation?.messages ?? [];
  const stagedChanges = git?.changes?.filter((change) => change.code !== "??" && change.code[0] !== " ") ?? [];
  const unstagedChanges = git?.changes?.filter((change) => change.code === "??" || change.code[1] !== " ") ?? [];
  const gitConflicts = git?.changes?.some((change) => ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(change.code)) ?? false;
  const providersModel =
    state?.models.filter((m) =>
      harness === "auto"
        ? ["codex", "openai", "claude", "opencode"].includes(m.providerId)
        : harness === "codex"
          ? ["codex", "openai"].includes(m.providerId)
          : harness === "claude-code"
            ? m.providerId === "claude"
            : m.providerId === harness,
    ) ?? [];
  const modelOptions = [
    ...new Set([
      "auto-orchestrator",
      ...(harness === "auto" ? [] : [defaultModel(harness)]),
      model,
      ...providersModel.map((m) => `${m.providerId}::${m.id}`),
    ]),
  ];

  const refresh = useCallback(async () => {
    const result = await api<WorkspaceState>("/state");
    setState(result);
    setRuns(result.runs);
    setApprovals(result.approvals);
    if (!projectRef.current) {
      projectRef.current = result.defaultProjectId;
      setProjectId(result.defaultProjectId);
    }
    return result;
  }, []);
  const loadSessions = useCallback(async (id: string) => {
    const [rows, archived] = await Promise.all([
      api<Conversation[]>(`/projects/${id}/conversations`),
      api<Conversation[]>(`/projects/${id}/conversations?archived=true`),
    ]);
    if (projectRef.current === id) { setSessions(rows); setArchivedSessions(archived); }
  }, []);
  const loadDetails = useCallback(async (id: string) => {
    const [next, history] = await Promise.all([
      api<Conversation>(`/conversations/${id}`),
      api<OmniEvent[]>(`/conversations/${id}/events`),
    ]);
    if (selected.current === id) {
      setConversation(next);
      setEvents(history);
      setOpenChatTabs((prev) =>
        prev.map((t) =>
          t.conversationId === id ? { ...t, title: next.title || t.title } : t,
        ),
      );
    }
  }, []);

  const persistActiveChatTab = useCallback(() => {
    const currentId = activeTabIdRef.current;
    const isChat = openChatTabsRef.current.some((t) => t.id === currentId);
    if (!isChat) return;
    setOpenChatTabs((prev) =>
      prev.map((t) =>
        t.id === currentId
          ? {
              ...t,
              conversationId: conversationRef.current?.id ?? t.conversationId,
              title: conversationRef.current?.title || t.title,
              draft: draftRef.current,
              harness,
              model,
            }
          : t,
      ),
    );
  }, [harness, model]);

  const switchChatTab = useCallback(
    async (targetTabId: string) => {
      const currentId = activeTabIdRef.current;
      const targetTab = openChatTabsRef.current.find(
        (t) => t.id === targetTabId,
      );
      if (!targetTab) return;

      const isCurrentChat = openChatTabsRef.current.some(
        (t) => t.id === currentId,
      );
      if (isCurrentChat && currentId !== targetTabId) {
        setOpenChatTabs((prev) =>
          prev.map((t) =>
            t.id === currentId
              ? {
                  ...t,
                  conversationId:
                    conversationRef.current?.id ?? t.conversationId,
                  title: conversationRef.current?.title || t.title,
                  draft: draftRef.current,
                  harness,
                  model,
                }
              : t,
          ),
        );
      }

      setPage("chat");
      setActiveTabId(targetTab.id);
      setDraft(targetTab.draft || "");
      setError("");
      setPalette(false);

      if (targetTab.harness) setHarness(targetTab.harness);
      if (targetTab.model) setModel(targetTab.model);

      if (targetTab.conversationId) {
        selected.current = targetTab.conversationId;
        await loadDetails(targetTab.conversationId);
        try {
          const data = await api<Conversation>(
            `/conversations/${targetTab.conversationId}`,
          );
          if (selected.current === targetTab.conversationId) {
            if (data.modelId) setModel(data.modelId);
          }
        } catch {
          // ignore
        }
      } else {
        selected.current = null;
        setConversation(null);
        setEvents([]);
        if (!targetTab.model) {
          const preferredHarness =
            targetTab.harness ||
            localStorage.getItem("omni.defaultHarness") ||
            "auto";
          setModel(defaultModel(preferredHarness));
        }
      }
      requestAnimationFrame(() => textarea.current?.focus());
    },
    [harness, loadDetails, model],
  );

  const openNewChatTab = useCallback(
    (customHarness?: string) => {
      const currentId = activeTabIdRef.current;
      const preferredHarness =
        customHarness || localStorage.getItem("omni.defaultHarness") || "auto";
      const newModel = defaultModel(preferredHarness);

      const nextNum = openChatTabsRef.current.length + 1;
      const newTabId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTab: OpenChatTab = {
        id: newTabId,
        conversationId: null,
        title: `Chat ${nextNum}`,
        draft: "",
        harness: preferredHarness,
        model: newModel,
      };

      setOpenChatTabs((prev) => {
        const isCurrentChat = prev.some((t) => t.id === currentId);
        const updated = isCurrentChat
          ? prev.map((t) =>
              t.id === currentId
                ? {
                    ...t,
                    conversationId:
                      conversationRef.current?.id ?? t.conversationId,
                    title: conversationRef.current?.title || t.title,
                    draft: draftRef.current,
                    harness,
                    model,
                  }
                : t,
            )
          : prev;
        return [...updated, newTab];
      });

      setPage("chat");
      setActiveTabId(newTabId);
      setHarness(preferredHarness);
      setModel(newModel);
      selected.current = null;
      setConversation(null);
      setEvents([]);
      setDraft("");
      setError("");
      setPalette(false);
      requestAnimationFrame(() => textarea.current?.focus());
      return newTabId;
    },
    [harness, model],
  );

  const newSession = useCallback(
    (customHarness?: unknown) => {
      openNewChatTab(
        typeof customHarness === "string" ? customHarness : undefined,
      );
    },
    [openNewChatTab],
  );

  const closeChatTab = useCallback(
    (id: string) => {
      const tabs = openChatTabsRef.current;
      if (tabs.length <= 1) {
        const freshId = `chat-${Date.now()}`;
        setOpenChatTabs([
          {
            id: freshId,
            conversationId: null,
            title: "Chat",
            draft: "",
          },
        ]);
        setActiveTabId(freshId);
        selected.current = null;
        setConversation(null);
        setEvents([]);
        setDraft("");
        return;
      }

      const remaining = tabs.filter((t) => t.id !== id);
      setOpenChatTabs(remaining);

      if (activeTabIdRef.current === id) {
        const closingIndex = tabs.findIndex((t) => t.id === id);
        const nextTab =
          closingIndex > 0 ? remaining[closingIndex - 1] : remaining[0];
        if (nextTab) {
          void switchChatTab(nextTab.id);
        }
      }
    },
    [switchChatTab],
  );

  const chooseSession = useCallback(
    async (id: string) => {
      setPage("chat");
      setError("");
      setPalette(false);

      const existingTab = openChatTabsRef.current.find(
        (t) => t.conversationId === id,
      );
      if (existingTab) {
        await switchChatTab(existingTab.id);
        return;
      }

      const currentTab = openChatTabsRef.current.find(
        (t) => t.id === activeTabIdRef.current,
      );
      const isCurrentEmpty =
        currentTab &&
        !currentTab.conversationId &&
        !draftRef.current.trim() &&
        events.length === 0;

      if (isCurrentEmpty) {
        selected.current = id;
        await loadDetails(id);
        try {
          const data = await api<Conversation>(`/conversations/${id}`);
          if (selected.current !== id) return;
          if (data.modelId) setModel(data.modelId);
          setOpenChatTabs((prev) =>
            prev.map((t) =>
              t.id === currentTab.id
                ? {
                    ...t,
                    conversationId: id,
                    title: data.title || "Chat",
                  }
                : t,
            ),
          );
        } catch {
          // ignore
        }
        return;
      }

      const newTabId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      selected.current = id;
      await loadDetails(id);
      let sessionTitle = "Chat";
      try {
        const data = await api<Conversation>(`/conversations/${id}`);
        if (selected.current === id && data.modelId) {
          setModel(data.modelId);
        }
        if (data.title) sessionTitle = data.title;
      } catch {
        // ignore
      }

      setOpenChatTabs((prev) => {
        const isCurrentChat = prev.some(
          (t) => t.id === activeTabIdRef.current,
        );
        const updated = isCurrentChat
          ? prev.map((t) =>
              t.id === activeTabIdRef.current
                ? {
                    ...t,
                    conversationId:
                      conversationRef.current?.id ?? t.conversationId,
                    title: conversationRef.current?.title || t.title,
                    draft: draftRef.current,
                    harness,
                    model,
                  }
                : t,
            )
          : prev;
        return [
          ...updated,
          {
            id: newTabId,
            conversationId: id,
            title: sessionTitle,
            draft: "",
          },
        ];
      });
      setActiveTabId(newTabId);
    },
    [events.length, harness, loadDetails, model, switchChatTab],
  );
  const report = (error: unknown) =>
    setError(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    let active = true;
    refresh().catch((e) => active && report(e));
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    loadSessions(projectId).catch(
      (e) => !controller.signal.aborted && report(e),
    );
    api<Context>(`/projects/${projectId}/context`, undefined, controller.signal)
      .then((value) => {
        if (projectRef.current === projectId && !controller.signal.aborted)
          setContext(value);
      })
      .catch((e) => !controller.signal.aborted && report(e));
    api<AtlasStatus>(`/projects/${projectId}/atlas`, undefined, controller.signal)
      .then((value) => {
        if (projectRef.current === projectId && !controller.signal.aborted)
          setAtlas(value);
      })
      .catch((e) => !controller.signal.aborted && report(e));
    api<Git>(`/projects/${projectId}/git`, undefined, controller.signal)
      .then((value) => {
        if (projectRef.current === projectId && !controller.signal.aborted)
          setGit(value);
      })
      .catch((e) => !controller.signal.aborted && report(e));
    return () => controller.abort();
  }, [projectId, contextVersion, loadSessions]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = ({ data }) => {
      const event: OmniEvent = JSON.parse(data),
        p = event.payload;
      if (event.type === "workspace.snapshot") {
        setRuns(p.runs);
        setApprovals(p.approvals);
        if (selected.current) void loadDetails(selected.current).catch(report);
        return;
      }
      if (event.type === "awake.status") {
        setState((current) => current ? { ...current, awake: p as WorkspaceState["awake"] } : current);
        return;
      }
      if (event.type === "approval.requested")
        setApprovals((prev) => [
          ...prev.filter((a) => a.id !== p.id),
          p as Approval,
        ]);
      if (event.type === "approval.resolved")
        setApprovals((prev) => prev.filter((a) => a.id !== p.id));
      if (event.type === "run.started")
        setRuns((prev) => [
          ...prev.filter((r) => r.conversationId !== event.conversationId),
          {
            id: p.runId,
            conversationId: event.conversationId!,
            harnessId: p.harnessId,
            projectId: p.projectId,
          },
        ]);
      if (event.type === "run.finished") {
        setRuns((prev) => prev.filter((r) => r.id !== p.runId));
        setSending(false);
        if (projectRef.current) {
          void loadSessions(projectRef.current).catch(report);
          void api<Git>(`/projects/${projectRef.current}/git`)
            .then(setGit)
            .catch(report);
        }
        if (selected.current === event.conversationId)
          void loadDetails(selected.current).catch(report);
      }
      if (event.conversationId !== selected.current) return;
      if (event.type === "run.error") setError(p.error);
      setEvents((prev) => [...prev, event].slice(-1000));
      if (event.type === "message.created")
        setConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages.filter((m) => m.id !== p.messageId),
                  {
                    id: p.messageId,
                    role: p.role,
                    content: p.content,
                    status: p.status,
                    createdAt: event.createdAt,
                  },
                ],
              }
            : prev,
        );
      if (event.type === "message.delta" && p.messageId)
        setConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === p.messageId
                    ? { ...m, content: m.content + p.delta }
                    : m,
                ),
              }
            : prev,
        );
      if (event.type === "message.revised")
        setConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === p.messageId ? { ...m, content: p.content } : m,
                ),
              }
            : prev,
        );
    };
    return () => source.close();
  }, [loadDetails, loadSessions]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        newSession();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "b" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        openNewBrowserTab();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "b"
      ) {
        e.preventDefault();
        openNewBrowserTab();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "t" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        openNewTerminalTab();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        openNewMarkdownTab();
      }
      if (
        e.key === "Escape" &&
        selected.current &&
        runs.some((r) => r.conversationId === selected.current)
      )
        void api(`/conversations/${selected.current}/cancel`, {}).catch(report);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    newSession,
    openNewBrowserTab,
    openNewMarkdownTab,
    openNewTerminalTab,
    runs,
  ]);

  async function send(prompt = draft) {
    if (!prompt.trim() || busy || !projectId || !connected) return;
    const fullPrompt = attachments.length
      ? `${prompt.trim()}\n\n${attachments.map((file) => `--- Fichier joint : ${file.name} ---\n${file.text}`).join("\n\n")}`
      : prompt;
    if (fullPrompt.length > 128000) {
      setError("Les fichiers joints dépassent la limite de 128 000 caractères.");
      return;
    }
    setError("");
    setSending(true);
    setDraft("");
    setAttachments([]);
    try {
      let current = conversation;
      if (!current) {
        current = await api<Conversation>("/conversations", {
          projectId,
          model,
          title: prompt.slice(0, 75),
        });
        selected.current = current.id;
        setConversation(current);
        setEvents([]);
        setSessions((prev) => [current!, ...prev]);
        setOpenChatTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabIdRef.current
              ? {
                  ...t,
                  conversationId: current!.id,
                  title: current!.title || prompt.slice(0, 75),
                }
              : t,
          ),
        );
      }
      const backendPermissionMode =
        permissionMode === "full-access"
          ? "full"
          : permissionMode === "accept-edits" || permissionMode === "auto"
            ? "allow"
            : permissionMode;
      await api("/runs", {
        conversationId: current.id,
        prompt: fullPrompt,
        harnessId: harness,
        model,
        permissionMode: backendPermissionMode,
      });
    } catch (e) {
      report(e);
      setSending(false);
      setDraft(prompt);
      setAttachments((current) => current.length ? current : attachments);
    }
  }
  async function addAttachments(files: FileList | null) {
    if (!files?.length) return;
    try {
      const additions = await Promise.all(
        Array.from(files).map(async (file) => ({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          text: (await file.text()).slice(0, 64000),
        })),
      );
      setAttachments((current) => [...current, ...additions]);
    } catch (e) {
      report(e);
    }
  }
  function toggleDictation() {
    if (speechRecognition.current) {
      speechRecognition.current.stop();
      speechRecognition.current = null;
      setDictating(false);
      return;
    }
    const SpeechRecognition = (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("La dictée vocale n’est pas prise en charge par ce navigateur.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      if (transcript) setDraft((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event) => {
      setDictating(false);
      speechRecognition.current = null;
      if (event.error !== "no-speech" && event.error !== "aborted")
        setError(`Dictée vocale : ${event.error}`);
    };
    recognition.onend = () => {
      setDictating(false);
      speechRecognition.current = null;
    };
    speechRecognition.current = recognition;
    setDictating(true);
    recognition.start();
  }
  async function generateProjectAtlas() {
    if (!projectId || atlasBusy) return;
    const id = projectId;
    setAtlasBusy(true);
    setAtlasError("");
    try {
      const value = await api<AtlasStatus>(`/projects/${id}/atlas-generate`, {});
      if (projectRef.current === id) setAtlas(value);
    } catch (e) {
      if (projectRef.current === id)
        setAtlasError(e instanceof Error ? e.message : String(e));
    } finally {
      setAtlasBusy(false);
    }
  }
  function selectProject(id: string) {
    projectRef.current = id;
    setProjectId(id);
    setContext(null);
    setAtlas(null);
    setAtlasError("");
    setGit(null);
    setCommitMessage("");
    setSuggestedCommit("");
    setGitError("");
    setSessions([]);
    setArchivedSessions([]);
    setShowArchivedSessions(false);
    setContextVersion((version) => version + 1);
    newSession();
  }
  async function changeSession(session: Conversation, action: "archive" | "restore" | "delete") {
    if (sessionBusy) return;
    if (action === "delete" && !window.confirm(`Supprimer définitivement « ${session.title} » et tous ses messages ?`)) return;
    setSessionBusy(true);
    setSessionError("");
    try {
      await api(`/conversations/${session.id}/${action}`, {});
      if (action === "archive" || action === "delete") {
        const tabToClose = openChatTabsRef.current.find(
          (t) => t.conversationId === session.id,
        );
        if (tabToClose) {
          closeChatTab(tabToClose.id);
        } else if (selected.current === session.id) {
          openNewChatTab();
        }
      }
      await loadSessions(session.projectId);
    } catch (e) { setSessionError(e instanceof Error ? e.message : String(e)); }
    finally { setSessionBusy(false); }
  }
  async function renameSession() {
    if (!renamingSession || sessionBusy) return;
    setSessionBusy(true);
    setSessionError("");
    try {
      const updated = await api<Conversation>(`/conversations/${renamingSession.id}/rename`, { title: sessionTitle });
      if (selected.current === updated.id) setConversation(updated);
      await loadSessions(updated.projectId);
      setRenamingSession(null);
    } catch (e) { setSessionError(e instanceof Error ? e.message : String(e)); }
    finally { setSessionBusy(false); }
  }
  async function addProject() {
    setProjectBusy(true);
    setProjectError("");
    try {
      const next = await api<Project>("/projects", {
        path: projectPath,
        ...(projectName.trim() ? { name: projectName.trim() } : {}),
      });
      await refresh();
      selectProject(next.id);
      setProjectPath("");
      setProjectName("");
      setOpenProject(false);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectBusy(false);
    }
  }
  function editProject(project: Project) {
    setEditingProject(project);
    setEditName(project.name);
    setEditPath(project.rootPath ?? "");
    setProjectError("");
  }
  async function saveProject() {
    if (!editingProject) return;
    setProjectBusy(true);
    setProjectError("");
    try {
      await api(`/projects/${editingProject.id}/update`, {
        name: editName,
        path: editPath,
      });
      await refresh();
      if (
        projectRef.current === editingProject.id &&
        editPath !== editingProject.rootPath
      ) {
        setContext(null);
        setGit(null);
        setContextVersion((version) => version + 1);
      }
      setEditingProject(null);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectBusy(false);
    }
  }
  async function archiveProject(project: Project) {
    if (
      !window.confirm(
        `Retirer « ${project.name} » et ses espaces de travail de la liste ? Les dossiers et les conversations seront conservés. Vous pourrez restaurer le projet.`,
      )
    )
      return;
    setProjectBusy(true);
    try {
      const removed = await api<{ removedIds: string[] }>(`/projects/${project.id}/remove`, {});
      const result = await refresh();
      if (removed.removedIds.includes(projectRef.current))
        selectProject(result.defaultProjectId);
    } catch (e) {
      report(e);
    } finally {
      setProjectBusy(false);
    }
  }
  async function restoreProject(project: Project) {
    setProjectBusy(true);
    setProjectError("");
    try {
      await api(`/projects/${project.id}/restore`, {});
      await refresh();
      selectProject(project.id);
      setOpenProject(false);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectBusy(false);
    }
  }
  async function openWorktree(project: Project, path: string) {
    try {
      const opened = await api<Project>(`/projects/${project.id}/worktree-open`, { path });
      await refresh();
      selectProject(opened.id);
    } catch (error) { report(error); }
  }
  function prepareWorktree(project: Project) {
    setWorkspaceProject(project);
    setWorkspaceBranch("");
    setWorkspacePath("");
    setProjectError("");
  }
  async function createWorktree() {
    if (!workspaceProject) return;
    setProjectBusy(true);
    setProjectError("");
    try {
      const opened = await api<Project>(`/projects/${workspaceProject.id}/worktree-create`, {
        path: workspacePath.trim(), branch: workspaceBranch.trim(),
      });
      await refresh();
      selectProject(opened.id);
      setWorkspaceProject(null);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally { setProjectBusy(false); }
  }
  async function removeWorktree(project: Project, worktree: { path: string; branch: string; projectId: string | null }) {
    if (!window.confirm(`Supprimer l’espace « ${worktree.branch} » et son dossier ${worktree.path} ? Git refusera si des changements sont présents.`)) return;
    try {
      await api(`/projects/${project.id}/worktree-remove`, { path: worktree.path });
      const result = await refresh();
      if (projectRef.current === worktree.projectId) selectProject(project.id === worktree.projectId ? result.defaultProjectId : project.id);
    } catch (error) { report(error); }
  }
  async function openFile(entry: FileEntry, line?: number) {
    if (entry.directory) return;
    persistActiveChatTab();
    const id = `${projectId}::${entry.path}`;
    if (openFileTabs.some((file) => file.id === id)) {
      if (line) updateFileTab(id, { line });
      setPage("chat");
      setActiveTabId(id);
      setFileError("");
      return;
    }
    try {
      const file = await api<{
        path: string;
        content: string;
        revision: string;
        readOnly: boolean;
      }>(`/projects/${projectId}/file?path=${encodeURIComponent(entry.path)}`);
      setFileError("");
      setOpenFileTabs((tabs) =>
        tabs.some((tab) => tab.id === id)
          ? tabs
          : [
              ...tabs,
              {
                ...file,
                id,
                original: file.content,
                projectId,
                line,
                mode: /\.mdx?$/i.test(file.path) ? "preview" : "edit",
              },
            ],
      );
      setPage("chat");
      setActiveTabId(id);
    } catch (e) {
      report(e);
    }
  }
  function updateFileTab(id: string, update: Partial<OpenFileTab>) {
    setOpenFileTabs((tabs) =>
      tabs.map((file) => (file.id === id ? { ...file, ...update } : file)),
    );
  }
  function closeFile(id: string) {
    const closing = openFileTabs.find((file) => file.id === id);
    if (!closing || (savingFile && id === activeTabId)) return;
    if (
      closing.revision &&
      closing.content !== closing.original &&
      !window.confirm("Fermer sans enregistrer les modifications ?")
    )
      return;
    const remaining = openFileTabs.filter((file) => file.id !== id);
    setOpenFileTabs(remaining);
    if (activeTabId === id) {
      const closingIndex = openFileTabs.findIndex((file) => file.id === id);
      const nextId =
        openFileTabs[closingIndex - 1]?.id ??
        (openBrowserTabs[0]?.id ??
          (openTerminalTabs[0]?.id ??
            (openChatTabsRef.current[0]?.id ?? "chat")));
      if (openChatTabsRef.current.some((t) => t.id === nextId)) {
        void switchChatTab(nextId);
      } else {
        setActiveTabId(nextId);
      }
    }
    setFileError("");
  }
  function updateBrowserTab(id: string, update: Partial<OpenBrowserTab>) {
    setOpenBrowserTabs((tabs) =>
      tabs.map((tab) => (tab.id === id ? { ...tab, ...update } : tab)),
    );
  }
  function closeBrowserTab(id: string) {
    const remaining = openBrowserTabs.filter((tab) => tab.id !== id);
    setOpenBrowserTabs(remaining);
    if (activeTabId === id) {
      const closingIndex = openBrowserTabs.findIndex((tab) => tab.id === id);
      if (closingIndex > 0 && remaining[closingIndex - 1]) {
        setActiveTabId(remaining[closingIndex - 1].id);
      } else if (openTerminalTabs.length > 0) {
        setActiveTabId(openTerminalTabs[openTerminalTabs.length - 1].id);
      } else if (openFileTabs.length > 0) {
        setActiveTabId(openFileTabs[openFileTabs.length - 1].id);
      } else {
        const fallbackChatId = openChatTabsRef.current[0]?.id ?? "chat";
        void switchChatTab(fallbackChatId);
      }
    }
  }
  const addBrowserHistory = useCallback((url: string, title?: string) => {
    if (!url || url === "about:blank") return;
    setBrowserHistory((prev) => {
      const filtered = prev.filter((item) => item.url !== url);
      const updated = [
        {
          url,
          title: title || formatBrowserTabTitle(url),
          timestamp: Date.now(),
        },
        ...filtered,
      ].slice(0, 50);
      try {
        localStorage.setItem("omni_browser_history", JSON.stringify(updated));
      } catch {
        // quota
      }
      return updated;
    });
  }, []);
  const clearBrowserHistory = useCallback(() => {
    setBrowserHistory([]);
    try {
      localStorage.removeItem("omni_browser_history");
    } catch {
      // ignore
    }
  }, []);
  function openNewBrowserTab(
    initialUrl = "about:blank",
    initialPreset: "desktop" | "tablet" | "mobile" = "desktop",
    initialTitle?: string,
  ) {
    persistActiveChatTab();
    const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const title = initialTitle ?? formatBrowserTabTitle(initialUrl);
    const newTab: OpenBrowserTab = {
      id,
      url: initialUrl,
      title,
      mode: "direct",
      viewportPreset: initialPreset,
      history: [initialUrl],
      historyIndex: 0,
      loading: initialUrl !== "about:blank",
    };
    setOpenBrowserTabs((tabs) => [...tabs, newTab]);
    setPage("chat");
    setActiveTabId(id);
    if (initialUrl !== "about:blank") {
      addBrowserHistory(initialUrl, title);
    }
    return id;
  }

  function openNewTerminalTab() {
    persistActiveChatTab();
    const num = openTerminalTabs.length + 1;
    const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTab: OpenTerminalTab = {
      id,
      title: `Terminal ${num}`,
      cwd: project?.rootPath,
    };
    setOpenTerminalTabs((prev) => [...prev, newTab]);
    setPage("chat");
    setActiveTabId(id);
    return id;
  }

  function closeTerminalTab(id: string) {
    setOpenTerminalTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== id);
      if (activeTabId === id) {
        const closingIndex = prev.findIndex((tab) => tab.id === id);
        if (closingIndex > 0 && remaining[closingIndex - 1]) {
          setActiveTabId(remaining[closingIndex - 1].id);
        } else if (openBrowserTabs.length > 0) {
          setActiveTabId(openBrowserTabs[openBrowserTabs.length - 1].id);
        } else if (openFileTabs.length > 0) {
          setActiveTabId(openFileTabs[openFileTabs.length - 1].id);
        } else {
          const fallbackChatId = openChatTabsRef.current[0]?.id ?? "chat";
          void switchChatTab(fallbackChatId);
        }
      }
      return remaining;
    });
  }

  function openNewMarkdownTab() {
    persistActiveChatTab();
    const existingCount = openFileTabs.filter((tab) =>
      tab.path.toLowerCase().includes("untitled"),
    ).length;
    const filename = `untitled${existingCount > 0 ? `-${existingCount + 1}` : ""}.md`;
    const id = `draft::${Date.now()}::${filename}`;
    const newTab: OpenFileTab = {
      id,
      path: filename,
      content: `# ${filename.replace(/\.md$/, "")}\n\n`,
      original: "",
      revision: "draft",
      mode: "edit",
      projectId: projectId || undefined,
    };
    setOpenFileTabs((prev) => [...prev, newTab]);
    setPage("chat");
    setActiveTabId(id);
    return id;
  }

  function openNewChatWithHarness(targetHarness: string) {
    openNewChatTab(targetHarness);
  }

  function openMobileEmulator() {
    return openNewBrowserTab("http://localhost:5173", "mobile");
  }

  function openGitDiff(content: string, label = "HEAD", key = "working") {
    const id = `diff:${projectId}:${key}`;
    setOpenFileTabs((tabs) => {
      const existing = tabs.find((file) => file.id === id);
      return existing
        ? tabs.map((file) =>
            file.id === id ? { ...file, content, mode: "edit" } : file,
          )
        : [
            ...tabs,
            {
              id,
              path: `Diff Git · ${label}`,
              content,
              readOnly: true,
              projectId,
              mode: "edit",
            },
          ];
    });
    setPage("chat");
    setActiveTabId(id);
  }
  async function openCommit(commit: GitCommit) {
    try {
      const result = await api<{ content: string }>(`/projects/${projectId}/git-commit-detail?hash=${encodeURIComponent(commit.id)}`);
      openGitDiff(result.content, commit.hash, commit.id);
    } catch (error) { report(error); }
  }
  async function saveFile() {
    if (
      !viewFile?.revision ||
      !viewFile.projectId ||
      viewFile.readOnly ||
      savingFile
    )
      return;
    const current = viewFile;
    setSavingFile(true);
    setFileError("");
    try {
      const result = await api<{ revision: string }>(
        `/projects/${current.projectId}/file`,
        {
          path: current.path,
          content: current.content,
          revision: current.revision,
        },
      );
      updateFileTab(current.id, {
        original: current.content,
        revision: result.revision,
      });
      if (current.projectId === projectRef.current)
        void api<Git>(`/projects/${current.projectId}/git`)
          .then(setGit)
          .catch(() => {});
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFile(false);
    }
  }
  async function gitAction(action: string, body: object) {
    const requestProject = projectId;
    setGitBusy(true);
    setGitError("");
    try {
      await api(`/projects/${requestProject}/${action}`, body);
      const next = await api<Git>(`/projects/${requestProject}/git`);
      if (projectRef.current === requestProject) {
        setGit(next);
        if (action === "git-commit") { setCommitMessage(""); setSuggestedCommit(""); }
      }
    } catch (e) {
      if (projectRef.current === requestProject) setGitError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitBusy(false);
    }
  }
  async function generateCommitMessage() {
    if (generatingCommit || (!stagedChanges.length && !unstagedChanges.length)) return;
    const requestProject = projectId, original = commitMessage;
    setGeneratingCommit(true);
    setGitError("");
    setSuggestedCommit("");
    try {
      const result = await api<{ message: string }>(`/projects/${requestProject}/git-generate-message`, { harnessId: harness, model });
      if (projectRef.current === requestProject) {
        if (commitMessageRef.current === original) setCommitMessage(result.message);
        else setSuggestedCommit(result.message);
      }
    } catch (e) {
      if (projectRef.current === requestProject) setGitError(e instanceof Error ? e.message : String(e));
    } finally { setGeneratingCommit(false); }
  }
  async function openGitFileDiff(change: { path: string; code: string }, staged: boolean) {
    try {
      const params = new URLSearchParams({ path: change.path, staged: String(staged), untracked: String(change.code === "??") });
      const result = await api<{ content: string }>(`/projects/${projectId}/git-file-diff?${params}`);
      openGitDiff(result.content || "Aucune différence disponible.", change.path, `${staged ? "index" : "worktree"}:${change.path}`);
    } catch (e) { setGitError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => {
    if (!viewFile?.revision) return;
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  });
  useEffect(() => {
    if (
      !openFileTabs.some(
        (file) => file.revision && file.content !== file.original,
      )
    )
      return;
    const handle = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [openFileTabs]);
  async function decide(id: string, allowed: boolean) {
    try {
      await api(`/approvals/${id}`, { allowed });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      report(e);
    }
  }
  async function addMcp() {
    try {
      const args = JSON.parse(mcpArgs);
      if (!Array.isArray(args) || args.some((x) => typeof x !== "string"))
        throw new Error("Arguments : tableau JSON de chaînes requis.");
      await api("/mcp", {
        name: mcpName,
        command: mcpCommand,
        args,
        envKeys: [],
      });
      setMcpName("");
      setMcpCommand("");
      setMcpArgs("[]");
      await refresh();
    } catch (e) {
      report(e);
    }
  }
  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(
        messages
          .map((m) => `${m.role === "user" ? "Vous" : "Omni"}\n${m.content}`)
          .join("\n\n"),
      );
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1800);
    } catch (e) {
      report(e);
    }
  }
  const suggestions = [
    {
      icon: Layers,
      title: "Comprendre le projet",
      description: "Architecture, stack et points d’entrée",
      prompt:
        "Analyse la structure de ce projet, lis ses instructions AGENTS.md et explique son architecture avec les fichiers importants.",
    },
    {
      icon: Workflow,
      title: "Reprendre avec dotcontext",
      description: "Contexte, décisions et prochaine étape",
      prompt:
        "Utilise les outils MCP dotcontext pour vérifier le contexte de ce projet, lire le workflow actif et proposer la prochaine étape concrète.",
    },
    {
      icon: Terminal,
      title: "Vérifier la qualité",
      description: "Tests, erreurs et améliorations",
      prompt:
        "Inspecte les scripts de validation du projet et propose les vérifications pertinentes. Demande mon approbation pour les commandes qui en ont besoin.",
    },
  ];

  function gitChangeRow(change: { path: string; code: string; oldPath?: string }, staged: boolean) {
    const name = change.path.split("/").at(-1) ?? change.path;
    const directory = change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : "";
    const status = change.code === "??" ? "U" : (staged ? change.code[0] : change.code[1]);
    return <div className="source-change" key={`${staged ? "staged" : "unstaged"}:${change.path}`}>
      <button type="button" className="source-change-open" title={`${change.path}${change.oldPath ? ` ← ${change.oldPath}` : ""}`} onClick={() => void openGitFileDiff(change, staged)}>
        <FileIcon path={change.path} /><span className="source-change-name">{name}</span><span className="source-change-directory">{directory}</span>
      </button>
      <span className={cn("source-change-status", status === "U" || status === "A" ? "is-added" : status === "D" ? "is-deleted" : "is-modified")}>{status}</span>
      <Button variant="ghost" size="icon-xs" className="source-change-action" title={`${staged ? "Désindexer" : "Indexer"} ${change.path}`} aria-label={`${staged ? "Désindexer" : "Indexer"} ${change.path}`} disabled={gitBusy} onClick={() => void gitAction(staged ? "git-unstage" : "git-stage", { path: change.path })}>{staged ? <Minus /> : <Plus />}</Button>
    </div>;
  }
  function sessionRow(session: Conversation, archived = false) {
    const running = session.status === "running" || runs.some((run) => run.conversationId === session.id);
    return (
      <div key={session.id} className={cn("session-row", conversation?.id === session.id && "session-active")}>
        <button type="button" className="session-row-open" onClick={() => archived ? void changeSession(session, "restore") : void chooseSession(session.id).catch(report)} title={archived ? "Restaurer la conversation" : session.title}>
          <MessageSquare /> <span>{session.title}</span> {running && <LoaderCircle className="animate-spin" />}
        </button>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild><button type="button" className="session-row-menu" aria-label={`Actions pour ${session.title}`}><MoreHorizontal /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="project-action-menu" sideOffset={5} align="end">
            <DropdownMenu.Item className="project-action-menu-item" onSelect={() => { setSessionTitle(session.title); setSessionError(""); setRenamingSession(session); }}><Pencil /> Renommer</DropdownMenu.Item>
            {archived ? <DropdownMenu.Item className="project-action-menu-item" disabled={sessionBusy} onSelect={() => void changeSession(session, "restore")}><ArchiveRestore /> Restaurer</DropdownMenu.Item>
              : <DropdownMenu.Item className="project-action-menu-item" disabled={sessionBusy || running} onSelect={() => void changeSession(session, "archive")}><Archive /> Archiver</DropdownMenu.Item>}
            <DropdownMenu.Item className="project-action-menu-item session-delete-action" disabled={sessionBusy || running} onSelect={() => void changeSession(session, "delete")}><Trash2 /> Supprimer définitivement</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    );
  }
  const awakeControl = (
    <AwakeStatusSegment
      status={state?.awake}
      connected={connected}
      onChange={(awake) => setState((current) => current ? { ...current, awake } : current)}
      onError={report}
    />
  );
  return (
    <div
      className={cn(
        "workspace",
        page === "settings" ? "settings-layout" : !panel && "panel-hidden",
      )}
    >
      {page !== "settings" && (
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/omni.svg" alt="Omni" />
          <span>
            omni<span className="brand-dot">.</span>
          </span>
          <Badge variant="outline">LOCAL</Badge>
        </div>
        <div className="sidebar-actions">
          <Button variant="secondary" onClick={newSession}>
            <Plus data-icon="inline-start" />
            Nouvelle session<span className="shortcut">⇧ ⌘ O</span>
          </Button>
          <Button variant="ghost" onClick={() => setPalette(true)}>
            <Search data-icon="inline-start" />
            Rechercher<span className="shortcut">⌘ K</span>
          </Button>
          <Button
            variant={page === "tasks" ? "secondary" : "ghost"}
            onClick={() => setPage("tasks")}
          >
            <ListTodo data-icon="inline-start" />
            Tâches
          </Button>
          <Button
            variant={page === "artifacts" ? "secondary" : "ghost"}
            onClick={() => setPage("artifacts")}
          >
            <FileBox data-icon="inline-start" /> Artéfacts
          </Button>
          <Button
            variant={page === "skills" ? "secondary" : "ghost"}
            onClick={() => setPage("skills")}
          >
            <BookOpen data-icon="inline-start" /> Skills
          </Button>
          <Button
            variant={page === "agents" ? "secondary" : "ghost"}
            onClick={() => setPage("agents")}
          >
            <LayoutDashboard data-icon="inline-start" /> Tableau de bord des
            agents
          </Button>
        </div>
        <Separator />
        <ProjectsNav
          projects={state?.projects ?? []}
          active={projectId}
          activeBranch={git?.branch}
          runs={runs}
          approvals={approvals}
          onSelect={selectProject}
          onEdit={editProject}
          onArchive={(project) => void archiveProject(project)}
          onOpenWorkspace={(project, path) => void openWorktree(project, path)}
          onCreateWorkspace={prepareWorktree}
          onRemoveWorkspace={(project, worktree) => void removeWorktree(project, worktree)}
          onAddProject={() => setOpenProject(true)}
          onOpenAgent={(run) => {
            if (run.projectId && run.projectId !== projectRef.current) selectProject(run.projectId);
            void chooseSession(run.conversationId).catch(report);
          }}
        />
        <div className="section-label conversations-heading">
          CONVERSATIONS<span>{sessions.length}</span>
        </div>
        {sessions.length > 5 && (
          <Input
            aria-label="Filtrer les conversations"
            placeholder="Filtrer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="session-filter"
          />
        )}
        <nav className="session-list" aria-label="Conversations">
          {sessionError && !renamingSession && <p className="session-error" role="alert">{sessionError}</p>}
          {sessions
            .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
            .map((session) => sessionRow(session))}
          {!sessions.length && (
            <p className="sidebar-hint">Vos conversations apparaîtront ici.</p>
          )}
          {archivedSessions.length > 0 && <div className="session-archive-group">
            <button type="button" className="session-archive-toggle" aria-expanded={showArchivedSessions} onClick={() => setShowArchivedSessions((value) => !value)}><Archive /> Archives <span>{archivedSessions.length}</span><ChevronDown className={showArchivedSessions ? "" : "is-collapsed"} /></button>
            {showArchivedSessions && archivedSessions.filter((session) => session.title.toLowerCase().includes(search.toLowerCase())).map((session) => sessionRow(session, true))}
          </div>}
        </nav>
        <div className="sidebar-bottom">
          <Button variant="ghost" onClick={() => setPage("settings")}>
            <Settings2 data-icon="inline-start" />
            Paramètres
          </Button>
          <div className="connection-line">
            <span
              className={cn("connection-dot", connected && "is-connected")}
            />
            <span>
              {connected ? t("footer.runtimeConnected") : t("footer.runtimeReconnecting")}
            </span>
            <span>v{state?.version ?? "0.1.0"}</span>
          </div>
          {page !== "chat" && !panel && awakeControl}
        </div>
      </aside>
      )}

      {page === "chat" ? (
        <main className="main-pane">
          <header className="workspace-header">
            <div className="breadcrumb">
              <FolderOpen />
              <span>{project?.name ?? "Chargement…"}</span>
              <ChevronRight />
              <strong>
                {conversation ? "Conversation" : "Nouvelle session"}
              </strong>
            </div>
            <div className="header-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                title="Ouvrir le navigateur interne (⌘B)"
                aria-label="Ouvrir le navigateur interne"
                onClick={() => openNewBrowserTab()}
              >
                <Globe />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Actualiser"
                aria-label="Actualiser"
                onClick={() => void refresh().catch(report)}
              >
                <RefreshCw />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Panneau du projet"
                aria-label="Panneau du projet"
                onClick={() => setPanel((p) => !p)}
              >
                {panel ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </div>
          </header>
          <nav
            className="workspace-tabs"
            role="tablist"
            aria-label="Onglets de travail"
          >
            {openChatTabs.map((chatTab) => {
              const isActive = activeTabId === chatTab.id;
              const displayTitle = isActive
                ? (conversation?.title || chatTab.title || "Chat")
                : (chatTab.title || "Chat");
              return (
                <div
                  className={cn(
                    "workspace-tab",
                    isActive && "is-active",
                  )}
                  key={chatTab.id}
                >
                  <button
                    role="tab"
                    aria-selected={isActive}
                    title={displayTitle}
                    onClick={() => void switchChatTab(chatTab.id)}
                  >
                    <MessageSquare />
                    <span>{displayTitle}</span>
                  </button>
                  {openChatTabs.length > 1 && (
                    <button
                      className="workspace-tab-close"
                      aria-label={`Fermer ${displayTitle}`}
                      title="Fermer l’onglet"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeChatTab(chatTab.id);
                      }}
                    >
                      <X />
                    </button>
                  )}
                </div>
              );
            })}
            {openFileTabs.map((file) => (
              <div
                className={cn(
                  "workspace-tab",
                  activeTabId === file.id && "is-active",
                )}
                key={file.id}
              >
                <button
                  role="tab"
                  aria-selected={activeTabId === file.id}
                  title={file.path}
                  onClick={() => {
                    persistActiveChatTab();
                    setActiveTabId(file.id);
                  }}
                >
                  {file.path.startsWith("Diff Git") ? <FileCode2 /> : <FileIcon path={file.path} />}
                  <span>{file.path.split("/").at(-1)}</span>
                  {file.revision && file.content !== file.original && (
                    <i aria-label="Modifié" />
                  )}
                </button>
                <button
                  className="workspace-tab-close"
                  aria-label={`Fermer ${file.path}`}
                  title="Fermer l’onglet"
                  onClick={() => closeFile(file.id)}
                >
                  <X />
                </button>
              </div>
            ))}
            {openBrowserTabs.map((browserTab) => (
              <div
                className={cn(
                  "workspace-tab",
                  activeTabId === browserTab.id && "is-active",
                )}
                key={browserTab.id}
              >
                <button
                  role="tab"
                  aria-selected={activeTabId === browserTab.id}
                  title={browserTab.url}
                  onClick={() => {
                    persistActiveChatTab();
                    setActiveTabId(browserTab.id);
                  }}
                >
                  <Globe />
                  <span>
                    {browserTab.title ||
                      formatBrowserTabTitle(browserTab.url)}
                  </span>
                  {browserTab.loading && (
                    <LoaderCircle className="animate-spin text-muted-foreground w-3 h-3 ml-0.5" />
                  )}
                </button>
                <button
                  className="workspace-tab-close"
                  aria-label={`Fermer l'onglet ${browserTab.title}`}
                  title="Fermer l’onglet"
                  onClick={() => closeBrowserTab(browserTab.id)}
                >
                  <X />
                </button>
              </div>
            ))}
            {openTerminalTabs.map((termTab) => (
              <div
                className={cn(
                  "workspace-tab",
                  activeTabId === termTab.id && "is-active",
                )}
                key={termTab.id}
              >
                <button
                  role="tab"
                  aria-selected={activeTabId === termTab.id}
                  title={termTab.title}
                  onClick={() => {
                    persistActiveChatTab();
                    setActiveTabId(termTab.id);
                  }}
                >
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  <span>{termTab.title}</span>
                </button>
                <button
                  className="workspace-tab-close"
                  aria-label={`Fermer ${termTab.title}`}
                  title="Fermer l’onglet"
                  onClick={() => closeTerminalTab(termTab.id)}
                >
                  <X />
                </button>
              </div>
            ))}
            <TabCreateDropdown
              isOpen={newTabDropdownOpen}
              onOpenChange={setNewTabDropdownOpen}
              onNewTerminal={openNewTerminalTab}
              onNewBrowser={openNewBrowserTab}
              onNewMarkdown={openNewMarkdownTab}
              onNewChat={openNewChatTab}
              onNewMobileEmulator={openMobileEmulator}
              onSelectAgent={openNewChatWithHarness}
              onOpenSettings={() => setSettings(true)}
              openTabs={[
                ...openChatTabs.map((c) => ({
                  id: c.id,
                  title:
                    c.id === activeTabId
                      ? conversation?.title || c.title || "Chat"
                      : c.title || "Chat",
                  type: "chat" as const,
                })),
                ...openFileTabs.map((f) => ({
                  id: f.id,
                  title: f.path.split("/").pop() || f.path,
                  type: "file" as const,
                })),
                ...openBrowserTabs.map((b) => ({
                  id: b.id,
                  title: b.title || formatBrowserTabTitle(b.url),
                  type: "browser" as const,
                })),
                ...openTerminalTabs.map((t) => ({
                  id: t.id,
                  title: t.title,
                  type: "terminal" as const,
                })),
              ]}
              onSelectTab={(tabId) => {
                if (openChatTabs.some((c) => c.id === tabId)) {
                  void switchChatTab(tabId);
                } else {
                  persistActiveChatTab();
                  setActiveTabId(tabId);
                  setPage("chat");
                }
              }}
            >
              <button
                className={cn(
                  "workspace-tab-add",
                  newTabDropdownOpen && "is-open",
                )}
                aria-label="Créer un nouvel onglet"
                title="Créer un nouvel onglet (⌘T, ⌘⇧B, ⌘⇧M, ⇧⌘O)"
              >
                <Plus />
              </button>
            </TabCreateDropdown>
          </nav>
          <div className="conversation-surface">
            {viewFile ? (
              <section className="file-workbench">
                <div className="file-toolbar">
                  <div className="file-location" title={viewFile.path}>
                    {viewFile.path}
                  </div>
                  <div className="file-toolbar-actions">
                    {viewFile.revision &&
                      !viewFile.readOnly &&
                      /\.mdx?$/i.test(viewFile.path) && (
                        <div className="file-mode-toggle">
                          <Button
                            variant={
                              viewFile.mode === "preview"
                                ? "secondary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateFileTab(viewFile.id, { mode: "preview" })
                            }
                          >
                            <Eye /> Aperçu
                          </Button>
                          <Button
                            variant={
                              viewFile.mode === "edit" ? "secondary" : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateFileTab(viewFile.id, { mode: "edit" })
                            }
                          >
                            <Code2 /> Modifier
                          </Button>
                        </div>
                      )}
                    {viewFile.revision && (
                      <span className="file-save-state">
                        {viewFile.content !== viewFile.original
                          ? "Modifications non enregistrées"
                          : "Enregistré"}
                      </span>
                    )}
                    {viewFile.revision && (
                      <Button
                        size="sm"
                        disabled={
                          viewFile.readOnly ||
                          savingFile ||
                          viewFile.content === viewFile.original
                        }
                        onClick={() => void saveFile()}
                      >
                        <Save />{" "}
                        {savingFile ? "Enregistrement…" : "Enregistrer"}
                      </Button>
                    )}
                  </div>
                </div>
                {fileError && (
                  <Alert variant="destructive">
                    <AlertTitle>Action impossible</AlertTitle>
                    <AlertDescription>{fileError}</AlertDescription>
                  </Alert>
                )}
                <div className="editor-surface">
                  {viewFile.revision ? (
                    viewFile.mode === "preview" &&
                    /\.mdx?$/i.test(viewFile.path) ? (
                      <article className="markdown-file-preview">
                        <MarkdownContent
                          text={viewFile.content}
                          onOpenCitation={(citationPath, line) => {
                            void openFile(
                              {
                                name:
                                  citationPath.split("/").at(-1) ??
                                  citationPath,
                                path: citationPath,
                                directory: false,
                              },
                              line,
                            );
                          }}
                        />
                      </article>
                    ) : (
                      <Suspense
                        fallback={
                          <div className="editor-loading">
                            Chargement de l’éditeur…
                          </div>
                        }
                      >
                        <FileEditor
                          path={`${viewFile.projectId}/${viewFile.path}`}
                          content={viewFile.content}
                          readOnly={Boolean(viewFile.readOnly)}
                          line={viewFile.line}
                          onChange={(content) =>
                            updateFileTab(viewFile.id, { content })
                          }
                        />
                      </Suspense>
                    )
                  ) : (
                    <CodeBlock>
                      <CodeBlockHeader>
                        <CodeBlockTitle>
                          {viewFile.path.split("/").at(-1)}
                        </CodeBlockTitle>
                        <CodeBlockActions>
                          <CodeBlockCopyButton value={viewFile.content} />
                        </CodeBlockActions>
                      </CodeBlockHeader>
                      <CodeBlockContent lineNumbers>
                        {viewFile.path.startsWith("Diff Git")
                          ? viewFile.content.split("\n").map((line, i) => (
                              <CodeBlockLine
                                key={i}
                                variant={
                                  line.startsWith("+")
                                    ? "added"
                                    : line.startsWith("-")
                                      ? "removed"
                                      : "default"
                                }
                              >
                                {line}
                              </CodeBlockLine>
                            ))
                          : viewFile.content}
                      </CodeBlockContent>
                    </CodeBlock>
                  )}
                </div>
              </section>
            ) : activeBrowserTab ? (
              <BrowserPane
                tab={activeBrowserTab}
                onUpdateTab={(updates) =>
                  updateBrowserTab(activeBrowserTab.id, updates)
                }
                onCloseTab={() => closeBrowserTab(activeBrowserTab.id)}
                onOpenNewTab={(url) => openNewBrowserTab(url)}
                history={browserHistory}
                onAddHistory={addBrowserHistory}
                onClearHistory={clearBrowserHistory}
              />
            ) : activeTerminalTab ? (
              <TerminalPane
                tabId={activeTerminalTab.id}
                projectId={projectId}
                initialCwd={activeTerminalTab.cwd}
                onCloseTab={() => closeTerminalTab(activeTerminalTab.id)}
              />
            ) : (
              <>
                {!messages.length ? (
                  <div className="welcome">
                    <img
                      className="welcome-mark"
                      src="/assets/omni.svg"
                      alt=""
                    />
                    <h1>
                      Une idée.
                      <br />
                      <span>Tous vos agents.</span>
                    </h1>
                    <p>
                      Le contexte, les outils et les meilleurs moteurs.
                      <br />
                      Réunis dans un seul espace, sous votre contrôle.
                    </p>
                    <div className="suggestions">
                      {suggestions.map(
                        ({ icon: Icon, title, description, prompt }) => (
                          <Button
                            variant="outline"
                            key={title}
                            className="suggestion"
                            onClick={() => {
                              setDraft(prompt);
                              textarea.current?.focus();
                            }}
                          >
                            <Icon data-icon="inline-start" />
                            <span>
                              <strong>{title}</strong>
                              <small>{description}</small>
                            </span>
                            <ArrowUpRight />
                          </Button>
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <MessageScrollerProvider
                    key={conversation?.id}
                    autoScroll
                    defaultScrollPosition="end"
                  >
                    <MessageScroller>
                      <MessageScrollerViewport>
                        <MessageScrollerContent className="thread-content">
                          {messages.map((message, index) => (
                            <MessageScrollerItem
                              key={message.id}
                              messageId={message.id}
                              scrollAnchor={message.role === "user"}
                            >
                              <Message
                                align={
                                  message.role === "user" ? "end" : "start"
                                }
                              >
                                <MessageContent>
                                  <MessageHeader>
                                    {message.role === "assistant" ? (
                                      <>
                                        <img src="/assets/omni.svg" alt="" />
                                        Omni
                                        <span className="message-engine">
                                          {harness}
                                        </span>
                                      </>
                                    ) : (
                                      "Vous"
                                    )}
                                  </MessageHeader>
                                  {message.role === "assistant" &&
                                    index === messages.length - 1 && (
                                      <ToolTrace events={events} />
                                    )}
                                  <Bubble
                                    variant={
                                      message.role === "user"
                                        ? "secondary"
                                        : "ghost"
                                    }
                                    align={
                                      message.role === "user" ? "end" : "start"
                                    }
                                  >
                                    <BubbleContent>
                                      {message.content ? (
                                        <MarkdownContent
                                          text={message.content}
                                          onOpenCitation={(path, line) =>
                                            void openFile(
                                              {
                                                name:
                                                  path.split("/").at(-1) ??
                                                  path,
                                                path,
                                                directory: false,
                                              },
                                              line,
                                            )
                                          }
                                        />
                                      ) : busy ? (
                                        <span className="shimmer">
                                          L’agent prépare son exécution…
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {message.status === "failed"
                                            ? "Exécution échouée. Consultez les détails ci-dessous."
                                            : "Aucune sortie texte."}
                                        </span>
                                      )}
                                    </BubbleContent>
                                  </Bubble>
                                </MessageContent>
                              </Message>
                            </MessageScrollerItem>
                          ))}
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton />
                    </MessageScroller>
                  </MessageScrollerProvider>
                )}
              </>
            )}
          </div>
          {isChatActive && (
            <div className="composer-zone">
              {conversation?.status === "running" && !busy && (
                <Alert>
                  <RefreshCw />
                  <AlertTitle>Session à reprendre</AlertTitle>
                  <AlertDescription>
                    Cette conversation a été laissée en cours par un processus
                    précédent. Le texte partiel sera conservé.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void api<Conversation>(
                          `/conversations/${conversation.id}/recover`,
                          {},
                        )
                          .then(setConversation)
                          .catch(report)
                      }
                    >
                      Reprendre la session interrompue
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <ShieldAlert />
                  <AlertTitle>Action impossible</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Fermer l’erreur"
                    onClick={() => setError("")}
                  >
                    <X />
                  </Button>
                </Alert>
              )}
              {pending.map((approval) => (
                <Alert key={approval.id} className="approval-card">
                  <ShieldCheck />
                  <AlertTitle>Autoriser cette action ?</AlertTitle>
                  <AlertDescription>
                    <span>
                      {approval.request.toolName ??
                        approval.request.method ??
                        "Action du Harness"}
                      {approval.request.server
                        ? ` · ${approval.request.server}`
                        : ""}
                    </span>
                    <CodeBlock size="sm">
                      <CodeBlockContent wrap>
                        {JSON.stringify(
                          approval.request.input ??
                            approval.request.params ?? {
                              action: approval.request.action,
                              server: approval.request.server,
                            },
                          null,
                          2,
                        )}
                      </CodeBlockContent>
                    </CodeBlock>
                    <div className="approval-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void decide(approval.id, false)}
                      >
                        Refuser
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void decide(approval.id, true)}
                      >
                        <Check data-icon="inline-start" />
                        Autoriser une fois
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <input
                  ref={attachmentInput}
                  className="sr-only"
                  type="file"
                  multiple
                  accept="text/*,.md,.mdx,.json,.yaml,.yml,.toml,.xml,.csv,.log,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.sql,.sh,.css,.html"
                  onChange={(event) => {
                    void addAttachments(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                <InputGroup className="composer">
                  <InputGroupTextarea
                    ref={textarea}
                    aria-label="Votre demande"
                    placeholder="Que souhaitez-vous construire aujourd’hui ?"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    disabled={busy}
                  />
                  <InputGroupAddon align="block-end">
                    <div className="composer-action-row">
                      <div className="composer-leading-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Ajouter des fichiers"
                          title="Ajouter des fichiers texte au contexte"
                          disabled={busy}
                          onClick={() => attachmentInput.current?.click()}
                        >
                          <Plus />
                        </Button>
                        <PermissionModePicker
                          value={permissionMode}
                          onChange={setPermissionMode}
                          disabled={busy}
                        />
                      </div>
                      <div className="composer-trailing-actions">
                        <div className="composer-settings">
                          <Select
                            value={harness}
                            onValueChange={(id) => {
                              setHarness(id);
                              setModel(defaultModel(id));
                            }}
                            disabled={busy}
                          >
                            <SelectTrigger aria-label="Harness">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="auto">Auto</SelectItem>
                                {state?.harnesses.map((h) => (
                                  <SelectItem
                                    key={h.id}
                                    value={h.id}
                                    disabled={h.enabled === false}
                                  >
                                    {h.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <Select
                            value={model}
                            onValueChange={setModel}
                            disabled={busy}
                          >
                            <SelectTrigger aria-label="Modèle">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {modelOptions.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {m === "auto-orchestrator"
                                      ? "Auto Orchestrator"
                                      : m === defaultModel(harness)
                                        ? "Modèle par défaut"
                                        : m.includes("::")
                                          ? `${m.split("::")[0]} · ${m.split("::").slice(1).join("::")}`
                                          : m}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant={dictating ? "secondary" : "ghost"}
                          size="icon-sm"
                          className={dictating ? "composer-mic is-recording" : "composer-mic"}
                          aria-label={dictating ? "Arrêter la dictée" : "Dicter un message"}
                          title={dictating ? "Arrêter la dictée" : "Dicter un message"}
                          onClick={toggleDictation}
                          disabled={busy}
                        >
                          {dictating ? <MicOff /> : <Mic />}
                        </Button>
                      </div>
                    </div>
                    <div className="composer-submit">
                      {busy ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label="Arrêter"
                          onClick={() =>
                            conversation &&
                            void api(
                              `/conversations/${conversation.id}/cancel`,
                              {},
                            ).catch(report)
                          }
                        >
                          <Square />
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="icon-sm"
                          aria-label="Envoyer"
                          disabled={!draft.trim() || !connected || !project}
                        >
                          <ArrowUp />
                        </Button>
                      )}
                    </div>
                  </InputGroupAddon>
                </InputGroup>
              </form>
              {attachments.length > 0 && (
                <div className="composer-attachments" aria-label="Fichiers joints">
                  {attachments.map((file) => (
                    <Badge key={file.id} variant="secondary">
                      <Paperclip /> {file.name}
                      <button
                        type="button"
                        aria-label={`Retirer ${file.name}`}
                        onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                      >
                        <X />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="composer-footnote">
                <span>
                  {permissionMode === "full-access" ? (
                    <ShieldAlert className="text-amber-400" />
                  ) : permissionMode === "accept-edits" ? (
                    <FilePenLine />
                  ) : permissionMode === "auto" ? (
                    <ShieldCheck />
                  ) : (
                    <Hand />
                  )}
                  {permissionMode === "ask"
                    ? "Les demandes d’autorisation nécessitent votre accord."
                    : permissionMode === "accept-edits"
                      ? "Les modifications de fichiers seront approuvées automatiquement."
                      : permissionMode === "auto"
                        ? "Les demandes d’autorisation seront examinées pour vous."
                        : "Accès complet activé : aucune confirmation requise."}
                </span>
                <span>
                  Entrée pour envoyer · ⇧ Entrée pour une nouvelle ligne
                </span>
              </div>
            </div>
          )}
          <footer className="statusbar">
            <span>
              <GitBranch />
              {git?.available
                ? git.branch || t("footer.detachedHead")
                : t("footer.noGit")}
            </span>
            <span>
              {project ? shortPath(project.rootPath) : t("footer.noProject")}
            </span>
            <span className="statusbar-right">
              <UsageFooter />
              {awakeControl}
              {busy ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  {t("footer.agentRunning")}
                </>
              ) : (
                <>
                  <span className="connection-dot is-connected" />
                  {t("footer.ready")}
                </>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                title={t("footer.copyTranscript")}
                aria-label={t("footer.copyTranscript")}
                disabled={!messages.length}
                onClick={() => void copyTranscript()}
              >
                {copyDone ? <CheckCheck /> : <Copy />}
              </Button>
            </span>
          </footer>
        </main>
      ) : page === "tasks" ? (
        <TasksPanel
          projects={state?.projects ?? []}
          activeProject={projectId}
          onWork={(selectedProject, task) => {
            selectProject(selectedProject.id);
            setDraft(
              `Analyse et traite cette tâche GitHub : ${task.url ?? `#${task.number}`} — ${task.title}`,
            );
          }}
        />
      ) : page === "agents" ? (
        <AgentDashboard
          conversations={sessions}
          runs={runs}
          onOpen={(id) => {
            setPage("chat");
            void chooseSession(id).catch(report);
          }}
        />
      ) : page === "skills" ? (
        <SkillsPage projectId={projectId} />
      ) : page === "artifacts" ? (
        <ArtifactsPage
          project={project}
          onOpen={(path) => {
            const name = path.split("/").at(-1) ?? path;
            if (projectId && /\.html?$/i.test(path)) {
              openNewBrowserTab(
                `/api/projects/${encodeURIComponent(projectId)}/artifact-raw?path=${encodeURIComponent(path)}`,
                "desktop",
                name,
              );
              return;
            }
            void openFile({ name, path, directory: false });
          }}
        />
      ) : state ? (
        <SettingsPanel
          state={state}
          refresh={refresh}
          addMcp={() => setSettings(true)}
          currentHarness={harness}
          setDefaultHarness={(id) => {
            localStorage.setItem("omni.defaultHarness", id);
            setHarness(id);
            setModel(defaultModel(id));
          }}
          permissionMode={permissionMode}
          setDefaultPermission={(mode) => {
            localStorage.setItem("omni.permissionDefault", mode);
            setPermissionMode(mode);
          }}
          onBack={() => setPage("chat")}
        />
      ) : null}

      {panel && page !== "settings" && (
        <aside className="inspector">
          <div className="inspector-title">
            <Layers />
            PROJET
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Fermer le panneau"
              onClick={() => setPanel(false)}
            >
              <X />
            </Button>
          </div>
          <Tabs defaultValue="context" className="inspector-tabs">
            <TabsList>
              <TabsTrigger value="context">Contexte</TabsTrigger>
              <TabsTrigger value="files">Fichiers</TabsTrigger>
              <TabsTrigger value="git">Git</TabsTrigger>
              <TabsTrigger value="activity">Activité</TabsTrigger>
            </TabsList>
            <TabsContent value="context">
              <section className="inspector-section">
                <div className="section-label">
                  INSTRUCTIONS DU PROJET
                  <Badge variant="secondary">
                    {context?.files.length ?? 0}
                  </Badge>
                </div>
                {context?.files.map((file) => (
                  <div className="context-file" key={file.path}>
                    <FileIcon path={file.path} />
                    <div>
                      <strong>{file.path.split("/").at(-1)}</strong>
                      <span title={file.path}>{shortPath(file.path)}</span>
                    </div>
                    <Check />
                  </div>
                ))}
                {context && !context.files.length && (
                  <p className="inspector-hint">
                    Aucune instruction AGENTS.md ou .context détectée.
                  </p>
                )}
                <div className="context-note">
                  <ShieldCheck />
                  <span>
                    Les instructions sont chargées à chaque tour et transmises
                    au Harness.
                  </span>
                </div>
              </section>
              <section className="inspector-section">
                <div className="section-label">ATLAS DU PROJET</div>
                {atlas?.present ? (
                  <div className="context-file">
                    <FileIcon path="atlas/index.json" />
                    <div>
                      <strong>atlas/</strong>
                      <span>
                        {(atlas.stack ?? []).join(" · ") || "stack non détectée"} ·{" "}
                        {atlas.sourceFiles} fichiers · {atlas.entryPoints} points
                        d'entrée · {atlas.scripts} scripts
                      </span>
                    </div>
                    <Check />
                  </div>
                ) : null}
                {atlas && !atlas.present && (
                  <p className="inspector-hint">
                    Aucun atlas dans ce projet. Il donne aux agents une carte
                    vérifiée du code, avec les fichiers cités.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!projectId || atlas === null || atlasBusy}
                  onClick={generateProjectAtlas}
                >
                  {atlasBusy
                    ? "Création…"
                    : atlas?.present
                      ? "Régénérer l'atlas"
                      : "Créer l'atlas"}
                </Button>
                {atlasError && <p className="inspector-hint">{atlasError}</p>}
                {atlas?.present && projectId && (
                  <AtlasViewer
                    projectId={projectId}
                    pages={atlas.pages ?? []}
                    activePath={
                      openFileTabs.find((tab) => tab.id === activeTabId)?.path ?? null
                    }
                    onOpenFile={(entry) => void openFile(entry)}
                    onOpenCitation={(path, line) =>
                      void openFile(
                        { name: path.split("/").at(-1) ?? path, path, directory: false },
                        line,
                      )
                    }
                  />
                )}
              </section>
            </TabsContent>
            <TabsContent value="files">
              <section className="inspector-section">
                <div className="section-label">EXPLORATEUR</div>
                <FileTree
                  projectId={projectId}
                  refreshKey={contextVersion}
                  activePath={
                    openFileTabs.find((tab) => tab.id === activeTabId)?.path ?? null
                  }
                  onOpenFile={(entry) => void openFile(entry)}
                />
              </section>
            </TabsContent>
            <TabsContent value="git">
              <section className="inspector-section">
                <div className="source-control-title">Contrôle de source</div>
                {git?.available && (
                  <div className="git-controls source-control">
                    <div className="source-repository-header">
                      <GitBranch /><strong title={project?.name}>{project?.name ?? "Dépôt"}</strong>
                      <Button variant="ghost" size="icon-xs" title="Actualiser Git" aria-label="Actualiser Git" disabled={gitBusy} onClick={() => void api<Git>(`/projects/${projectId}/git`).then(setGit).catch((error) => setGitError(error.message))}><RefreshCw /></Button>
                      <DropdownMenu.Root modal={false}>
                        <DropdownMenu.Trigger asChild><Button variant="ghost" size="icon-xs" title="Plus d’actions Git" aria-label="Plus d’actions Git"><MoreHorizontal /></Button></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content className="project-action-menu source-git-menu" side="left" align="start" sideOffset={6} collisionPadding={8}>
                          <DropdownMenu.Label className="source-git-menu-label">Dépôt distant</DropdownMenu.Label>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || busy} onSelect={() => void gitAction("git-pull", {})}><ArrowDownToLine /> Tirer (pull)</DropdownMenu.Item>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || busy} onSelect={() => void gitAction("git-push", {})}><CloudUpload /> Envoyer (push)</DropdownMenu.Item>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || busy} onSelect={() => void gitAction("git-fetch", {})}><CloudDownload /> Récupérer (fetch)</DropdownMenu.Item>
                          <DropdownMenu.Separator className="source-git-menu-separator" />
                          <DropdownMenu.Label className="source-git-menu-label">Branche et changements</DropdownMenu.Label>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || busy} onSelect={() => { const name = window.prompt("Nom de la nouvelle branche :"); if (name) void gitAction("git-branch", { name, create: true }); }}><GitBranch /> Créer une branche</DropdownMenu.Item>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || !unstagedChanges.length} onSelect={() => void gitAction("git-stage-all", {})}><Plus /> Indexer tous les changements</DropdownMenu.Item>
                          <DropdownMenu.Item className="project-action-menu-item" disabled={gitBusy || !stagedChanges.length} onSelect={() => void gitAction("git-unstage-all", {})}><Minus /> Désindexer tous les changements</DropdownMenu.Item>
                        </DropdownMenu.Content></DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    <div className="git-branch-row">
                      <Select value={git.branch || undefined} onValueChange={(name) => void gitAction("git-branch", { name })} disabled={gitBusy || busy}>
                        <SelectTrigger aria-label="Branche Git"><SelectValue placeholder="Branche" /></SelectTrigger>
                        <SelectContent><SelectGroup>{git.branches?.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectGroup></SelectContent>
                      </Select>
                    </div>
                    <div className="source-commit-input">
                      <textarea placeholder="Message de validation (⌘Entrée pour valider)" aria-label="Message de commit" value={commitMessage} maxLength={1000} onChange={(event) => { commitMessageRef.current = event.target.value; setCommitMessage(event.target.value); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && commitMessage.trim() && stagedChanges.length && !gitConflicts && !gitBusy && !generatingCommit) { event.preventDefault(); void gitAction("git-commit", { message: commitMessage }); } }} />
                      <Button variant="ghost" size="icon-xs" title={stagedChanges.length ? "Générer un message à partir des changements indexés" : "Générer un message à partir des changements non indexés"} aria-label="Générer un message de validation" disabled={gitBusy || generatingCommit || (!stagedChanges.length && !unstagedChanges.length)} onClick={() => void generateCommitMessage()}>{generatingCommit ? <LoaderCircle className="animate-spin" /> : <Sparkles />}</Button>
                    </div>
                    {suggestedCommit && <div className="source-generated"><span>Message généré disponible</span><button type="button" onClick={() => { setCommitMessage(suggestedCommit); setSuggestedCommit(""); }}>Utiliser</button></div>}
                    {gitError && <div className="source-control-error" role="alert">{gitError}</div>}
                    {gitConflicts && <div className="source-control-error" role="alert">Résolvez les conflits avant de créer un commit.</div>}
                    <Button className="source-commit-button" size="sm" disabled={gitBusy || generatingCommit || !commitMessage.trim() || !stagedChanges.length || gitConflicts} onClick={() => void gitAction("git-commit", { message: commitMessage })}>Validation <Check /></Button>
                    <div className="source-changes-list" role="region" aria-label="Liste des changements Git" tabIndex={0}>
                    <section className="source-changes-group" aria-label="Changements indexés">
                      <div className="source-group-heading"><ChevronDown /><strong>Changements indexés</strong><span>{stagedChanges.length}</span><Button variant="ghost" size="icon-xs" title="Désindexer tous les changements" aria-label="Désindexer tous les changements" disabled={gitBusy || !stagedChanges.length} onClick={() => void gitAction("git-unstage-all", {})}><Minus /></Button></div>
                      {stagedChanges.map((change) => gitChangeRow(change, true))}
                    </section>
                    <section className="source-changes-group" aria-label="Changements">
                      <div className="source-group-heading"><ChevronDown /><strong>Changements</strong><span>{unstagedChanges.length}</span><Button variant="ghost" size="icon-xs" title="Indexer tous les changements" aria-label="Indexer tous les changements" disabled={gitBusy || !unstagedChanges.length} onClick={() => void gitAction("git-stage-all", {})}><Plus /></Button></div>
                      {unstagedChanges.map((change) => gitChangeRow(change, false))}
                      {!unstagedChanges.length && !stagedChanges.length && <p className="inspector-hint">Aucun changement local.</p>}
                    </section>
                    </div>
                    <GitHistory commits={git.history ?? []} branch={git.branch} onOpen={(commit) => void openCommit(commit)} />
                    <div className="section-label">GITHUB</div>
                    <p className="inspector-hint">
                      {git.github?.connected
                        ? "Connecté avec GitHub CLI"
                        : "Connexion GitHub : lancez gh auth login dans le terminal"}
                    </p>
                    {git.github?.url && (
                      <a
                        className="git-link"
                        href={git.github.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ouvrir le dépôt GitHub ↗
                      </a>
                    )}
                    {git.github?.connected && git.github.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void api<{
                            prs: {
                              number: number;
                              title: string;
                              url: string | null;
                              branch: string;
                            }[];
                          }>(`/projects/${projectId}/github-prs`)
                            .then((result) => setPullRequests(result.prs))
                            .catch(report)
                        }
                      >
                        Charger les pull requests
                      </Button>
                    )}
                    {pullRequests && (
                      <div className="git-history">
                        {pullRequests.length ? (
                          pullRequests.map((pr) => (
                            <div key={pr.number}>
                              {pr.url ? (
                                <a
                                  className="git-link"
                                  href={pr.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  #{pr.number} {pr.title} ↗
                                </a>
                              ) : (
                                `#${pr.number} ${pr.title}`
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="inspector-hint">
                            Aucune pull request ouverte.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {git && !git.available && (
                  <p className="inspector-hint">
                    Ce dossier n’a pas de dépôt Git.
                  </p>
                )}
                {git?.diff && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openGitDiff(git.diff)}
                  >
                    <GitBranch data-icon="inline-start" />
                    Ouvrir le diff
                  </Button>
                )}
              </section>
            </TabsContent>
            <TabsContent value="activity">
              <section className="inspector-section">
                <div className="section-label">
                  JOURNAL D’EXÉCUTION
                  <Badge variant="secondary">{events.length}</Badge>
                </div>
                <ToolTrace events={events} />
                {!events.length && (
                  <p className="inspector-hint">
                    Les actions du Harness apparaîtront ici pendant l’exécution.
                  </p>
                )}
                <div className="event-log">
                  {events
                    .filter((e) => !e.type.startsWith("message."))
                    .slice(-35)
                    .reverse()
                    .map((e) => (
                      <div className="event-entry" key={e.id}>
                        <span>
                          {new Date(e.createdAt).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span>{e.type}</span>
                      </div>
                    ))}
                </div>
              </section>
            </TabsContent>
          </Tabs>
          <div className="inspector-bottom">
            <ShieldCheck />
            <span>SQLite local · permissions ponctuelles</span>
            {page !== "chat" && awakeControl}
          </div>
        </aside>
      )}

      <Dialog open={palette} onOpenChange={setPalette}>
        <DialogContent className="palette-dialog">
          <DialogHeader className="sr-only">
            <DialogTitle>
              Rechercher une conversation ou une commande
            </DialogTitle>
            <DialogDescription>Navigation rapide dans Omni.</DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Rechercher une conversation, une action…" />
            <CommandList>
              <CommandEmpty>Aucun résultat.</CommandEmpty>
              <CommandGroup heading="Actions">
                <CommandItem onSelect={newSession}>
                  <Plus />
                  Nouvelle session<CommandShortcut>⇧ ⌘ O</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setOpenProject(true);
                    setPalette(false);
                  }}
                >
                  <FolderOpen />
                  Ouvrir un projet
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setSettings(true);
                    setPalette(false);
                  }}
                >
                  <Plug />
                  Connexions MCP
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openNewTerminalTab();
                    setPalette(false);
                  }}
                >
                  <Terminal />
                  Nouveau terminal<CommandShortcut>⌘ T</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openNewBrowserTab();
                    setPalette(false);
                  }}
                >
                  <Globe />
                  Nouvel onglet de navigateur<CommandShortcut>⌘⇧B</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openNewMarkdownTab();
                    setPalette(false);
                  }}
                >
                  <FilePlus />
                  Nouveau Markdown<CommandShortcut>⌘⇧M</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openMobileEmulator();
                    setPalette(false);
                  }}
                >
                  <Smartphone />
                  Nouvel émulateur mobile<CommandShortcut>⌘⌥⇧E</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openNewBrowserTab("http://localhost:5173");
                    setPalette(false);
                  }}
                >
                  <Globe />
                  Aperçu local Vite (localhost:5173)
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    openNewBrowserTab("http://localhost:3000");
                    setPalette(false);
                  }}
                >
                  <Globe />
                  Aperçu local React / Next (localhost:3000)
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Conversations">
                {sessions.map((s) => (
                  <CommandItem
                    key={s.id}
                    onSelect={() => void chooseSession(s.id).catch(report)}
                  >
                    <MessageSquare />
                    {s.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(renamingSession)} onOpenChange={(open) => { if (!open && !sessionBusy) { setRenamingSession(null); setSessionError(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renommer la conversation</DialogTitle><DialogDescription>Choisissez un titre pour retrouver cette conversation.</DialogDescription></DialogHeader>
          <Field><FieldLabel htmlFor="session-title">Titre</FieldLabel><Input id="session-title" value={sessionTitle} maxLength={120} onChange={(event) => setSessionTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameSession(); }} /></Field>
          {sessionError && <Alert variant="destructive"><AlertTitle>Modification impossible</AlertTitle><AlertDescription>{sessionError}</AlertDescription></Alert>}
          <DialogFooter><Button disabled={sessionBusy || !sessionTitle.trim()} onClick={() => void renameSession()}>Enregistrer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(workspaceProject)} onOpenChange={(open) => {
        if (!open && !projectBusy) { setWorkspaceProject(null); setProjectError(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un espace de travail</DialogTitle>
            <DialogDescription>Créez un worktree Git et une branche depuis le commit actuel de {workspaceProject?.name}.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-branch">Nouvelle branche</FieldLabel>
              <Input id="workspace-branch" placeholder="feature/ma-tache" value={workspaceBranch} onChange={(event) => setWorkspaceBranch(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-path">Dossier de l’espace</FieldLabel>
              <Input id="workspace-path" placeholder={`${workspaceProject?.rootPath ?? "/chemin/projet"}-ma-tache`} value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} />
            </Field>
          </FieldGroup>
          {projectError && <Alert variant="destructive"><AlertTitle>Création impossible</AlertTitle><AlertDescription>{projectError}</AlertDescription></Alert>}
          <DialogFooter>
            <Button disabled={projectBusy || !workspacePath.trim() || !workspaceBranch.trim()} onClick={() => void createWorktree()}>Créer l’espace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={openProject} onOpenChange={setOpenProject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ouvrir un projet</DialogTitle>
            <DialogDescription>
              Ajoutez un dossier local existant à votre espace Omni.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Nom (facultatif)</FieldLabel>
              <Input
                id="project-name"
                placeholder="Nom du projet"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-path">Chemin du dossier</FieldLabel>
              <Input
                id="project-path"
                placeholder="/Users/vous/Github/mon-projet"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addProject()}
              />
            </Field>
          </FieldGroup>
          {projectError && (
            <Alert variant="destructive">
              <AlertTitle>Projet non ajouté</AlertTitle>
              <AlertDescription>{projectError}</AlertDescription>
            </Alert>
          )}
          {(state?.archivedProjects?.length ?? 0) > 0 && (
            <div className="archived-projects">
              <strong>Projets retirés</strong>
              {state?.archivedProjects.map((project) => (
                <div key={project.id} className="archived-project-row">
                  <span>
                    {project.name}
                    <small>{project.rootPath}</small>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={projectBusy}
                    onClick={() => void restoreProject(project)}
                  >
                    Restaurer
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!projectPath.trim() || projectBusy}
              onClick={() => void addProject()}
            >
              <FolderOpen data-icon="inline-start" />
              Ouvrir le projet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editingProject)}
        onOpenChange={(open) => {
          if (!open && !projectBusy) {
            setEditingProject(null);
            setProjectError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le projet</DialogTitle>
            <DialogDescription>
              Renommez le projet ou associez-le à un dossier existant. Ses
              conversations restent liées au projet.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-project-name">Nom du projet</FieldLabel>
              <Input
                id="edit-project-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-project-path">
                Chemin du dossier
              </FieldLabel>
              <Input
                id="edit-project-path"
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
              />
            </Field>
          </FieldGroup>
          {projectError && (
            <Alert variant="destructive">
              <AlertTitle>Modification impossible</AlertTitle>
              <AlertDescription>{projectError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              disabled={projectBusy || !editName.trim() || !editPath.trim()}
              onClick={() => void saveProject()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Connexions et outils</DialogTitle>
            <DialogDescription>
              Les runtimes officiels utilisent vos connexions locales. Omni ne
              copie pas leurs jetons.
            </DialogDescription>
          </DialogHeader>
          <div className="settings-body">
            <h3>Authentification des Harness</h3>
            <p className="inspector-hint">
              Dans votre terminal : <code>omni auth login codex</code> ou{" "}
              <code>omni auth login claude</code>. Pour OpenCode, utilisez sa
              connexion officielle.
            </p>
            <Separator />
            <h3>Serveurs MCP configurés</h3>
            {state?.mcpServers.map((s) => (
              <div className="mcp-row" key={s.name}>
                <Plug />
                <strong>{s.name}</strong>
                <Badge variant="outline">{s.transport}</Badge>
              </div>
            ))}
            <Separator />
            <h3>Ajouter un serveur stdio</h3>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mcp-name">Nom</FieldLabel>
                <Input
                  id="mcp-name"
                  placeholder="mon-serveur"
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-command">Exécutable</FieldLabel>
                <Input
                  id="mcp-command"
                  placeholder="npx"
                  value={mcpCommand}
                  onChange={(e) => setMcpCommand(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-args">
                  Arguments (JSON, sans secret)
                </FieldLabel>
                <Input
                  id="mcp-args"
                  placeholder={'["-y", "mon-package-mcp"]'}
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <Button
              disabled={!mcpName || !mcpCommand}
              onClick={() => void addMcp()}
            >
              <Plus data-icon="inline-start" />
              Ajouter le serveur
            </Button>
            <p className="inspector-hint">
              Le serveur démarrera uniquement après votre approbation. Pour HTTP
              ou les secrets référencés par environnement, utilisez{" "}
              <code>omni mcp add --help</code> selon l’aide CLI.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      {!state && error && (
        <div className="startup-error">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Le runtime n’est pas disponible</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void refresh().catch(report)}>
                Réessayer
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
    </div>
  );
}
