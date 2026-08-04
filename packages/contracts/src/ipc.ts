import type {
  AppSettings,
  Artifact,
  ArtifactKind,
  ArtifactVersion,
  AutonomyLevel,
  AutonomyProfile,
  BackgroundJob,
  Connector,
  ConnectorGrant,
  ConnectorInvocation,
  ContextAssetSummary,
  ContextItemInput,
  Conversation,
  Effort,
  Message,
  MemoryRecord,
  ModelPreference,
  ModelSelection,
  PlanSpec,
  Project,
  Run,
  RunDetail,
  RunMode,
  SessionKind,
  ContextCheckpoint,
  Turn,
  TurnPath,
  TimelineItem,
  SessionBranch,
} from "./domain.js";
import type { EventPage, RunEvent } from "./events.js";
import type {
  ModelTelemetry,
  ProviderConnectionSummary,
  ProviderSummary,
  RoutingDecision,
} from "./provider.js";

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
  autonomyProfiles?: AutonomyProfile[];
  activeJobs?: BackgroundJob[];
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  runs: Run[];
  branches?: SessionBranch[];
  activeBranchId?: string | null;
}

export interface SessionTimelinePage {
  sessionId: string;
  activeBranchId: string | null;
  branches: SessionBranch[];
  items: TimelineItem[];
  cursor: number;
  total: number;
  previousCursor: number | null;
  nextCursor: number | null;
}

export interface CreateProjectInput {
  name: string;
  directory: string;
}

export interface UpdateProjectInput {
  projectId: string;
  name: string;
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

export interface UpdateConversationInput {
  conversationId: string;
  title: string;
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
  contextItems: ContextItemInput[];
  modelPreference?: ModelPreference;
  /** Additive Maestro Next fields; legacy callers may omit them. */
  strategyOverride?: TurnPath;
  branchId?: string;
}

export type SendTurnInput = SendMessageInput;

export interface EditTurnInput extends SendTurnInput {
  turnId: string;
}

export interface RetryTurnInput {
  turnId: string;
  strategyOverride?: TurnPath;
}

export interface ForkAtTurnInput {
  sessionId: string;
  turnId: string;
  name?: string;
}

export interface CreateArtifactInput {
  projectId: string;
  sessionId?: string;
  branchId?: string;
  turnId?: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  mimeType?: string;
  content: string;
  pinned?: boolean;
  createdBy?: ArtifactVersion["createdBy"];
}

export interface UpdateArtifactInput {
  artifactId: string;
  content: string;
  title?: string;
  language?: string | null;
  pinned?: boolean;
  createdBy?: ArtifactVersion["createdBy"];
  sourceEventId?: string;
}

export interface ArtifactDetail {
  artifact: Artifact;
  versions: ArtifactVersion[];
}

export interface MemoryFilter {
  projectId?: string;
  scope?: "project" | "personal";
  state?: MemoryRecord["state"];
  query?: string;
}

export interface UpdateMemoryInput {
  memoryId: string;
  content?: string;
  confidence?: number;
  expiresAt?: string | null;
}

export interface SaveMemoryInput {
  projectId: string;
  sessionId: string;
  turnId?: string | null;
  messageId?: string | null;
  kind?: MemoryRecord["kind"];
  content: string;
}

export interface ConfigureConnectorInput {
  projectId: string;
  connectorId?: string;
  name: string;
  kind: Connector["kind"];
  enabled: boolean;
  config: Record<string, unknown>;
  /** Written directly to the encrypted vault and never persisted in connector config. */
  credential?: string | null;
}

export interface ConnectorGrantInput {
  connectorId: string;
  capability: ConnectorGrant["capability"];
  scope?: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface GlobalSearchResult {
  id: string;
  projectId: string;
  type: "conversation" | "message" | "artifact" | "memory" | "source";
  title: string;
  excerpt: string;
  sessionId: string | null;
  score: number;
  updatedAt: string;
}

export interface SteerJobInput {
  jobId: string;
  action: "pause" | "resume" | "cancel" | "prioritize";
  message?: string;
}

export interface StructuredQuestionAnswer {
  questionId: string;
  selectedOption?: string;
  freeText?: string;
}

export interface AnswerQuestionsInput {
  runId: string;
  answers: StructuredQuestionAnswer[];
}

export interface SteerTurnInput {
  runId: string;
  content: string;
}

export interface SwitchModelInput {
  runId: string;
  selection: ModelSelection;
  timing: "next_checkpoint" | "immediate";
  noFallback?: boolean;
}

export interface GranularApprovalInput {
  runId: string;
  planVersion: number;
  allowedTools?: string[];
  allowedCommands?: string[];
  writablePaths?: string[];
  network?: "denied" | "web" | "full";
}

export interface CompactTurnInput {
  conversationId: string;
  runId?: string;
  force?: boolean;
}

export interface ForkConversationInput {
  conversationId: string;
  checkpointId?: string;
  title?: string;
}

export interface TurnStatusInspection {
  turn: Turn | null;
  checkpoint: ContextCheckpoint | null;
  route: RoutingDecision | null;
  telemetry: ModelTelemetry[];
  pendingModel: ModelSelection | null;
}

export interface SearchWorkspaceContextInput {
  projectId: string;
  query: string;
  limit?: number;
}

export interface WorkspaceContextCandidate {
  id: string;
  projectId: string;
  workspaceRootId: string;
  rootName: string;
  relativePath: string;
  name: string;
  kind: "file" | "directory";
  mimeType: string | null;
  size: number | null;
}

export interface PrepareWorkspaceContextInput {
  conversationId: string;
  candidates: Array<{
    workspaceRootId: string;
    relativePath: string;
    kind: "file" | "directory";
  }>;
}

export interface StageRecordedAudioInput {
  conversationId: string;
  data: Uint8Array;
  mimeType: string;
  durationMs?: number;
}

export interface ContextProcessingEvent {
  conversationId: string;
  asset: ContextAssetSummary;
  stage:
    | "staging"
    | "hashing"
    | "extracting"
    | "transcoding"
    | "transcribing"
    | "indexing"
    | "ready"
    | "error";
  progress: number | null;
  message: string;
}

export interface LocalModelPackageState {
  id: "whisper-small-multilingual-q4";
  version: string;
  status: "not_downloaded" | "downloading" | "ready" | "error";
  progress: number | null;
  sizeBytes: number;
  licenses: string[];
  message: string;
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
  selectContextFiles(conversationId: string): Promise<ContextAssetSummary[]>;
  selectContextFolder(conversationId: string): Promise<ContextAssetSummary[]>;
  stageDroppedFiles(conversationId: string, files: File[]): Promise<ContextAssetSummary[]>;
  stageClipboard(conversationId: string): Promise<ContextAssetSummary[]>;
  stageRecordedAudio(input: StageRecordedAudioInput): Promise<ContextAssetSummary>;
  searchWorkspaceContext(input: SearchWorkspaceContextInput): Promise<WorkspaceContextCandidate[]>;
  prepareWorkspaceContext(input: PrepareWorkspaceContextInput): Promise<ContextAssetSummary[]>;
  listContextAssets(conversationId: string): Promise<ContextAssetSummary[]>;
  removeContextAsset(conversationId: string, assetId: string): Promise<void>;
  getLocalModelState(): Promise<LocalModelPackageState>;
  downloadLocalModel(): Promise<LocalModelPackageState>;
  cancelLocalModelDownload(): Promise<LocalModelPackageState>;
  removeLocalModel(): Promise<LocalModelPackageState>;
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  selectProject(projectId: string): Promise<BootstrapPayload>;
  updateProject(input: UpdateProjectInput): Promise<Project>;
  deleteProject(projectId: string): Promise<BootstrapPayload>;
  addProjectRoot(projectId: string, directory: string): Promise<Project>;
  removeProjectRoot(projectId: string, workspaceRootId: string): Promise<Project>;
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  listConversations(projectId: string, limit?: number): Promise<Conversation[]>;
  getConversation(conversationId: string): Promise<ConversationDetail>;
  updateConversation(input: UpdateConversationInput): Promise<Conversation>;
  deleteConversation(conversationId: string): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  getSessionTimeline(
    sessionId: string,
    cursor?: number,
    limit?: number,
    branchId?: string,
  ): Promise<SessionTimelinePage>;
  sendTurn(input: SendTurnInput): Promise<SendMessageResult>;
  editTurn(input: EditTurnInput): Promise<SendMessageResult>;
  retryTurn(input: RetryTurnInput): Promise<SendMessageResult>;
  forkAtTurn(input: ForkAtTurnInput): Promise<SessionBranch>;
  switchBranch(sessionId: string, branchId: string): Promise<SessionTimelinePage>;
  listArtifacts(projectId: string, sessionId?: string): Promise<Artifact[]>;
  openArtifact(artifactId: string): Promise<ArtifactDetail>;
  createArtifact(input: CreateArtifactInput): Promise<ArtifactDetail>;
  updateArtifact(input: UpdateArtifactInput): Promise<ArtifactDetail>;
  exportArtifact(artifactId: string, version?: number): Promise<string | null>;
  listMemories(filter: MemoryFilter): Promise<MemoryRecord[]>;
  saveMemory(input: SaveMemoryInput): Promise<MemoryRecord>;
  acceptMemory(memoryId: string): Promise<MemoryRecord>;
  updateMemory(input: UpdateMemoryInput): Promise<MemoryRecord>;
  forgetMemory(memoryId: string): Promise<MemoryRecord>;
  listConnectors(projectId: string): Promise<Connector[]>;
  configureConnector(input: ConfigureConnectorInput): Promise<Connector>;
  listConnectorGrants(connectorId: string): Promise<ConnectorGrant[]>;
  grantConnector(input: ConnectorGrantInput): Promise<ConnectorGrant>;
  revokeConnector(connectorId: string, grantId: string): Promise<ConnectorGrant>;
  listConnectorInvocations(connectorId: string): Promise<ConnectorInvocation[]>;
  setProjectAutonomy(projectId: string, level: AutonomyLevel): Promise<AutonomyProfile>;
  getProjectAutonomy(projectId: string): Promise<AutonomyProfile>;
  listJobs(projectId: string, activeOnly?: boolean): Promise<BackgroundJob[]>;
  getJob(jobId: string): Promise<BackgroundJob>;
  steerJob(input: SteerJobInput): Promise<BackgroundJob>;
  globalSearch(projectId: string, query: string, limit?: number): Promise<GlobalSearchResult[]>;
  openExternalUrl(url: string): Promise<void>;
  getRun(runId: string): Promise<RunDetail>;
  getRunEvents(runId: string, afterSequence?: number, limit?: number): Promise<EventPage>;
  approveRun(runId: string, planVersion: number): Promise<RunDetail>;
  approveRunGranular(input: GranularApprovalInput): Promise<RunDetail>;
  reviseRun(runId: string, planVersion: number, comment: string): Promise<PlanSpec>;
  cancelRun(runId: string): Promise<RunDetail>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  answerQuestions(input: AnswerQuestionsInput): Promise<RunDetail>;
  switchModel(input: SwitchModelInput): Promise<TurnStatusInspection>;
  retryRun(runId: string): Promise<RunDetail>;
  replanRun(runId: string, reason: string): Promise<PlanSpec>;
  compactContext(input: CompactTurnInput): Promise<ContextCheckpoint>;
  inspectRoute(runId: string): Promise<TurnStatusInspection>;
  forkConversation(input: ForkConversationInput): Promise<Conversation>;
  refreshProviders(): Promise<ProviderSummary[]>;
  configureProvider(input: ConfigureProviderInput): Promise<ProviderSummary[]>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]>;
  updateProviderConnection(
    input: UpdateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]>;
  reorderProviderConnections(connectionIds: string[]): Promise<ProviderConnectionSummary[]>;
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
  onContextProcessing(listener: (event: ContextProcessingEvent) => void): () => void;
  onLocalModelState(listener: (state: LocalModelPackageState) => void): () => void;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}
