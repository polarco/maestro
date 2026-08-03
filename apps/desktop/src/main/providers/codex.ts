import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  Effort,
  NewRunEvent,
  ProviderAdapter,
  ProviderAdapterCapabilities,
  ProviderConfigSchema,
  ProviderDescriptor,
  ProviderEventSink,
  ProviderHealth,
  ProviderConnection,
  ProviderModel,
  ProviderInput,
  ProviderInputPart,
  ProviderSession,
  ProviderSessionSpec,
} from "@maestro/contracts";
import {
  MaestroError,
  errorMessage,
  normalizeCodexEvent,
  resolveModelContextWindow,
} from "@maestro/core";
import type { ManagedProcess } from "../services/process-supervisor.js";
import { CodexAppServerClient } from "./codex-app-server.js";
import { CodexSchemaCache } from "./codex-schema-cache.js";
import { configString, type ProviderDependencies } from "./types.js";
import { subscriptionEnvironment } from "./subscription-environment.js";

type JsonRecord = Record<string, unknown>;
const OFFICIAL_SUBSCRIPTION_CONFIG = ["-c", 'model_provider="openai"'] as const;

interface CodexSessionRecord {
  session: ProviderSession;
  spec: ProviderSessionSpec;
  sink: ProviderEventSink;
  transport: "app-server" | "exec";
  threadId: string | null;
  currentTurnId: string | null;
  currentProcess: ManagedProcess | null;
  completion: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null;
}

function capability(efforts: Effort[], vision = false, contextWindow = 400_000) {
  return {
    chat: true,
    coding: true,
    tools: true,
    vision,
    reasoningEffort: efforts,
    structuredOutput: true,
    contextWindow,
  };
}

function modelContextWindow(entry: JsonRecord, modelId: string): number {
  for (const candidate of [
    entry.context_window,
    entry.contextWindow,
    entry.max_context_tokens,
    entry.maxContextTokens,
  ]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0)
      return Math.floor(candidate);
  }
  return resolveModelContextWindow("codex", modelId, null);
}

function inputParts(input: ProviderInput): ProviderInputPart[] {
  return typeof input === "string" ? [{ type: "text", text: input }] : input;
}

export function codexServerInput(input: ProviderInput): JsonRecord[] {
  return inputParts(input).map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text, text_elements: [] }
      : { type: "localImage", path: part.path },
  );
}

export function codexCliImageArgs(input: ProviderInput): string[] {
  return inputParts(input).flatMap((part) =>
    part.type === "localImage" ? ["--image", part.path] : [],
  );
}

export function codexModelSupportsVision(entry: JsonRecord): boolean {
  const rawModalities = Array.isArray(entry.inputModalities)
    ? entry.inputModalities
    : Array.isArray(entry.input_modalities)
      ? entry.input_modalities
      : null;
  return rawModalities?.some((item) => item === "image") ?? false;
}

function restrictedThreadConfig(spec: ProviderSessionSpec): JsonRecord | null {
  const shellAllowed = spec.permissions.runCommands && spec.tools.includes("command.run");
  return {
    web_search: "disabled",
    mcp_servers: {},
    features: {
      apps: false,
      browser_use: false,
      computer_use: false,
      image_generation: false,
      multi_agent: false,
      shell_tool: shellAllowed,
      unified_exec: shellAllowed,
    },
  };
}

function restrictedExecArgs(spec: ProviderSessionSpec): string[] {
  if (spec.mode === "agent" && spec.permissions.runCommands) return [];
  return [
    "--ignore-user-config",
    "--disable",
    "apps",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--disable",
    "image_generation",
    "--disable",
    "multi_agent",
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
  ];
}

function sandboxPolicy(spec: ProviderSessionSpec): JsonRecord {
  if (spec.permissions.writeWorkspace) {
    return {
      type: "workspaceWrite",
      writableRoots: spec.workspaceRoots,
      readOnlyAccess: {
        type: "restricted",
        includePlatformDefaults: true,
        readableRoots: spec.workspaceRoots,
      },
      networkAccess: spec.permissions.network,
    };
  }
  return {
    type: "readOnly",
    access: {
      type: "restricted",
      includePlatformDefaults: true,
      readableRoots: spec.workspaceRoots,
    },
  };
}

function nestedString(value: unknown, keys: string[]): string | null {
  let cursor: unknown = value;
  for (const key of keys) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = (cursor as JsonRecord)[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

export class CodexAdapter implements ProviderAdapter {
  readonly capabilities: ProviderAdapterCapabilities = {
    nativeLoop: true,
    tools: true,
    mcp: true,
    tokenization: "native",
    promptCache: true,
    pricing: false,
    safeRetry: false,
    checkpointResume: true,
    steering: true,
  };
  readonly descriptor: ProviderDescriptor = {
    id: "codex",
    name: "Codex",
    kind: "cli",
    description: "Sessões estruturadas via app-server, com fallback JSONL pelo exec.",
    supportsStructuredSessions: true,
    supportsPty: true,
    homepage: "https://developers.openai.com/codex/",
  };

  readonly configSchema: ProviderConfigSchema = {
    providerId: "codex",
    fields: [
      {
        key: "executable",
        label: "Executável",
        type: "text",
        required: true,
        defaultValue: "codex",
      },
    ],
  };

  readonly #dependencies: ProviderDependencies;
  readonly connection: ProviderConnection;
  readonly #sessions = new Map<string, CodexSessionRecord>();
  readonly #schemaCache: CodexSchemaCache;
  #client: CodexAppServerClient | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(dependencies: ProviderDependencies, connection: ProviderConnection) {
    this.#dependencies = dependencies;
    this.connection = connection;
    this.#schemaCache = new CodexSchemaCache(
      dependencies.userDataDirectory,
      dependencies.supervisor,
    );
  }

  #environment(): NodeJS.ProcessEnv {
    return subscriptionEnvironment(this.connection);
  }

  async #executable(): Promise<string> {
    const config = await this.#dependencies.repository.getProviderConfig(this.descriptor.id);
    return configString(config, "executable", "codex");
  }

  async detect(signal?: AbortSignal): Promise<ProviderHealth> {
    const executable = await this.#executable();
    const versionResult = await this.#dependencies.supervisor
      .capture(
        { executable, args: ["--version"], env: this.#environment(), label: "Codex version" },
        { timeoutMs: 8_000, ...(signal ? { signal } : {}), maxOutputBytes: 64_000 },
      )
      .catch(() => null);
    if (!versionResult || versionResult.exitCode !== 0) {
      return {
        providerId: this.descriptor.id,
        connectionId: this.connection.id,
        status: "unavailable",
        installed: false,
        authenticated: null,
        version: null,
        message: "Codex não foi encontrado no PATH.",
        checkedAt: new Date().toISOString(),
      };
    }
    const version = versionResult.stdout.trim() || versionResult.stderr.trim();
    const auth = await this.#dependencies.supervisor
      .capture(
        {
          executable,
          args: [...OFFICIAL_SUBSCRIPTION_CONFIG, "login", "status"],
          env: this.#environment(),
          label: "Codex auth status",
        },
        { timeoutMs: 10_000, ...(signal ? { signal } : {}), maxOutputBytes: 64_000 },
      )
      .catch(() => null);
    const authText = `${auth?.stdout ?? ""}\n${auth?.stderr ?? ""}`;
    const authenticated = auth?.exitCode === 0 && /logged in using chatgpt/i.test(authText);
    void this.#schemaCache.ensure(version, executable).catch(() => null);
    return {
      providerId: this.descriptor.id,
      connectionId: this.connection.id,
      status: authenticated ? "ready" : "unauthenticated",
      installed: true,
      authenticated,
      version,
      message: authenticated
        ? "Assinatura ChatGPT conectada; a autenticação permanece no Codex."
        : /api.?key/i.test(authText)
          ? "Login por API key recusado: esta conexão aceita somente assinatura ChatGPT."
          : "Conecte uma assinatura ChatGPT pelo fluxo de dispositivo.",
      checkedAt: new Date().toISOString(),
    };
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const executable = await this.#executable();
    const result = await this.#dependencies.supervisor
      .capture(
        {
          executable,
          args: [...OFFICIAL_SUBSCRIPTION_CONFIG, "debug", "models", "--bundled"],
          env: this.#environment(),
          label: "Codex model catalog",
        },
        { timeoutMs: 15_000, ...(signal ? { signal } : {}), maxOutputBytes: 10 * 1024 * 1024 },
      )
      .catch(() => null);
    if (!result || result.exitCode !== 0) {
      return [
        {
          id: "default",
          name: "Padrão do Codex",
          isDefault: true,
          capabilities: capability(["low", "medium", "high", "xhigh", "max"]),
        },
      ];
    }
    try {
      const value = JSON.parse(result.stdout) as JsonRecord;
      const entries = Array.isArray(value.models) ? value.models : [];
      const models = entries.flatMap((entryValue): ProviderModel[] => {
        if (typeof entryValue !== "object" || entryValue === null) return [];
        const entry = entryValue as JsonRecord;
        const id =
          typeof entry.slug === "string"
            ? entry.slug
            : typeof entry.id === "string"
              ? entry.id
              : null;
        if (!id || entry.visibility === "hidden" || entry.hidden === true) return [];
        const effortEntries = Array.isArray(entry.supported_reasoning_levels)
          ? entry.supported_reasoning_levels
          : Array.isArray(entry.supportedReasoningEfforts)
            ? entry.supportedReasoningEfforts
            : [];
        const efforts = effortEntries
          .map((item) => (typeof item === "object" && item ? (item as JsonRecord).effort : null))
          .filter(
            (item): item is Effort =>
              typeof item === "string" && ["low", "medium", "high", "xhigh", "max"].includes(item),
          );
        const vision = codexModelSupportsVision(entry);
        return [
          {
            id,
            name:
              typeof entry.display_name === "string"
                ? entry.display_name
                : typeof entry.displayName === "string"
                  ? entry.displayName
                  : id,
            ...(typeof entry.description === "string" ? { description: entry.description } : {}),
            isDefault: entry.isDefault === true || entry.priority === 1,
            capabilities: capability(
              efforts.length > 0 ? efforts : ["low", "medium", "high"],
              vision,
              modelContextWindow(entry, id),
            ),
          },
        ];
      });
      return models.length > 0
        ? models
        : [
            {
              id: "default",
              name: "Padrão do Codex",
              isDefault: true,
              capabilities: capability(["low", "medium", "high", "xhigh", "max"]),
            },
          ];
    } catch {
      return [
        {
          id: "default",
          name: "Padrão do Codex",
          isDefault: true,
          capabilities: capability(["low", "medium", "high", "xhigh", "max"]),
        },
      ];
    }
  }

  async createSession(
    spec: ProviderSessionSpec,
    onEvent: ProviderEventSink,
  ): Promise<ProviderSession> {
    const session: ProviderSession = {
      id: randomUUID(),
      providerId: this.descriptor.id,
      connectionId: this.connection.id,
      nativeSessionId: null,
      state: "starting",
    };
    const record: CodexSessionRecord = {
      session,
      spec,
      sink: onEvent,
      transport: "app-server",
      threadId: null,
      currentTurnId: null,
      currentProcess: null,
      completion: null,
    };
    this.#sessions.set(session.id, record);

    try {
      const client = await this.#ensureClient();
      const config = restrictedThreadConfig(spec);
      const result = await client.request<JsonRecord>("thread/start", {
        ...(spec.model !== "default" ? { model: spec.model } : {}),
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        approvalPolicy: "never",
        sandboxPolicy: sandboxPolicy(spec),
        ...(config ? { config } : {}),
        ...(spec.systemPrompt ? { developerInstructions: spec.systemPrompt } : {}),
        ephemeral: false,
      });
      const threadId = nestedString(result, ["thread", "id"]);
      if (!threadId)
        throw new MaestroError("CODEX_THREAD_MISSING", "Codex não retornou o id da thread.", {
          recoverable: true,
        });
      record.threadId = threadId;
      record.session.nativeSessionId = threadId;
      record.session.state = "idle";
    } catch {
      record.transport = "exec";
      record.session.state = "idle";
    }
    return { ...record.session };
  }

  async resumeSession(
    spec: ProviderSessionSpec,
    onEvent: ProviderEventSink,
  ): Promise<ProviderSession> {
    if (!spec.resumeSessionId) return this.createSession(spec, onEvent);
    const session: ProviderSession = {
      id: randomUUID(),
      providerId: this.descriptor.id,
      connectionId: this.connection.id,
      nativeSessionId: spec.resumeSessionId,
      state: "starting",
    };
    const record: CodexSessionRecord = {
      session,
      spec,
      sink: onEvent,
      transport: "app-server",
      threadId: spec.resumeSessionId,
      currentTurnId: null,
      currentProcess: null,
      completion: null,
    };
    this.#sessions.set(session.id, record);
    try {
      const client = await this.#ensureClient();
      const config = restrictedThreadConfig(spec);
      await client.request("thread/resume", {
        threadId: spec.resumeSessionId,
        ...(spec.model !== "default" ? { model: spec.model } : {}),
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        approvalPolicy: "never",
        sandboxPolicy: sandboxPolicy(spec),
        ...(config ? { config } : {}),
        ...(spec.systemPrompt ? { developerInstructions: spec.systemPrompt } : {}),
      });
      record.session.state = "idle";
    } catch {
      record.transport = "exec";
      record.session.state = "idle";
    }
    return { ...record.session };
  }

  async send(sessionId: string, input: ProviderInput): Promise<ProviderSession> {
    const record = this.#requireSession(sessionId);
    if (record.completion)
      throw new MaestroError("SESSION_BUSY", "A sessão Codex já possui um turno ativo.", {
        recoverable: true,
      });
    record.session.state = "active";
    if (record.transport === "exec") {
      await this.#sendExec(record, input);
      return { ...record.session };
    }
    const client = await this.#ensureClient();
    const completion = new Promise<void>((resolve, reject) => {
      record.completion = { resolve, reject };
    });
    try {
      const result = await client.request<JsonRecord>("turn/start", {
        threadId: record.threadId,
        input: codexServerInput(input),
        ...(record.spec.cwd ? { cwd: record.spec.cwd } : {}),
        ...(record.spec.model !== "default" ? { model: record.spec.model } : {}),
        ...(record.spec.effort !== "none" ? { effort: record.spec.effort } : {}),
        approvalPolicy: "never",
        sandboxPolicy: sandboxPolicy(record.spec),
        ...(record.spec.outputSchema ? { outputSchema: record.spec.outputSchema } : {}),
      });
      record.currentTurnId = nestedString(result, ["turn", "id"]);
      await completion;
      record.session.state = "idle";
      return { ...record.session };
    } catch (error) {
      record.completion = null;
      record.session.state = "failed";
      throw error;
    }
  }

  async steer(sessionId: string, input: ProviderInput): Promise<void> {
    const record = this.#requireSession(sessionId);
    if (record.transport !== "app-server" || !record.threadId || !record.currentTurnId) {
      throw new MaestroError(
        "STEERING_UNAVAILABLE",
        "Não há um turno Codex ativo para receber steering.",
        { recoverable: true },
      );
    }
    const client = await this.#ensureClient();
    await client.request("turn/steer", {
      threadId: record.threadId,
      expectedTurnId: record.currentTurnId,
      input: codexServerInput(input),
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const record = this.#sessions.get(sessionId);
    if (!record) return;
    if (
      record.transport === "app-server" &&
      record.threadId &&
      record.currentTurnId &&
      this.#client
    ) {
      await this.#client
        .request("turn/interrupt", { threadId: record.threadId, turnId: record.currentTurnId })
        .catch(() => null);
    }
    if (record.currentProcess) await this.#dependencies.supervisor.kill(record.currentProcess.id);
    record.completion?.reject(
      new MaestroError("RUN_CANCELED", "Turno Codex cancelado.", { recoverable: true }),
    );
    record.completion = null;
    record.session.state = "canceled";
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.#sessions.keys()].map((id) => this.cancel(id)));
    this.#sessions.clear();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    await this.#client?.close();
    this.#client = null;
  }

  async #ensureClient(): Promise<CodexAppServerClient> {
    if (this.#client?.running) return this.#client;
    const executable = await this.#executable();
    const client = new CodexAppServerClient(
      this.#dependencies.supervisor,
      executable,
      this.#environment(),
      [...OFFICIAL_SUBSCRIPTION_CONFIG],
      (message) => this.#handleServerRequest(message),
    );
    await client.start();
    this.#unsubscribe = client.onNotification((message) => this.#handleNotification(message));
    this.#client = client;
    return client;
  }

  async #handleNotification(message: JsonRecord): Promise<void> {
    const params = (
      typeof message.params === "object" && message.params !== null ? message.params : {}
    ) as JsonRecord;
    const threadId =
      (typeof params.threadId === "string" ? params.threadId : null) ??
      nestedString(params, ["thread", "id"]);
    const record = [...this.#sessions.values()].find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!record) return;
    const context = {
      runId: record.spec.runId,
      ...(record.spec.taskId ? { taskId: record.spec.taskId } : {}),
      agentId: record.session.id,
      providerId: this.descriptor.id,
      modelId: record.spec.model,
      cwd: record.spec.cwd ?? "",
    };
    const events = normalizeCodexEvent(message, context);
    for (const event of events) await record.sink(event);
    if (message.method === "turn/started") {
      record.currentTurnId = nestedString(params, ["turn", "id"]);
    }
    if (message.method === "turn/completed") {
      record.completion?.resolve();
      record.completion = null;
      record.currentTurnId = null;
    }
    if (message.method === "turn/failed" || message.method === "error") {
      const messageText =
        typeof params.message === "string" ? params.message : "Turno Codex falhou.";
      record.completion?.reject(
        new MaestroError("CODEX_TURN_FAILED", messageText, { recoverable: true }),
      );
      record.completion = null;
      record.currentTurnId = null;
    }
  }

  async #handleServerRequest(message: JsonRecord): Promise<unknown> {
    const method = typeof message.method === "string" ? message.method : "";
    const params = (
      typeof message.params === "object" && message.params !== null ? message.params : {}
    ) as JsonRecord;
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    const record = [...this.#sessions.values()].find(
      (candidate) => candidate.threadId === threadId,
    );
    const approvalId = typeof params.approvalId === "string" ? params.approvalId : randomUUID();
    if (record) {
      const kind = method.includes("fileChange")
        ? "file"
        : method.includes("commandExecution")
          ? "command"
          : "tool";
      const event: NewRunEvent<"approval.required"> = {
        runId: record.spec.runId,
        type: "approval.required",
        data: {
          approvalId,
          kind,
          summary: typeof params.command === "string" ? params.command : method,
          detail: params,
        },
      };
      await record.sink(event);
      const allowed = kind === "file" ? record.spec.permissions.writeWorkspace : false;
      await record.sink({
        runId: record.spec.runId,
        type: "approval.resolved",
        data: { approvalId, decision: allowed ? "approved" : "denied", source: "policy" },
      });
      return { decision: allowed ? "accept" : "decline" };
    }
    return { decision: "decline" };
  }

  async #sendExec(record: CodexSessionRecord, input: ProviderInput): Promise<void> {
    const executable = await this.#executable();
    const parts = inputParts(input);
    const prompt = parts
      .filter((part): part is Extract<ProviderInputPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");
    const effectivePrompt = record.spec.systemPrompt
      ? `<maestro_system_instructions>\n${record.spec.systemPrompt}\n</maestro_system_instructions>\n\n${prompt}`
      : prompt;
    const imageArgs = codexCliImageArgs(parts);
    const restrictedArgs = restrictedExecArgs(record.spec);
    const commandArgs = record.threadId
      ? [
          "exec",
          "resume",
          "--json",
          ...restrictedArgs,
          ...(record.spec.model !== "default" ? ["--model", record.spec.model] : []),
          ...imageArgs,
          record.threadId,
          effectivePrompt,
        ]
      : [
          "exec",
          "--json",
          ...restrictedArgs,
          "--sandbox",
          record.spec.permissions.writeWorkspace ? "workspace-write" : "read-only",
          ...(record.spec.cwd ? ["--cd", record.spec.cwd] : []),
          ...(record.spec.model !== "default" ? ["--model", record.spec.model] : []),
          ...imageArgs,
          "--skip-git-repo-check",
          effectivePrompt,
        ];
    const args = [...OFFICIAL_SUBSCRIPTION_CONFIG, ...commandArgs];
    const managed = this.#dependencies.supervisor.spawn({
      executable,
      args,
      ...(record.spec.cwd ? { cwd: record.spec.cwd } : {}),
      env: this.#environment(),
      label: "Codex exec",
    });
    record.currentProcess = managed;
    let stderr = "";
    managed.child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_000);
    });
    const lines = createInterface({ input: managed.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const native = JSON.parse(line) as JsonRecord;
        if (native.type === "thread.started" && typeof native.thread_id === "string") {
          record.threadId = native.thread_id;
          record.session.nativeSessionId = native.thread_id;
        }
        const events = normalizeCodexEvent(native, {
          runId: record.spec.runId,
          ...(record.spec.taskId ? { taskId: record.spec.taskId } : {}),
          agentId: record.session.id,
          providerId: this.descriptor.id,
          modelId: record.spec.model,
          cwd: record.spec.cwd ?? "",
        });
        for (const event of events) void record.sink(event);
      } catch {
        // A future CLI may add non-JSON diagnostics; keep the session alive.
      }
    });
    await new Promise<void>((resolve, reject) => {
      managed.child.once("error", (error) =>
        reject(new MaestroError("CODEX_EXEC_FAILED", errorMessage(error), { recoverable: true })),
      );
      managed.child.once("exit", (code, signal) => {
        record.currentProcess = null;
        if (code === 0) resolve();
        else
          reject(
            new MaestroError(
              "CODEX_EXEC_FAILED",
              stderr.trim() || `Codex exec encerrou (${code ?? signal ?? "unknown"}).`,
              { recoverable: true },
            ),
          );
      });
    });
    record.session.state = "idle";
  }

  #requireSession(sessionId: string): CodexSessionRecord {
    const record = this.#sessions.get(sessionId);
    if (!record) throw new MaestroError("SESSION_NOT_FOUND", "Sessão Codex não encontrada.");
    return record;
  }
}
