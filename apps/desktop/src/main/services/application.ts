import path from "node:path";
import { realpath } from "node:fs/promises";
import { app, dialog, nativeTheme } from "electron";
import {
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  type AppSettings,
  type BootstrapPayload,
  type ConfigureProviderInput,
  type CreateProviderConnectionInput,
  type Conversation,
  type ConversationDetail,
  type CreateConversationInput,
  type CreateProjectInput,
  type EventPage,
  type PlanSpec,
  type Project,
  type ProviderSummary,
  type ProviderConnectionSummary,
  type RunDetail,
  type RunEvent,
  type RunState,
  type SendMessageInput,
  type SendMessageResult,
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
  readonly terminal: TerminalService;
  readonly updates: UpdateService;
  readonly #directoryGrants = new Map<string, Grant>();
  readonly #attachmentGrants = new Map<string, Grant>();
  #runEventHandler: (event: RunEvent) => void = () => {};
  #terminalEventHandler: (event: TerminalEvent) => void = () => {};
  #updateEventHandler: (state: UpdateState) => void = () => {};

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
    this.orchestration = new OrchestrationService({
      repository: this.repository,
      providers: this.providers,
      supervisor: this.supervisor,
      userDataDirectory,
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
  }): void {
    this.#runEventHandler = input.run;
    this.#terminalEventHandler = input.terminal;
    this.#updateEventHandler = input.update;
  }

  async initialize(): Promise<void> {
    const settings = await this.repository.getSettings();
    nativeTheme.themeSource = settings.theme;
    this.updates.configure(settings);
    await this.providers.refresh();
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

  async selectAttachments(): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      title: "Adicionar anexos",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Arquivos suportados",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "json"],
        },
        { name: "Todos os arquivos", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    for (const selected of result.filePaths)
      this.#grant(this.#attachmentGrants, await realpath(selected));
    return result.filePaths;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const canonicalPath = await canonicalizeDirectory(input.directory);
    this.#consume(
      this.#directoryGrants,
      canonicalPath,
      "A pasta precisa ser selecionada pelo diálogo nativo.",
    );
    return this.repository.createProject({
      name: input.name.trim() || path.basename(canonicalPath),
      path: input.directory,
      canonicalPath,
      displayName: path.basename(canonicalPath),
    });
  }

  listProjects(): Promise<Project[]> {
    return this.repository.listProjects();
  }

  async selectProject(projectId: string): Promise<BootstrapPayload> {
    await this.repository.selectProject(projectId);
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
    await this.repository.deleteProject(projectId);
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
    return this.repository.addWorkspaceRoot(projectId, {
      path: directory,
      canonicalPath,
      displayName: path.basename(canonicalPath),
    });
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
    return this.repository.removeWorkspaceRoot(projectId, workspaceRootId);
  }

  createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.repository.createConversation({
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
    await this.repository.deleteConversation(conversationId);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const attachmentPaths = await Promise.all(
      input.attachmentPaths.map((attachmentPath) => realpath(attachmentPath)),
    );
    for (const attachmentPath of attachmentPaths) {
      this.#consume(
        this.#attachmentGrants,
        attachmentPath,
        "Anexo não autorizado pelo diálogo nativo.",
        false,
      );
    }
    return this.orchestration.sendMessage({ ...input, attachmentPaths });
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

  async updateSettings(partial: {
    [Key in keyof AppSettings]?: AppSettings[Key] | undefined;
  }): Promise<AppSettings> {
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
