import path from "node:path";
import { realpath } from "node:fs/promises";
import { app, clipboard, dialog, nativeTheme } from "electron";
import {
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  type AppSettings,
  type BootstrapPayload,
  type ConfigureProviderInput,
  type ContextAssetSummary,
  type ContextProcessingEvent,
  type CreateProviderConnectionInput,
  type Conversation,
  type ConversationDetail,
  type CreateConversationInput,
  type CreateProjectInput,
  type EventPage,
  type PlanSpec,
  type Project,
  type LocalModelPackageState,
  type ProviderSummary,
  type ProviderConnectionSummary,
  type RunDetail,
  type RunEvent,
  type RunState,
  type SendMessageInput,
  type SendMessageResult,
  type PrepareWorkspaceContextInput,
  type SearchWorkspaceContextInput,
  type StageRecordedAudioInput,
  type WorkspaceContextCandidate,
  type TerminalEvent,
  type TerminalSessionDto,
  type UpdateConversationInput,
  type UpdateProjectInput,
  type UpdateProviderConnectionInput,
  type UpdateState,
  type VaultStatus,
} from "@maestro/contracts";
import { MaestroRepository } from "@maestro/database";
import { canonicalizeDirectory, MaestroError } from "@maestro/core";
import { ProviderRegistry } from "../providers/registry.js";
import { ProcessSupervisor } from "./process-supervisor.js";
import { VaultService } from "./vault.js";
import { OrchestrationService } from "./orchestration.js";
import { TerminalService } from "./terminal.js";
import { UpdateService } from "./update-service.js";
import { ContextService } from "./context-service.js";

interface Grant {
  path: string;
  expiresAt: number;
}

const ACTIVE_RUN_STATES = [
  "analyzing",
  "planning",
  "awaiting_approval",
  "queued",
  "running",
  "validating",
  "integrating",
] as const satisfies readonly RunState[];

export class ApplicationService {
  readonly repository: MaestroRepository;
  readonly supervisor: ProcessSupervisor;
  readonly vault: VaultService;
  readonly providers: ProviderRegistry;
  readonly orchestration: OrchestrationService;
  readonly context: ContextService;
  readonly terminal: TerminalService;
  readonly updates: UpdateService;
  readonly #directoryGrants = new Map<string, Grant>();
  #settingsUpdateTail: Promise<void> = Promise.resolve();
  #runEventHandler: (event: RunEvent) => void = () => {};
  #terminalEventHandler: (event: TerminalEvent) => void = () => {};
  #updateEventHandler: (state: UpdateState) => void = () => {};
  #contextEventHandler: (event: ContextProcessingEvent) => void = () => {};
  #localModelEventHandler: (state: LocalModelPackageState) => void = () => {};

  constructor(userDataDirectory = app.getPath("userData")) {
    this.repository = new MaestroRepository(path.join(userDataDirectory, "maestro.db"));
    this.supervisor = new ProcessSupervisor();
    this.vault = new VaultService(this.repository);
    this.providers = new ProviderRegistry({
      repository: this.repository,
      vault: this.vault,
      supervisor: this.supervisor,
      userDataDirectory,
    });
    this.context = new ContextService({
      repository: this.repository,
      userDataDirectory,
      emitContext: (event) => this.#contextEventHandler(event),
      emitModel: (state) => this.#localModelEventHandler(state),
    });
    this.orchestration = new OrchestrationService({
      repository: this.repository,
      providers: this.providers,
      supervisor: this.supervisor,
      userDataDirectory,
      context: this.context,
      emit: (event) => this.#runEventHandler(event),
    });
    this.terminal = new TerminalService(this.repository, (event) =>
      this.#terminalEventHandler(event),
    );
    this.updates = new UpdateService((state) => this.#updateEventHandler(state));
  }

  setEventHandlers(input: {
    run: (event: RunEvent) => void;
    terminal: (event: TerminalEvent) => void;
    update: (state: UpdateState) => void;
    context: (event: ContextProcessingEvent) => void;
    localModel: (state: LocalModelPackageState) => void;
  }): void {
    this.#runEventHandler = input.run;
    this.#terminalEventHandler = input.terminal;
    this.#updateEventHandler = input.update;
    this.#contextEventHandler = input.context;
    this.#localModelEventHandler = input.localModel;
  }

  async initialize(): Promise<void> {
    this.repository.pruneConversationDrafts();
    await this.context.initialize();
    const settings = await this.repository.getSettings();
    nativeTheme.themeSource = settings.theme;
    this.updates.configure(settings);
    await this.providers.refresh();
    const activeProjectId = await this.repository.getActiveProjectId();
    if (activeProjectId) this.context.warmProject(activeProjectId);
    const e2eWorkspace = process.env.MAESTRO_E2E_WORKSPACE;
    if (!app.isPackaged && e2eWorkspace) {
      this.#grant(this.#directoryGrants, await canonicalizeDirectory(e2eWorkspace));
    }
    await this.orchestration.recover();
  }

  async bootstrap(projectId?: string | null): Promise<BootstrapPayload> {
    const projects = await this.repository.listProjects();
    let activeProjectId = projectId ?? (await this.repository.getActiveProjectId());
    if (activeProjectId && !projects.some((project) => project.id === activeProjectId))
      activeProjectId = null;
    activeProjectId ??= projects[0]?.id ?? null;
    const [recentConversations, activeRuns, settings, vault] = await Promise.all([
      activeProjectId ? this.repository.listConversations(activeProjectId, 5) : Promise.resolve([]),
      activeProjectId
        ? this.repository.listRuns({
            projectId: activeProjectId,
            states: [...ACTIVE_RUN_STATES],
          })
        : Promise.resolve([]),
      this.repository.getSettings(),
      this.vault.status(),
    ]);
    return {
      app: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        development: !app.isPackaged,
      },
      projects,
      activeProjectId,
      recentConversations,
      activeRuns,
      providers: this.providers.listCached(),
      providerConnections: this.providers.listConnectionsCached(),
      settings,
      vault,
      update: this.updates.state,
    };
  }

  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: "Selecionar pasta do workspace",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Selecionar pasta",
    });
    const selected = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selected) this.#grant(this.#directoryGrants, await realpath(selected));
    return selected;
  }

  async selectContextFiles(conversationId: string): Promise<ContextAssetSummary[]> {
    await this.repository.getConversation(conversationId);
    const result = await dialog.showOpenDialog({
      title: "Adicionar anexos",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Arquivos suportados",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "tif",
            "tiff",
            "avif",
            "pdf",
            "txt",
            "md",
            "markdown",
            "json",
            "jsonl",
            "yaml",
            "yml",
            "csv",
            "tsv",
            "log",
            "docx",
            "xlsx",
            "pptx",
            "odt",
            "ods",
            "odp",
            "rtf",
            "epub",
            "mp3",
            "wav",
            "m4a",
            "aac",
            "ogg",
            "oga",
            "flac",
            "opus",
            "webm",
            "mp4",
            "mov",
            "mkv",
            "avi",
            "m4v",
            "js",
            "jsx",
            "ts",
            "tsx",
            "py",
            "rb",
            "go",
            "rs",
            "java",
            "kt",
            "swift",
            "c",
            "h",
            "cpp",
            "hpp",
            "css",
            "scss",
            "sql",
            "sh",
            "toml",
            "ini",
            "xml",
            "html",
            "htm",
          ],
        },
        { name: "Todos os arquivos", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    return this.context.stageFiles(conversationId, result.filePaths);
  }

  async selectContextFolder(conversationId: string): Promise<ContextAssetSummary[]> {
    await this.repository.getConversation(conversationId);
    const result = await dialog.showOpenDialog({
      title: "Adicionar pasta como contexto",
      properties: ["openDirectory"],
      buttonLabel: "Adicionar pasta",
    });
    const selected = result.canceled ? null : result.filePaths[0];
    return selected ? [await this.context.stageFolder(conversationId, selected)] : [];
  }

  stageDroppedFiles(conversationId: string, paths: string[]): Promise<ContextAssetSummary[]> {
    return this.context.stageFiles(conversationId, paths);
  }

  async stageClipboard(conversationId: string): Promise<ContextAssetSummary[]> {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      return [
        await this.context.stageBuffer({
          conversationId,
          data: image.toPNG(),
          name: `imagem-colada-${Date.now()}.png`,
          mimeType: "image/png",
          source: "clipboard",
        }),
      ];
    }
    const text = clipboard.readText().trim();
    if (!text)
      throw new MaestroError(
        "CLIPBOARD_EMPTY",
        "A área de transferência não contém mídia ou texto.",
        {
          recoverable: true,
        },
      );
    return [
      await this.context.stageBuffer({
        conversationId,
        data: Buffer.from(text, "utf8"),
        name: `texto-colado-${Date.now()}.txt`,
        mimeType: "text/plain",
        source: "clipboard",
      }),
    ];
  }

  stageRecordedAudio(input: StageRecordedAudioInput): Promise<ContextAssetSummary> {
    const extension = input.mimeType.includes("ogg")
      ? "ogg"
      : input.mimeType.includes("mp4")
        ? "m4a"
        : "webm";
    return this.context.stageBuffer({
      conversationId: input.conversationId,
      data: input.data,
      name: `gravacao-${Date.now()}.${extension}`,
      mimeType: input.mimeType,
      source: "recording",
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
  }

  searchWorkspaceContext(input: SearchWorkspaceContextInput): Promise<WorkspaceContextCandidate[]> {
    return this.context.searchWorkspace(input.projectId, input.query, input.limit);
  }

  prepareWorkspaceContext(input: PrepareWorkspaceContextInput): Promise<ContextAssetSummary[]> {
    return this.context.prepareWorkspace(input.conversationId, input.candidates);
  }

  listContextAssets(conversationId: string): Promise<ContextAssetSummary[]> {
    return this.context.list(conversationId);
  }

  removeContextAsset(conversationId: string, assetId: string): Promise<void> {
    return this.context.remove(conversationId, assetId);
  }

  getLocalModelState(): LocalModelPackageState {
    return this.context.getLocalModelState();
  }

  downloadLocalModel(): LocalModelPackageState {
    return this.context.downloadLocalModel();
  }

  cancelLocalModelDownload(): Promise<LocalModelPackageState> {
    return this.context.cancelLocalModelDownload();
  }

  removeLocalModel(): Promise<LocalModelPackageState> {
    return this.context.removeLocalModel();
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const canonicalPath = await canonicalizeDirectory(input.directory);
    this.#consume(
      this.#directoryGrants,
      canonicalPath,
      "A pasta precisa ser selecionada pelo diálogo nativo.",
    );
    const project = await this.repository.createProject({
      name: input.name.trim() || path.basename(canonicalPath),
      path: input.directory,
      canonicalPath,
      displayName: path.basename(canonicalPath),
    });
    this.context.warmProject(project.id);
    return project;
  }

  listProjects(): Promise<Project[]> {
    return this.repository.listProjects();
  }

  async selectProject(projectId: string): Promise<BootstrapPayload> {
    await this.repository.selectProject(projectId);
    this.context.warmProject(projectId);
    return this.bootstrap(projectId);
  }

  updateProject(input: UpdateProjectInput): Promise<Project> {
    return this.repository.updateProject(input.projectId, input.name.trim());
  }

  async deleteProject(projectId: string): Promise<BootstrapPayload> {
    const runs = await this.repository.listRuns({ projectId, states: [...ACTIVE_RUN_STATES] });
    if (
      runs.length > 0 ||
      this.orchestration.hasActiveProject(projectId) ||
      this.terminal.hasProjectSession(projectId)
    )
      throw new MaestroError(
        "PROJECT_IN_USE",
        "O projeto possui execuções ou terminais ativos. Encerre-os antes de excluir o projeto.",
        { recoverable: true },
      );
    const activeProjectId = await this.repository.getActiveProjectId();
    await this.context.removeProjectFiles(projectId);
    await this.repository.deleteProject(projectId);
    this.context.invalidateProject(projectId);
    const remaining = await this.repository.listProjects();
    const nextProjectId =
      activeProjectId === projectId ? (remaining[0]?.id ?? null) : activeProjectId;
    if (nextProjectId) await this.repository.selectProject(nextProjectId);
    return this.bootstrap(nextProjectId);
  }

  async addProjectRoot(projectId: string, directory: string): Promise<Project> {
    const canonicalPath = await canonicalizeDirectory(directory);
    this.#consume(
      this.#directoryGrants,
      canonicalPath,
      "A pasta precisa ser selecionada pelo diálogo nativo.",
    );
    const project = await this.repository.addWorkspaceRoot(projectId, {
      path: directory,
      canonicalPath,
      displayName: path.basename(canonicalPath),
    });
    this.context.invalidateProject(projectId);
    this.context.warmProject(projectId);
    return project;
  }

  async removeProjectRoot(projectId: string, workspaceRootId: string): Promise<Project> {
    const root = await this.repository.getWorkspaceRoot(workspaceRootId);
    if (root.projectId !== projectId)
      throw new MaestroError(
        "WORKSPACE_PROJECT_MISMATCH",
        "A raiz não pertence ao projeto selecionado.",
      );
    const activeRuns = await this.repository.listRuns({
      projectId,
      states: [...ACTIVE_RUN_STATES],
    });
    if (activeRuns.some((run) => run.spec.workspaceRootIds.includes(workspaceRootId)))
      throw new MaestroError(
        "WORKSPACE_ROOT_IN_USE",
        "Esta pasta está sendo usada por uma execução ativa.",
        { recoverable: true },
      );
    if (this.terminal.hasWorkspaceRootSession(workspaceRootId))
      throw new MaestroError(
        "WORKSPACE_ROOT_IN_USE",
        "Encerre o terminal aberto nesta pasta antes de removê-la do projeto.",
        { recoverable: true },
      );
    const project = await this.repository.removeWorkspaceRoot(projectId, workspaceRootId);
    this.context.invalidateProject(projectId);
    this.context.warmProject(projectId);
    return project;
  }

  createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.repository.createConversationDraft({
      ...input,
      title: input.title?.trim() || "Nova conversa",
      providerId: input.providerId ?? null,
      providerConnectionId: input.providerConnectionId ?? null,
      modelId: input.modelId ?? null,
    });
  }

  listConversations(projectId: string, limit?: number): Promise<Conversation[]> {
    return this.repository.listConversations(projectId, limit);
  }

  async getConversation(conversationId: string): Promise<ConversationDetail> {
    await this.context.refreshWorkspaceReferences(conversationId);
    const [conversation, messages, runs] = await Promise.all([
      this.repository.getConversation(conversationId),
      this.repository.listMessages(conversationId),
      this.repository.listRuns({ conversationId }),
    ]);
    return { conversation, messages, runs };
  }

  updateConversation(input: UpdateConversationInput): Promise<Conversation> {
    return this.repository.updateConversation(input.conversationId, { title: input.title.trim() });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const runs = await this.repository.listRuns({
      conversationId,
      states: [...ACTIVE_RUN_STATES],
    });
    if (runs.length > 0 || this.orchestration.hasActiveConversation(conversationId))
      throw new MaestroError(
        "CONVERSATION_HAS_ACTIVE_RUNS",
        "A conversa possui uma execução ativa. Cancele ou aguarde a conclusão antes de excluí-la.",
        { recoverable: true },
      );
    await this.context.removeConversationFiles(conversationId);
    await this.repository.deleteConversation(conversationId);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.orchestration.sendMessage(input);
  }

  getRun(runId: string): Promise<RunDetail> {
    return this.repository.getRunDetail(runId);
  }

  getRunEvents(runId: string, afterSequence?: number, limit?: number): Promise<EventPage> {
    return this.repository.getEvents(runId, afterSequence, limit);
  }

  approveRun(runId: string, version: number): Promise<RunDetail> {
    return this.orchestration.approve(runId, version);
  }

  reviseRun(runId: string, version: number, comment: string): Promise<PlanSpec> {
    return this.orchestration.revise(runId, version, comment);
  }

  cancelRun(runId: string): Promise<RunDetail> {
    return this.orchestration.cancel(runId);
  }

  refreshProviders(): Promise<ProviderSummary[]> {
    return this.providers.refresh();
  }

  configureProvider(input: ConfigureProviderInput): Promise<ProviderSummary[]> {
    return this.providers.configure(input);
  }

  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]> {
    return this.providers.createConnection(input);
  }

  updateProviderConnection(
    input: UpdateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]> {
    return this.providers.updateConnection(input);
  }

  reorderProviderConnections(connectionIds: string[]): Promise<ProviderConnectionSummary[]> {
    return this.providers.reorderConnections(connectionIds);
  }

  deleteProviderConnection(connectionId: string): Promise<ProviderConnectionSummary[]> {
    return this.providers.deleteConnection(connectionId);
  }

  async loginProviderConnection(connectionId: string): Promise<TerminalSessionDto> {
    const command = await this.providers.loginCommand(connectionId);
    return this.terminal.createProviderLogin({
      connectionId,
      label: `Login · ${command.connection.name}`,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
    });
  }

  updateSettings(partial: {
    [Key in keyof AppSettings]?: AppSettings[Key] | undefined;
  }): Promise<AppSettings> {
    const update = this.#settingsUpdateTail.then(async () => {
      const current = await this.repository.getSettings();
      const defined = Object.fromEntries(
        Object.entries(partial).filter(
          (entry): entry is [string, AppSettings[keyof AppSettings]] => entry[1] !== undefined,
        ),
      );
      const next = appSettingsSchema.parse({ ...DEFAULT_APP_SETTINGS, ...current, ...defined });
      nativeTheme.themeSource = next.theme;
      const saved = await this.repository.setSettings(next);
      this.updates.configure(saved);
      await this.providers.refresh();
      return saved;
    });

    this.#settingsUpdateTail = update.then(
      () => undefined,
      () => undefined,
    );

    return update;
  }

  unlockVault(password: string): Promise<VaultStatus> {
    return this.vault.unlock(password);
  }

  async lockVault(): Promise<VaultStatus> {
    this.vault.lock();
    return this.vault.status();
  }

  checkForUpdates(): Promise<UpdateState> {
    return this.updates.check();
  }

  downloadUpdate(): Promise<UpdateState> {
    return this.updates.download();
  }

  installUpdate(): Promise<void> {
    return this.updates.install();
  }

  createTerminal(projectId: string, workspaceRootId: string): Promise<TerminalSessionDto> {
    return this.terminal.create(projectId, workspaceRootId);
  }

  writeTerminal(sessionId: string, data: string): void {
    this.terminal.write(sessionId, data);
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    this.terminal.resize(sessionId, cols, rows);
  }

  killTerminal(sessionId: string): void {
    this.terminal.kill(sessionId);
  }

  async dispose(): Promise<void> {
    this.updates.dispose();
    this.terminal.dispose();
    await this.orchestration.dispose();
    await this.context.dispose();
    await this.providers.dispose();
    await this.supervisor.killAll();
    this.vault.lock();
    this.repository.close();
  }

  #grant(target: Map<string, Grant>, grantedPath: string): void {
    target.set(path.resolve(grantedPath), {
      path: path.resolve(grantedPath),
      expiresAt: Date.now() + 10 * 60_000,
    });
  }

  #consume(
    target: Map<string, Grant>,
    requestedPath: string,
    message: string,
    remove = true,
  ): void {
    const key = path.resolve(requestedPath);
    const grant = target.get(key);
    if (!grant || grant.expiresAt < Date.now()) {
      target.delete(key);
      throw new MaestroError("NATIVE_PICKER_GRANT_REQUIRED", message, { recoverable: true });
    }
    if (remove) target.delete(key);
  }
}
