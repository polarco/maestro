import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  ConfigureProviderInput,
  CreateProviderConnectionInput,
  ModelSelection,
  ProviderAdapter,
  ProviderConnection,
  ProviderConnectionSummary,
  ProviderHealth,
  ProviderModel,
  ProviderSummary,
  UpdateProviderConnectionInput,
} from "@maestro/contracts";
import { MaestroError } from "@maestro/core";
import type { ProviderDependencies } from "./types.js";
import { configString } from "./types.js";
import { AnthropicApiAdapter } from "./anthropic-api.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import { subscriptionEnvironment } from "./subscription-environment.js";

export type ProviderUse = "orchestrator" | "subscription-worker" | "direct" | "chat";

export interface ResolvedProvider {
  adapter: ProviderAdapter;
  selection: ModelSelection;
  connection: ProviderConnection | null;
}

export interface ProviderLoginCommand {
  connection: ProviderConnection;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const CLI_PROVIDER_IDS = ["codex", "claude-code"] as const;

function isCliProviderId(value: string): value is (typeof CLI_PROVIDER_IDS)[number] {
  return (CLI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function assertProviderUseAllowed(providerId: string, use: ProviderUse): void {
  if (!isCliProviderId(providerId) && use !== "orchestrator") {
    throw new MaestroError(
      "PAID_API_BLOCKED",
      "APIs pagas são permitidas somente para análise e planejamento do orquestrador. Escolha uma conta Claude/Codex por assinatura.",
      { recoverable: true },
    );
  }
}

export class ProviderRegistry {
  readonly #dependencies: ProviderDependencies;
  readonly #apiAdapters = new Map<string, ProviderAdapter>();
  readonly #connectionAdapters = new Map<string, ProviderAdapter>();
  readonly #summaries = new Map<string, ProviderSummary>();
  readonly #connectionSummaries = new Map<string, ProviderConnectionSummary>();
  readonly #activeCounts = new Map<string, number>();

  constructor(dependencies: ProviderDependencies) {
    this.#dependencies = dependencies;
    for (const adapter of [
      new AnthropicApiAdapter(dependencies),
      new OpenAiCompatibleAdapter(dependencies),
    ]) {
      this.#apiAdapters.set(adapter.descriptor.id, adapter);
    }
  }

  get(providerId: string, connectionId?: string): ProviderAdapter {
    if (!isCliProviderId(providerId)) {
      const adapter = this.#apiAdapters.get(providerId);
      if (!adapter)
        throw new MaestroError("PROVIDER_NOT_FOUND", `Provedor desconhecido: ${providerId}`);
      return adapter;
    }
    const connection = connectionId
      ? this.#connectionSummaries.get(connectionId)?.connection
      : this.#selectConnection(providerId)?.connection;
    if (!connection || connection.providerId !== providerId) {
      throw new MaestroError(
        "SUBSCRIPTION_CONNECTION_UNAVAILABLE",
        `Nenhuma conta de assinatura ${providerId} está pronta.`,
        { recoverable: true },
      );
    }
    const adapter = this.#connectionAdapters.get(connection.id);
    if (!adapter)
      throw new MaestroError(
        "PROVIDER_CONNECTION_NOT_FOUND",
        "Conta de assinatura não encontrada.",
      );
    return adapter;
  }

  resolve(selection: ModelSelection, use: ProviderUse): ResolvedProvider {
    assertProviderUseAllowed(selection.providerId, use);
    if (!isCliProviderId(selection.providerId)) {
      return { adapter: this.get(selection.providerId), selection, connection: null };
    }

    const summary = selection.connectionId
      ? this.#connectionSummaries.get(selection.connectionId)
      : this.#selectConnection(selection.providerId);
    if (
      !summary ||
      summary.connection.providerId !== selection.providerId ||
      !summary.connection.enabled ||
      summary.health.status !== "ready"
    ) {
      throw new MaestroError(
        "SUBSCRIPTION_CONNECTION_UNAVAILABLE",
        "A conta de assinatura selecionada não está autenticada ou está desativada.",
        { recoverable: true },
      );
    }
    return {
      adapter: this.get(selection.providerId, summary.connection.id),
      selection: { ...selection, connectionId: summary.connection.id },
      connection: summary.connection,
    };
  }

  prepareSubscription(selection: ModelSelection): ModelSelection {
    if (!isCliProviderId(selection.providerId)) {
      throw new MaestroError(
        "PAID_API_BLOCKED",
        "Tarefas de execução só podem usar contas Claude/Codex por assinatura.",
        { recoverable: true },
      );
    }
    const summary = selection.connectionId
      ? this.#connectionSummaries.get(selection.connectionId)
      : this.#selectConnection(selection.providerId);
    if (!summary || summary.health.status !== "ready" || !summary.connection.enabled) {
      throw new MaestroError(
        "SUBSCRIPTION_CONNECTION_UNAVAILABLE",
        `Nenhuma assinatura ${selection.providerId} está pronta para a tarefa.`,
        { recoverable: true },
      );
    }
    return {
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(selection.effort ? { effort: selection.effort } : {}),
    };
  }

  markSessionStarted(connectionId?: string): void {
    if (!connectionId) return;
    this.#activeCounts.set(connectionId, (this.#activeCounts.get(connectionId) ?? 0) + 1);
  }

  markSessionEnded(connectionId?: string): void {
    if (!connectionId) return;
    this.#activeCounts.set(
      connectionId,
      Math.max(0, (this.#activeCounts.get(connectionId) ?? 1) - 1),
    );
  }

  listCached(): ProviderSummary[] {
    return [
      ...CLI_PROVIDER_IDS.map((providerId) => this.#aggregateCliSummary(providerId)),
      ...[...this.#apiAdapters.keys()].map(
        (providerId) =>
          this.#summaries.get(providerId) ?? this.#checkingSummary(this.get(providerId)),
      ),
    ];
  }

  listConnectionsCached(): ProviderConnectionSummary[] {
    return [...this.#connectionSummaries.values()]
      .map((summary) => ({
        ...summary,
        activeSessions: this.#activeCounts.get(summary.connection.id) ?? 0,
      }))
      .sort(
        (left, right) =>
          left.connection.priority - right.connection.priority ||
          left.connection.createdAt.localeCompare(right.connection.createdAt),
      );
  }

  async refresh(signal?: AbortSignal): Promise<ProviderSummary[]> {
    await this.#ensureDefaultConnections();
    await this.#syncConnectionAdapters();
    await Promise.all([
      ...[...this.#connectionAdapters.entries()].map(async ([connectionId, adapter]) => {
        const connection = await this.#dependencies.repository.getProviderConnection(connectionId);
        let health: ProviderHealth;
        let models: ProviderModel[] = [];
        if (!connection.enabled) {
          health = {
            providerId: connection.providerId,
            connectionId,
            status: "unavailable",
            installed: true,
            authenticated: null,
            version: null,
            message: "Conta desativada.",
            checkedAt: new Date().toISOString(),
          };
        } else {
          try {
            health = await adapter.detect(signal);
            if (health.installed) models = await adapter.listModels(signal).catch(() => []);
          } catch (error) {
            health = {
              providerId: connection.providerId,
              connectionId,
              status: "degraded",
              installed: false,
              authenticated: null,
              version: null,
              message: error instanceof Error ? error.message : String(error),
              checkedAt: new Date().toISOString(),
            };
          }
        }
        this.#connectionSummaries.set(connectionId, {
          connection,
          health,
          models,
          activeSessions: this.#activeCounts.get(connectionId) ?? 0,
        });
      }),
      ...[...this.#apiAdapters.values()].map(async (adapter) => {
        let health: ProviderHealth;
        let models: ProviderModel[] = [];
        try {
          health = await adapter.detect(signal);
          models = await adapter.listModels(signal).catch(() => []);
        } catch (error) {
          health = {
            providerId: adapter.descriptor.id,
            status: "degraded",
            installed: false,
            authenticated: null,
            version: null,
            message: error instanceof Error ? error.message : String(error),
            checkedAt: new Date().toISOString(),
          };
        }
        const summary: ProviderSummary = {
          descriptor: adapter.descriptor,
          health,
          models,
          configSchema: adapter.configSchema,
          configValues: await this.#dependencies.repository.getProviderConfig(
            adapter.descriptor.id,
          ),
          configured: await this.#isConfigured(adapter, health),
        };
        this.#summaries.set(adapter.descriptor.id, summary);
      }),
    ]);
    for (const providerId of CLI_PROVIDER_IDS) {
      const summary = this.#aggregateCliSummary(providerId);
      summary.configValues = await this.#dependencies.repository.getProviderConfig(providerId);
      this.#summaries.set(providerId, summary);
    }
    return this.listCached();
  }

  async configure(input: ConfigureProviderInput): Promise<ProviderSummary[]> {
    const adapter = isCliProviderId(input.providerId)
      ? [...this.#connectionAdapters.values()].find(
          (candidate) => candidate.descriptor.id === input.providerId,
        )
      : this.get(input.providerId);
    if (!adapter)
      throw new MaestroError("PROVIDER_NOT_FOUND", `Provedor desconhecido: ${input.providerId}`);
    const current = await this.#dependencies.repository.getProviderConfig(input.providerId);
    const next = { ...current };
    for (const field of adapter.configSchema.fields) {
      if (!(field.key in input.values)) continue;
      const value = input.values[field.key];
      if (field.type === "secret") {
        if (typeof value === "string" || value === null)
          await this.#dependencies.vault.set(`provider:${input.providerId}:${field.key}`, value);
      } else if (value !== undefined) next[field.key] = value;
    }
    for (const field of adapter.configSchema.fields) {
      if (
        field.type !== "secret" &&
        next[field.key] === undefined &&
        field.defaultValue !== undefined
      )
        next[field.key] = field.defaultValue;
    }
    await this.#dependencies.repository.setProviderConfig(input.providerId, next);
    return this.refresh();
  }

  async createConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]> {
    const id = randomUUID();
    const stateDirectory = path.join(
      this.#dependencies.userDataDirectory,
      "accounts",
      input.providerId,
      id,
    );
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await this.#dependencies.repository.createProviderConnection({
      id,
      providerId: input.providerId,
      name: input.name.trim(),
      stateDirectory,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
    });
    await this.refresh();
    return this.listConnectionsCached();
  }

  async updateConnection(
    input: UpdateProviderConnectionInput,
  ): Promise<ProviderConnectionSummary[]> {
    await this.#dependencies.repository.updateProviderConnection(input.connectionId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
    });
    await this.refresh();
    return this.listConnectionsCached();
  }

  async reorderConnections(connectionIds: string[]): Promise<ProviderConnectionSummary[]> {
    await this.#dependencies.repository.reorderProviderConnections(connectionIds);
    await this.refresh();
    return this.listConnectionsCached();
  }

  async deleteConnection(connectionId: string): Promise<ProviderConnectionSummary[]> {
    if ((this.#activeCounts.get(connectionId) ?? 0) > 0)
      throw new MaestroError(
        "CONNECTION_IN_USE",
        "A conta possui sessões ativas; desative-a após a execução.",
        { recoverable: true },
      );
    await this.#connectionAdapters.get(connectionId)?.dispose();
    this.#connectionAdapters.delete(connectionId);
    this.#connectionSummaries.delete(connectionId);
    await this.#dependencies.repository.deleteProviderConnection(connectionId);
    await this.refresh();
    return this.listConnectionsCached();
  }

  async loginCommand(connectionId: string): Promise<ProviderLoginCommand> {
    const connection = await this.#dependencies.repository.getProviderConnection(connectionId);
    const config = await this.#dependencies.repository.getProviderConfig(connection.providerId);
    const executable = configString(
      config,
      "executable",
      connection.providerId === "codex" ? "codex" : "claude",
    );
    const cwd = connection.stateDirectory ?? this.#dependencies.userDataDirectory;
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    return {
      connection,
      executable,
      args:
        connection.providerId === "codex"
          ? ["-c", 'model_provider="openai"', "login", "--device-auth"]
          : ["auth", "login", "--claudeai"],
      cwd,
      env: subscriptionEnvironment(connection),
    };
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([
      ...[...this.#connectionAdapters.values()].map((adapter) => adapter.dispose()),
      ...[...this.#apiAdapters.values()].map((adapter) => adapter.dispose()),
    ]);
  }

  async #ensureDefaultConnections(): Promise<void> {
    for (const providerId of CLI_PROVIDER_IDS) {
      const existing = await this.#dependencies.repository.listProviderConnections(providerId);
      if (existing.length === 0) {
        await this.#dependencies.repository.createProviderConnection({
          providerId,
          name: "Conta padrão",
          isDefault: true,
          stateDirectory: null,
          concurrencyLimit: 1,
        });
      }
    }
  }

  async #syncConnectionAdapters(): Promise<void> {
    const connections = await this.#dependencies.repository.listProviderConnections();
    const ids = new Set(connections.map((connection) => connection.id));
    for (const [id, adapter] of this.#connectionAdapters) {
      if (ids.has(id)) continue;
      await adapter.dispose();
      this.#connectionAdapters.delete(id);
      this.#connectionSummaries.delete(id);
    }
    for (const connection of connections) {
      if (this.#connectionAdapters.has(connection.id)) continue;
      this.#connectionAdapters.set(
        connection.id,
        connection.providerId === "codex"
          ? new CodexAdapter(this.#dependencies, connection)
          : new ClaudeCodeAdapter(this.#dependencies, connection),
      );
    }
  }

  #selectConnection(providerId: "codex" | "claude-code"): ProviderConnectionSummary | null {
    const candidates = this.listConnectionsCached().filter(
      (summary) =>
        summary.connection.providerId === providerId &&
        summary.connection.enabled &&
        summary.health.status === "ready" &&
        summary.activeSessions < summary.connection.concurrencyLimit,
    );
    if (candidates.length === 0) return null;
    return candidates[0]!;
  }

  #aggregateCliSummary(providerId: "codex" | "claude-code"): ProviderSummary {
    const connections = this.listConnectionsCached().filter(
      (summary) => summary.connection.providerId === providerId,
    );
    const ready = connections.find((summary) => summary.health.status === "ready");
    const first = ready ?? connections[0];
    const adapter = first ? this.#connectionAdapters.get(first.connection.id) : undefined;
    const descriptor = adapter?.descriptor ?? {
      id: providerId,
      name: providerId === "codex" ? "Codex" : "Claude Code",
      kind: "cli" as const,
      description: "Contas isoladas autenticadas por assinatura.",
      supportsStructuredSessions: true,
      supportsPty: true,
    };
    const health: ProviderHealth = ready?.health ??
      first?.health ?? {
        providerId,
        status: "checking",
        installed: false,
        authenticated: null,
        version: null,
        message: "Verificando contas…",
        checkedAt: new Date().toISOString(),
      };
    return {
      descriptor,
      health: {
        ...health,
        providerId,
        message: ready
          ? `${connections.filter((item) => item.health.status === "ready").length} conta(s) por assinatura pronta(s).`
          : health.message,
      },
      models: ready?.models ?? first?.models ?? [],
      configSchema: adapter?.configSchema ?? { providerId, fields: [] },
      configValues: this.#summaries.get(providerId)?.configValues ?? {},
      configured: Boolean(ready),
    };
  }

  #checkingSummary(adapter: ProviderAdapter): ProviderSummary {
    return {
      descriptor: adapter.descriptor,
      health: {
        providerId: adapter.descriptor.id,
        status: "checking",
        installed: false,
        authenticated: null,
        version: null,
        message: "Verificando…",
        checkedAt: new Date().toISOString(),
      },
      models: [],
      configSchema: adapter.configSchema,
      configValues: {},
      configured: false,
    };
  }

  async #isConfigured(adapter: ProviderAdapter, health: ProviderHealth): Promise<boolean> {
    const config = await this.#dependencies.repository.getProviderConfig(adapter.descriptor.id);
    for (const field of adapter.configSchema.fields) {
      if (!field.required) continue;
      if (field.type === "secret") {
        if (!(await this.#dependencies.vault.has(`provider:${adapter.descriptor.id}:${field.key}`)))
          return false;
      } else if (config[field.key] === undefined && field.defaultValue === undefined) return false;
    }
    return health.status === "ready";
  }
}
