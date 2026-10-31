export type Project = { id: string; name: string; rootPath: string };
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  title: string;
  projectId: string;
  modelId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};
export type OmniEvent = {
  id: string;
  type: string;
  conversationId?: string;
  createdAt: string;
  payload: Record<string, any>;
};
export type Approval = {
  id: string;
  runId: string;
  conversationId: string;
  harnessId: string;
  request: Record<string, any>;
  expiresAt: string;
};
export type Run = { id: string; conversationId: string; harnessId: string; projectId?: string };
export type WorkspaceState = {
  version: string;
  defaultProjectId: string;
  projects: Project[];
  archivedProjects: Project[];
  harnesses: {
    id: string;
    name: string;
    description: string;
    enabled?: boolean;
  }[];
  installedAgents?: { antigravity?: boolean };
  models: { id: string; providerId: string }[];
  providers: { id: string; authStatus: string; enabled?: boolean }[];
  mcpServers: {
    name: string;
    transport: string;
    command?: string;
    args?: string[];
    toolCount: number;
  }[];
  runs: Run[];
  approvals: Approval[];
  awake: {
    mode: "on" | "auto" | "off";
    active: boolean;
    workingAgents: number;
    supported: boolean;
    error: string | null;
  };
};
export async function api<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "content-type": "application/json", "x-omni-request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "La requête a échoué.");
  return result;
}
