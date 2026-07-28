import type {
  AppSettings,
  Conversation,
  Effort,
  Message,
  PlanSpec,
  Project,
  Run,
  RunDetail,
  RunMode,
  SessionKind,
} from "./domain.js";
import type { EventPage, RunEvent } from "./events.js";
import type { ProviderConnectionSummary, ProviderSummary } from "./provider.js";

export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  message: string;
  checkedAt: string | null;
  installStrategy: "automatic" | "system-installer";
}

export interface VaultStatus {
  backend: "safe-storage" | "password-vault";
  secure: boolean;
  locked: boolean;
  hasPassword: boolean;
  message: string;
}

export interface BootstrapPayload {
  app: {
    name: string;
    version: string;
    platform: NodeJS.Platform;
    development: boolean;
  };
  projects: Project[];
  activeProjectId: string | null;
  recentConversations: Conversation[];
  activeRuns: Run[];
  providers: ProviderSummary[];
  providerConnections: ProviderConnectionSummary[];
  settings: AppSettings;
  vault: VaultStatus;
  update: UpdateState;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  runs: Run[];
}

export interface CreateProjectInput {
  name: string;
  directory: string;
}

export interface CreateConversationInput {
  projectId: string;
  title?: string;
  mode: RunMode;
  sessionKind: SessionKind;
  providerId?: string;
  providerConnectionId?: string;
  modelId?: string;
  workspaceRootId: string;
}

export interface SendMessageInput {
  conversationId: string;
  content: string;
  mode: RunMode;
  sessionKind: SessionKind;
  providerId: string;
  providerConnectionId?: string;
  modelId: string;
  effort: Effort;
  workspaceRootId: string;
  attachmentPaths: string[];
}

export interface SendMessageResult {
  conversation: Conversation;
  userMessage: Message;
  assistantMessage: Message;
  run: Run | null;
}

export interface ConfigureProviderInput {
  providerId: string;
  values: Record<string, string | number | boolean | null>;
}

export interface CreateProviderConnectionInput {
  providerId: "codex" | "claude-code";
  name: string;
  priority?: number;
  concurrencyLimit?: number;
}

export interface UpdateProviderConnectionInput {
  connectionId: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  concurrencyLimit?: number;
}

export interface TerminalSessionDto {
  id: string;
  kind: "workspace" | "provider-login";
  projectId: string | null;
  workspaceRootId: string | null;
  providerConnectionId: string | null;
  cwd: string;
  shell: string;
  label: string;
  createdAt: string;
}

export interface TerminalEvent {
  sessionId: string;
  type: "data" | "exit";
  data?: string;
  exitCode?: number;
  signal?: number;
}

export interface MaestroDesktopApi {
  bootstrap(): Promise<BootstrapPayload>;
  selectDirectory(): Promise<string | null>;
  selectAttachments(): Promise<string[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  selectProject(projectId: string): Promise<BootstrapPayload>;
  addProjectRoot(projectId: string, directory: string): Promise<Project>;
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  listConversations(projectId: string, limit?: number): Promise<Conversation[]>;
  getConversation(conversationId: string): Promise<ConversationDetail>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  getRun(runId: string): Promise<RunDetail>;
  getRunEvents(runId: string, afterSequence?: number, limit?: number): Promise<EventPage>;
  approveRun(runId: string, planVersion: number): Promise<RunDetail>;
  reviseRun(runId: string, planVersion: number, comment: string): Promise<PlanSpec>;
  cancelRun(runId: string): Promise<RunDetail>;
  refreshProviders(): Promise<ProviderSummary[]>;
  configureProvider(input: ConfigureProviderInput): Promise<ProviderSummary[]>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]>;
  updateProviderConnection(
    input: UpdateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]>;
  deleteProviderConnection(connectionId: string): Promise<ProviderConnectionSummary[]>;
  loginProviderConnection(connectionId: string): Promise<TerminalSessionDto>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  unlockVault(password: string): Promise<VaultStatus>;
  lockVault(): Promise<VaultStatus>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  createTerminal(projectId: string, workspaceRootId: string): Promise<TerminalSessionDto>;
  writeTerminal(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  killTerminal(sessionId: string): Promise<void>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}
