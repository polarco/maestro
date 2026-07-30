import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  analysisResultSchema,
  type AnalysisResult,
  type Conversation,
  type Effort,
  type Message,
  type ModelCapability,
  type ModelSelection,
  type NewRunEvent,
  type PlanSpec,
  type ProviderChatMessage,
  type ProviderInput,
  type ProviderInputPart,
  type ProviderEventSink,
  type ProviderSession,
  type ProviderSessionSpec,
  type Run,
  type RunDetail,
  type RunEvent,
  type RunSpec,
  type RunState,
  type SendMessageInput,
  type SendMessageResult,
  type TaskSpec,
  type WorkspaceRoot,
} from "@maestro/contracts";
import type { ContextAssetRecord, MaestroRepository } from "@maestro/database";
import {
  assertCommandAllowed,
  assertPathWithinRoots,
  DagScheduler,
  errorMessage,
  isTerminalRunState,
  MaestroError,
  planToMarkdown,
  routeModel,
  validateDag,
} from "@maestro/core";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProcessSupervisor } from "./process-supervisor.js";
import { GitService, type TaskWorktree } from "./git-service.js";
import type { ContextService } from "./context-service.js";

const generatedTaskSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  role: z.enum(["implementer", "tester", "reviewer", "researcher"]),
  dependencies: z.array(z.string()).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  validationCommands: z
    .array(
      z.object({
        executable: z.string().min(1),
        args: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  recommendedModel: z
    .object({ providerId: z.string(), modelId: z.string(), effort: z.string().optional() })
    .optional(),
});

const generatedPlanSchema = z.object({
  summary: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  tasks: z.array(generatedTaskSchema).min(1).max(16),
});

type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objective: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    requiredCapabilities: { type: "array", items: { type: "string" } },
    recommendedPlanner: {
      type: "object",
      additionalProperties: false,
      properties: {
        providerId: { type: "string" },
        modelId: { type: "string" },
        effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max"] },
      },
      required: ["providerId", "modelId"],
    },
    rationale: { type: "string" },
  },
  required: ["objective", "risks", "requiredCapabilities", "recommendedPlanner", "rationale"],
} satisfies Record<string, unknown>;

const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    successCriteria: { type: "array", items: { type: "string" }, minItems: 1 },
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          role: { type: "string", enum: ["implementer", "tester", "reviewer", "researcher"] },
          dependencies: { type: "array", items: { type: "string" } },
          successCriteria: { type: "array", items: { type: "string" }, minItems: 1 },
          validationCommands: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                executable: { type: "string" },
                args: { type: "array", items: { type: "string" } },
              },
              required: ["executable", "args"],
            },
          },
          recommendedModel: {
            type: "object",
            additionalProperties: false,
            properties: {
              providerId: { type: "string" },
              modelId: { type: "string" },
              effort: { type: "string" },
            },
            required: ["providerId", "modelId"],
          },
        },
        required: [
          "key",
          "title",
          "description",
          "role",
          "dependencies",
          "successCriteria",
          "validationCommands",
        ],
      },
    },
  },
  required: ["summary", "assumptions", "risks", "successCriteria", "tasks"],
} satisfies Record<string, unknown>;

interface ActiveProviderSession {
  providerId: string;
  connectionId?: string;
  sessionId: string;
}

function jsonFromModel(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function safeTaskId(key: string, index: number): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `task-${index + 1}-${(slug || "work").slice(0, 48)}`;
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 56 ? `${normalized.slice(0, 53)}…` : normalized || "Nova conversa";
}

function inputText(input: ProviderInput): string {
  return typeof input === "string"
    ? input
    : input
        .filter(
          (part): part is Extract<ProviderInputPart, { type: "text" }> => part.type === "text",
        )
        .map((part) => part.text)
        .join("\n\n");
}

function mergeInputs(inputs: readonly ProviderInput[]): ProviderInputPart[] {
  return inputs.flatMap((input) =>
    typeof input === "string" ? [{ type: "text" as const, text: input }] : input,
  );
}

export class OrchestrationService {
  readonly #repository: MaestroRepository;
  readonly #providers: ProviderRegistry;
  readonly #supervisor: ProcessSupervisor;
  readonly #git: GitService;
  readonly #context: ContextService;
  readonly #emit: (event: RunEvent) => void;
  readonly #chatSandbox: string;
  readonly #controllers = new Map<string, AbortController>();
  readonly #activeSessions = new Map<string, Set<ActiveProviderSession>>();
  readonly #activeChats = new Map<string, { projectId: string; count: number }>();

  constructor(input: {
    repository: MaestroRepository;
    providers: ProviderRegistry;
    supervisor: ProcessSupervisor;
    userDataDirectory: string;
    context: ContextService;
    emit: (event: RunEvent) => void;
  }) {
    this.#repository = input.repository;
    this.#providers = input.providers;
    this.#supervisor = input.supervisor;
    this.#git = new GitService(input.supervisor, input.userDataDirectory);
    this.#context = input.context;
    this.#chatSandbox = path.join(input.userDataDirectory, "chat-sandbox");
    this.#emit = input.emit;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const conversation = await this.#repository.getConversation(input.conversationId);
    const root = await this.#repository.getWorkspaceRoot(input.workspaceRootId);
    if (root.projectId !== conversation.projectId) {
      throw new MaestroError(
        "WORKSPACE_PROJECT_MISMATCH",
        "A raiz escolhida não pertence à conversa.",
      );
    }
    if (input.sessionKind === "pty") {
      throw new MaestroError(
        "PTY_MESSAGE_UNSUPPORTED",
        "Sessões PTY são abertas na área Terminal.",
        { recoverable: true },
      );
    }
    const contextAssets = await this.#context.resolveItems(conversation.id, input.contextItems);
    if (
      contextAssets.some((asset) => asset.kind === "image" || asset.metadata.scannedPdf === true)
    ) {
      const selected = this.#providers.resolve(
        {
          providerId: input.providerId,
          modelId: input.modelId,
          ...(input.providerConnectionId ? { connectionId: input.providerConnectionId } : {}),
          effort: input.effort,
        },
        input.mode === "maestro" ? "orchestrator" : input.mode === "agent" ? "direct" : "chat",
      ).selection;
      if (!this.#modelCapability(selected).vision)
        throw new MaestroError(
          "MODEL_VISION_REQUIRED",
          "Os itens selecionados exigem um modelo com visão. Escolha outro modelo antes de enviar.",
          { recoverable: true },
        );
    }
    const effectiveContent =
      input.content.trim() || (contextAssets.length > 0 ? "Analise os itens anexados" : "");
    const userMessage = await this.#repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: input.content,
      contextAssetIds: contextAssets.map((asset) => asset.id),
    });
    const assistantMessage = await this.#repository.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "streaming",
    });
    const updatedConversation = await this.#repository.updateConversation(conversation.id, {
      ...(conversation.title === "Nova conversa"
        ? { title: titleFromPrompt(input.content || contextAssets[0]?.name || effectiveContent) }
        : {}),
      mode: input.mode,
      sessionKind: input.sessionKind,
      providerId: input.providerId,
      providerConnectionId: input.providerConnectionId ?? null,
      modelId: input.modelId,
      workspaceRootId: input.workspaceRootId,
      ...(conversation.providerId !== input.providerId ||
      conversation.providerConnectionId !== (input.providerConnectionId ?? null) ||
      conversation.modelId !== input.modelId ||
      conversation.mode !== input.mode ||
      conversation.sessionKind !== input.sessionKind ||
      conversation.workspaceRootId !== input.workspaceRootId
        ? { providerSessionId: null }
        : {}),
    });

    if (input.mode === "chat") {
      this.#trackChat(updatedConversation);
      void this.#runChat(
        updatedConversation,
        root,
        { ...input, content: effectiveContent },
        assistantMessage,
        contextAssets,
      )
        .catch((error) => this.#failMessage(assistantMessage.id, error))
        .finally(() => this.#untrackChat(updatedConversation.id));
      return { conversation: updatedConversation, userMessage, assistantMessage, run: null };
    }

    const run = await this.#createRun(
      updatedConversation,
      root,
      { ...input, content: effectiveContent },
      contextAssets,
    );
    await this.#repository.updateMessage(assistantMessage.id, { runId: run.id });
    if (input.mode === "maestro") {
      void this.#planRun(run.id, assistantMessage.id).catch((error) =>
        this.#failRun(run.id, assistantMessage.id, error),
      );
    } else {
      void this.#runDirect(run.id, assistantMessage.id).catch((error) =>
        this.#failRun(run.id, assistantMessage.id, error),
      );
    }
    return {
      conversation: updatedConversation,
      userMessage,
      assistantMessage: { ...assistantMessage, runId: run.id },
      run,
    };
  }

  hasActiveConversation(conversationId: string): boolean {
    return (this.#activeChats.get(conversationId)?.count ?? 0) > 0;
  }

  hasActiveProject(projectId: string): boolean {
    return [...this.#activeChats.values()].some(
      (active) => active.projectId === projectId && active.count > 0,
    );
  }

  async approve(runId: string, planVersion: number): Promise<RunDetail> {
    const run = await this.#repository.getRun(runId);
    if (run.state !== "awaiting_approval") {
      throw new MaestroError(
        "RUN_NOT_AWAITING_APPROVAL",
        "A execução não está aguardando aprovação.",
        { recoverable: true },
      );
    }
    const { plan } = await this.#repository.getPlan(runId, planVersion);
    await this.#repository.approvePlan(runId, planVersion);
    await this.#append({
      runId,
      type: "plan.approved",
      data: { version: planVersion, approvedBy: "user" },
    });
    await this.#repository.createTaskRuns(runId, planVersion, plan.tasks);
    await this.#transition(runId, "queued", "Plano aprovado pelo usuário.");
    void this.#executeRun(runId).catch((error) => this.#failRun(runId, null, error));
    return this.#repository.getRunDetail(runId);
  }

  async revise(runId: string, planVersion: number, comment: string): Promise<PlanSpec> {
    const run = await this.#repository.getRun(runId);
    if (run.state !== "awaiting_approval") {
      throw new MaestroError(
        "RUN_NOT_AWAITING_APPROVAL",
        "A execução não aceita revisão neste estado.",
        { recoverable: true },
      );
    }
    const normalized = comment.trim();
    if (!normalized)
      throw new MaestroError("EMPTY_REVISION", "Descreva o que deve mudar no plano.", {
        recoverable: true,
      });
    await this.#append({
      runId,
      type: "plan.revision_requested",
      data: { version: planVersion, comment: normalized },
    });
    await this.#transition(runId, "planning", "Revisão solicitada pelo usuário.");
    const plan = await this.#generatePlan(run, planVersion + 1, normalized);
    const markdown = planToMarkdown(plan);
    await this.#repository.addPlan(plan, markdown);
    await this.#append({ runId, type: "plan.created", data: { plan, markdown } });
    await this.#transition(
      runId,
      "awaiting_approval",
      `Plano v${plan.version} pronto para revisão.`,
    );
    return plan;
  }

  async cancel(runId: string): Promise<RunDetail> {
    const run = await this.#repository.getRun(runId);
    if (isTerminalRunState(run.state)) return this.#repository.getRunDetail(runId);
    this.#controllers.get(runId)?.abort();
    const sessions = [...(this.#activeSessions.get(runId) ?? [])];
    await Promise.allSettled(
      sessions.map((item) =>
        this.#providers.get(item.providerId, item.connectionId).cancel(item.sessionId),
      ),
    );
    await this.#transition(runId, "canceled", "Cancelado pelo usuário.");
    return this.#repository.getRunDetail(runId);
  }

  async recover(): Promise<void> {
    const active = await this.#repository.listRuns({
      states: ["analyzing", "planning", "queued", "running", "validating", "integrating"],
    });
    for (const run of active) {
      if (run.state === "queued") {
        void this.#executeRun(run.id).catch((error) => this.#failRun(run.id, null, error));
        continue;
      }
      const message =
        "O aplicativo foi encerrado durante esta execução. O histórico e branches foram preservados; inicie uma nova execução para retomar com segurança.";
      await this.#transition(run.id, "failed", message, { error: message });
    }
  }

  async dispose(): Promise<void> {
    for (const controller of this.#controllers.values()) controller.abort();
    const sessions = [...this.#activeSessions.values()].flatMap((items) => [...items]);
    await Promise.allSettled(
      sessions.map((item) =>
        this.#providers.get(item.providerId, item.connectionId).cancel(item.sessionId),
      ),
    );
    this.#controllers.clear();
    this.#activeSessions.clear();
  }

  async #createRun(
    conversation: Conversation,
    root: WorkspaceRoot,
    input: SendMessageInput,
    contextAssets: readonly ContextAssetRecord[],
  ): Promise<Run> {
    const settings = await this.#repository.getSettings();
    const commands = await this.#discoverValidationCommands(root.canonicalPath);
    const spec: RunSpec = {
      id: ulid(),
      mode: input.mode,
      projectId: conversation.projectId,
      conversationId: conversation.id,
      workspaceRootIds: [root.id],
      prompt: input.content,
      contextAssetIds: contextAssets.map((asset) => asset.id),
      requestedModel: {
        providerId: input.providerId,
        ...(input.providerConnectionId ? { connectionId: input.providerConnectionId } : {}),
        modelId: input.modelId,
        effort: input.effort,
      },
      roleModels: settings.defaultModels,
      permissions: {
        readWorkspace: true,
        writeWorkspace: input.mode !== "chat",
        runCommands: input.mode !== "chat",
        network: false,
        allowedCommands: [...new Set(commands.map((command) => path.basename(command.executable)))],
        deniedCommands: ["sudo", "su", "ssh", "scp", "rsync", "curl", "wget", "docker", "kubectl"],
      },
      budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 60, maxTurns: 24 },
      concurrency: settings.globalConcurrency,
      createdAt: new Date().toISOString(),
    };
    const initialState: RunState = input.mode === "maestro" ? "analyzing" : "running";
    const run = await this.#repository.createRun(spec, initialState);
    await this.#append({
      runId: run.id,
      type: "run.created",
      data: { mode: input.mode, promptPreview: input.content.slice(0, 180) },
    });
    await this.#append({
      runId: run.id,
      type: "run.state",
      data: { from: null, to: initialState },
    });
    return run;
  }

  async #runChat(
    conversation: Conversation,
    _root: WorkspaceRoot,
    input: SendMessageInput,
    assistantMessage: Message,
    contextAssets: readonly ContextAssetRecord[],
  ): Promise<void> {
    const resolved = this.#providers.resolve(
      {
        providerId: input.providerId,
        ...(input.providerConnectionId ? { connectionId: input.providerConnectionId } : {}),
        modelId: input.modelId,
        effort: input.effort,
      },
      "chat",
    );
    const { adapter, selection, connection } = resolved;
    if (!connection)
      throw new MaestroError("PAID_API_BLOCKED", "Chat usa somente contas por assinatura.");
    const capability = this.#modelCapability(selection);
    const compiled = await this.#context.compile(contextAssets, input.content, {
      vision: capability.vision,
      contextWindow: capability.contextWindow,
    });
    const history = await this.#repository.listMessages(conversation.id);
    const messages = history.filter(
      (message) =>
        message.id !== assistantMessage.id &&
        (message.role === "user" || message.role === "assistant" || message.role === "system"),
    );
    await mkdir(this.#chatSandbox, { recursive: true, mode: 0o700 });
    let content = "";
    const sink: ProviderEventSink = (event) => {
      if (event.type === "message.delta") {
        content += event.data.delta;
        this.#emitEphemeralMessage(assistantMessage.id, event.data.delta);
      }
      if (event.type === "message.completed") {
        content = event.data.content || content;
      }
    };
    const sessionSpec: ProviderSessionSpec = {
      runId: `chat:${assistantMessage.id}`,
      connectionId: connection.id,
      mode: "chat",
      cwd: this.#chatSandbox,
      workspaceRoots: [],
      model: selection.modelId,
      effort: selection.effort ?? "medium",
      permissions: {
        readWorkspace: false,
        writeWorkspace: false,
        runCommands: false,
        network: false,
        allowedCommands: [],
        deniedCommands: ["sudo", "su", "ssh", "curl", "wget"],
      },
      budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 30, maxTurns: 8 },
      tools: [],
      systemPrompt:
        "Converse de forma útil, sem acessar arquivos, workspace, terminal ou ferramentas. Não execute ações externas.",
    };
    const reconstruct = async (): Promise<ProviderInputPart[]> => {
      const parts: ProviderInputPart[] = [];
      const prior = messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages;
      for (const message of prior) {
        const role = message.role.toUpperCase();
        if (message.role === "user" && message.contextAssets.length > 0) {
          const records = await this.#repository.getContextAssets(
            message.contextAssets.map((asset) => asset.id),
          );
          try {
            const restored = await this.#context.compile(
              records,
              `${role}: ${message.content || "Analise os itens anexados"}`,
              { vision: capability.vision, contextWindow: capability.contextWindow },
            );
            parts.push(...restored.parts);
          } catch {
            const snapshots = records
              .map((record) => {
                const text = record.transcription ?? record.extractedText ?? "";
                return `### ${record.name}\n${text || "[contexto visual indisponível nesta reconstrução]"}`;
              })
              .join("\n\n");
            parts.push({
              type: "text",
              text: `${role}: ${message.content || "Analise os itens anexados"}\n\n<contexto_historico_recuperado>\n${snapshots}\n</contexto_historico_recuperado>`,
            });
          }
        } else if (message.content)
          parts.push({ type: "text", text: `${role}: ${message.content}` });
      }
      parts.push(...compiled.parts);
      return parts;
    };
    let session = conversation.providerSessionId
      ? await adapter.resumeSession(
          { ...sessionSpec, resumeSessionId: conversation.providerSessionId },
          sink,
        )
      : await adapter.createSession(sessionSpec, sink);
    this.#providers.markSessionStarted(connection.id);
    try {
      let completed: ProviderSession;
      try {
        completed = await adapter.send(
          session.id,
          conversation.providerSessionId ? compiled.parts : await reconstruct(),
        );
      } catch (error) {
        if (!conversation.providerSessionId) throw error;
        await adapter.cancel(session.id).catch(() => null);
        content = "";
        session = await adapter.createSession(sessionSpec, sink);
        completed = await adapter.send(session.id, await reconstruct());
      }
      if (completed.nativeSessionId)
        await this.#repository.updateConversation(conversation.id, {
          providerSessionId: completed.nativeSessionId,
          providerConnectionId: connection.id,
        });
      await this.#repository.updateMessage(assistantMessage.id, {
        content,
        status: "completed",
      });
      this.#emitEphemeralMessageComplete(assistantMessage.id, content);
    } finally {
      this.#providers.markSessionEnded(connection.id);
    }
  }

  async #planRun(runId: string, assistantMessageId: string): Promise<void> {
    const run = await this.#repository.getRun(runId);
    const root = await this.#repository.getWorkspaceRoot(run.spec.workspaceRootIds[0]!);
    const analysis = await this.#analyze(run, root);
    await this.#append({ runId, type: "analysis.completed", data: { analysis } });
    await this.#transition(runId, "planning", "Análise estruturada concluída.");
    const plan = await this.#generatePlan(run, 1, null, analysis);
    const markdown = planToMarkdown(plan);
    await this.#repository.addPlan(plan, markdown);
    await this.#append({ runId, type: "plan.created", data: { plan, markdown } });
    await this.#repository.updateMessage(assistantMessageId, {
      content: `Plano v${plan.version} pronto para revisão. ${plan.summary}`,
      status: "completed",
    });
    await this.#transition(
      runId,
      "awaiting_approval",
      "Plano pronto. Nenhuma escrita foi realizada.",
    );
  }

  async #analyze(run: Run, root: WorkspaceRoot): Promise<AnalysisResult> {
    const settings = await this.#repository.getSettings();
    const summaries = this.#providers.listCached();
    const requiresVision = await this.#runRequiresVision(run);
    const suggested =
      run.spec.roleModels.maestro ??
      settings.defaultModels.maestro ??
      settings.defaultModels.analyst ??
      settings.defaultModels.planner ??
      null;
    try {
      const route = routeModel({
        role: "analyst",
        providers: summaries,
        requirements: { chat: true, structuredOutput: true, vision: requiresVision },
        suggested,
        preferredProviderIds: ["anthropic", "openai-compatible", "codex", "claude-code"],
      });
      await this.#append({
        runId: run.id,
        type: "route.selected",
        data: { role: "analyst", selection: route.selection, rationale: route.rationale },
      });
      const content = await this.#generateStructured(
        run,
        root,
        route.selection,
        [
          {
            role: "system",
            content:
              "Você é o analista do Maestro. Produza apenas análise estruturada e concisa: objetivo, riscos observáveis, capacidades necessárias e recomendação de planejador. Não revele raciocínio interno nem proponha executar ferramentas.",
          },
          { role: "user", content: run.spec.prompt },
        ],
        ANALYSIS_JSON_SCHEMA,
      );
      return analysisResultSchema.parse(jsonFromModel(content));
    } catch (error) {
      await this.#append({
        runId: run.id,
        type: "log",
        data: {
          level: "warn",
          message: `Análise por modelo indisponível; usando análise local: ${errorMessage(error)}`,
        },
      });
      const planner = suggested ??
        this.#firstSelection(summaries) ?? {
          providerId: "codex",
          modelId: "default",
          effort: "medium" as const,
        };
      return {
        objective: run.spec.prompt,
        risks: [
          "Requisitos implícitos podem exigir ajuste após a primeira validação.",
          "Alterações paralelas podem produzir conflitos de integração.",
        ],
        requiredCapabilities: ["coding", "tools", "structured-output", "validation"],
        recommendedPlanner: planner,
        rationale: "Fallback local baseado no modo Maestro e nos provedores disponíveis.",
      };
    }
  }

  async #generatePlan(
    run: Run,
    version: number,
    revisionComment: string | null,
    knownAnalysis?: AnalysisResult,
  ): Promise<PlanSpec> {
    const root = await this.#repository.getWorkspaceRoot(run.spec.workspaceRootIds[0]!);
    const requiresVision = await this.#runRequiresVision(run);
    const analysis = knownAnalysis ?? {
      objective: run.spec.prompt,
      risks: [],
      requiredCapabilities: ["coding", "validation"],
      recommendedPlanner: run.spec.roleModels.planner ??
        run.spec.requestedModel ?? {
          providerId: "anthropic",
          modelId: "claude-fable-5",
          effort: "high",
        },
      rationale: "Revisão do plano existente.",
    };
    const summaries = this.#providers.listCached();
    const suggested = run.spec.roleModels.maestro ?? analysis.recommendedPlanner;
    let generated: GeneratedPlan;
    try {
      const route = routeModel({
        role: "planner",
        providers: summaries,
        requirements: { chat: true, structuredOutput: true, vision: requiresVision },
        fixed: version === 1 ? run.spec.requestedModel : null,
        suggested,
        preferredProviderIds: ["anthropic", "codex", "claude-code", "openai-compatible"],
      });
      await this.#append({
        runId: run.id,
        type: "route.selected",
        data: { role: "planner", selection: route.selection, rationale: route.rationale },
      });
      const git = await this.#git.inspect(root.canonicalPath);
      const content = await this.#generateStructured(
        run,
        root,
        route.selection,
        [
          {
            role: "system",
            content:
              "Você é o planejador do Maestro. Gere um DAG executável, com tarefas pequenas, dependências explícitas, critérios verificáveis e comandos como executable + args (nunca shell strings). Inclua implementação, validação e revisão quando fizer sentido. Não execute nem edite nada.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request: run.spec.prompt,
              analysis,
              workspace: { name: root.displayName, git: git.isGit, dirty: git.dirty },
              revisionComment,
            }),
          },
        ],
        PLAN_JSON_SCHEMA,
      );
      generated = generatedPlanSchema.parse(jsonFromModel(content));
    } catch (error) {
      await this.#append({
        runId: run.id,
        type: "log",
        data: {
          level: "warn",
          message: `Planejamento por modelo indisponível; usando plano local: ${errorMessage(error)}`,
        },
      });
      generated = await this.#localPlan(run, root, revisionComment);
    }
    try {
      return await this.#materializePlan(run, root, version, generated, summaries);
    } catch (error) {
      await this.#append({
        runId: run.id,
        type: "log",
        data: {
          level: "warn",
          message: `DAG gerado inválido; usando plano local: ${errorMessage(error)}`,
        },
      });
      const fallback = await this.#localPlan(run, root, revisionComment);
      return this.#materializePlan(run, root, version, fallback, summaries);
    }
  }

  async #materializePlan(
    run: Run,
    root: WorkspaceRoot,
    version: number,
    generated: GeneratedPlan,
    summaries: ReturnType<ProviderRegistry["listCached"]>,
  ): Promise<PlanSpec> {
    const git = await this.#git.inspect(root.canonicalPath);
    const requiresVision = await this.#runRequiresVision(run);
    const keyToId = new Map<string, string>();
    generated.tasks.forEach((task, index) => keyToId.set(task.key, safeTaskId(task.key, index)));
    const tasks: TaskSpec[] = generated.tasks.map((task) => {
      const id = keyToId.get(task.key)!;
      const suggestedEffort = task.recommendedModel?.effort;
      const suggested: ModelSelection | null = task.recommendedModel
        ? {
            providerId: task.recommendedModel.providerId,
            modelId: task.recommendedModel.modelId,
            ...(suggestedEffort &&
            ["none", "low", "medium", "high", "xhigh", "max"].includes(suggestedEffort)
              ? { effort: suggestedEffort as Effort }
              : {}),
          }
        : (run.spec.roleModels[task.role] ?? run.spec.roleModels.implementer ?? null);
      let selection: ModelSelection;
      try {
        selection = routeModel({
          role: task.role,
          providers: summaries.filter((summary) => summary.descriptor.kind === "cli"),
          requirements: {
            coding: true,
            tools: task.role !== "reviewer",
            vision: requiresVision,
          },
          suggested,
          preferredProviderIds: ["codex", "claude-code"],
        }).selection;
      } catch (error) {
        if (requiresVision) throw error;
        selection = suggested ?? { providerId: "codex", modelId: "default", effort: "medium" };
      }
      selection = this.#providers.prepareSubscription(selection);
      return {
        id,
        title: task.title,
        description: task.description,
        role: task.role,
        dependencies: task.dependencies
          .map((dependency) => keyToId.get(dependency))
          .filter((dependency): dependency is string => Boolean(dependency)),
        workspaceRootId: root.id,
        workspaceStrategy: git.isGit
          ? task.role === "reviewer"
            ? "shared-readonly"
            : "worktree"
          : "single-writer",
        model: selection,
        tools:
          task.role === "reviewer"
            ? ["Read", "Grep", "Glob"]
            : ["Read", "Grep", "Glob", "Edit", "Write"],
        validationCommands: task.validationCommands.map((command) => ({
          ...command,
          timeoutMs: 600_000,
        })),
        successCriteria: task.successCriteria,
        estimatedMinutes: task.role === "implementer" ? 20 : 10,
      };
    });
    const dag = validateDag(tasks);
    if (!dag.valid) {
      throw new MaestroError("INVALID_GENERATED_PLAN", dag.errors.join("; "), {
        recoverable: true,
      });
    }
    return {
      id: ulid(),
      runId: run.id,
      version,
      summary: generated.summary,
      assumptions: generated.assumptions,
      risks: generated.risks,
      successCriteria: generated.successCriteria,
      tasks,
      createdAt: new Date().toISOString(),
    };
  }

  async #localPlan(
    run: Run,
    root: WorkspaceRoot,
    revisionComment: string | null,
  ): Promise<GeneratedPlan> {
    const commands = await this.#discoverValidationCommands(root.canonicalPath);
    return {
      summary: revisionComment
        ? `Plano revisado para ${titleFromPrompt(run.spec.prompt)}. Ajuste solicitado: ${revisionComment}`
        : `Implementar e validar: ${titleFromPrompt(run.spec.prompt)}`,
      assumptions: [
        "A raiz selecionada contém todo o código necessário.",
        "As validações existentes no projeto são a fonte de verdade.",
      ],
      risks: [
        "Mudanças locais serão preservadas e podem impedir o fast-forward automático.",
        "Conflitos entre tarefas serão mantidos em um branch de integração recuperável.",
      ],
      successCriteria: [
        "A solicitação do usuário está implementada.",
        "As validações disponíveis concluem sem regressões.",
        "O diff final passa por revisão.",
      ],
      tasks: [
        {
          key: "implement",
          title: "Implementar a solicitação",
          description: run.spec.prompt,
          role: "implementer",
          dependencies: [],
          successCriteria: [
            "O comportamento solicitado está presente.",
            "As mudanças permanecem dentro do workspace autorizado.",
          ],
          validationCommands: [],
        },
        {
          key: "validate",
          title: "Validar a implementação",
          description:
            "Executar as verificações do projeto, investigar falhas e corrigir regressões estritamente relacionadas.",
          role: "tester",
          dependencies: ["implement"],
          successCriteria: [
            commands.length > 0
              ? "Todos os comandos de validação passam."
              : "A implementação é inspecionada e validada manualmente.",
          ],
          validationCommands: commands.map(({ executable, args }) => ({ executable, args })),
        },
        {
          key: "review",
          title: "Revisar o diff final",
          description:
            "Revisar segurança, aderência aos critérios e riscos de regressão; registrar achados objetivos.",
          role: "reviewer",
          dependencies: ["validate"],
          successCriteria: [
            "Nenhum achado bloqueante permanece.",
            "O diff respeita o escopo aprovado.",
          ],
          validationCommands: [],
        },
      ],
    };
  }

  async #generateStructured(
    run: Run,
    root: WorkspaceRoot,
    selection: ModelSelection,
    messages: ProviderChatMessage[],
    outputSchema: Record<string, unknown>,
  ): Promise<string> {
    const resolved = this.#providers.resolve(selection, "orchestrator");
    const { adapter, connection } = resolved;
    selection = resolved.selection;
    let effectiveMessages = messages;
    if (run.spec.contextAssetIds.length > 0) {
      let lastUserIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "user") {
          lastUserIndex = index;
          break;
        }
      }
      if (lastUserIndex >= 0) {
        const records = await this.#repository.getContextAssets(run.spec.contextAssetIds);
        const capability = this.#modelCapability(selection);
        const compiled = await this.#context.compile(
          records,
          inputText(messages[lastUserIndex]!.content),
          { vision: capability.vision, contextWindow: capability.contextWindow },
        );
        effectiveMessages = messages.map((message, index) =>
          index === lastUserIndex ? { ...message, content: compiled.parts } : message,
        );
      }
    }
    if (adapter.chat) {
      const result = await adapter.chat({
        selection,
        messages: effectiveMessages,
        ...(selection.effort ? { effort: selection.effort } : {}),
        maxTokens: 12_000,
        outputSchema,
      });
      return result.content;
    }

    let content = "";
    const sink: ProviderEventSink = async (event) => {
      if (event.type === "message.delta") content += event.data.delta;
      if (event.type === "message.completed") content = event.data.content || content;
      if (event.type !== "message.delta" && event.type !== "message.completed")
        await this.#append(event);
    };
    const spec: ProviderSessionSpec = {
      runId: run.id,
      ...(connection ? { connectionId: connection.id } : {}),
      mode: "maestro",
      cwd: root.canonicalPath,
      workspaceRoots: [root.canonicalPath],
      model: selection.modelId,
      effort: selection.effort ?? "medium",
      permissions: {
        readWorkspace: true,
        writeWorkspace: false,
        runCommands: false,
        network: false,
        allowedCommands: [],
        deniedCommands: ["sudo", "su", "ssh", "curl", "wget"],
      },
      budget: { maxTokens: 20_000, maxCostUsd: null, maxDurationMinutes: 20, maxTurns: 4 },
      tools: [],
      systemPrompt: effectiveMessages
        .filter((message) => message.role === "system")
        .map((message) => inputText(message.content))
        .join("\n\n"),
      outputSchema,
    };
    const session = await adapter.createSession(spec, sink);
    this.#trackSession(run.id, selection.providerId, session.id, connection?.id);
    this.#providers.markSessionStarted(connection?.id);
    try {
      await adapter.send(
        session.id,
        mergeInputs(
          effectiveMessages
            .filter((message) => message.role !== "system")
            .map((message) => message.content),
        ),
      );
    } finally {
      this.#untrackSession(run.id, selection.providerId, session.id, connection?.id);
      this.#providers.markSessionEnded(connection?.id);
    }
    if (!content.trim())
      throw new MaestroError(
        "EMPTY_STRUCTURED_OUTPUT",
        `${adapter.descriptor.name} não retornou conteúdo estruturado.`,
        { recoverable: true },
      );
    return content;
  }

  async #runDirect(runId: string, assistantMessageId: string): Promise<void> {
    const run = await this.#repository.getRun(runId);
    const root = await this.#repository.getWorkspaceRoot(run.spec.workspaceRootIds[0]!);
    const selection = run.spec.requestedModel;
    if (!selection)
      throw new MaestroError("MODEL_REQUIRED", "Escolha um modelo para o agente direto.", {
        recoverable: true,
      });
    const resolved = this.#providers.resolve(selection, "direct");
    const { adapter, connection } = resolved;
    const resolvedSelection = resolved.selection;
    const contextAssets = await this.#repository.getContextAssets(run.spec.contextAssetIds);
    const compiled = await this.#context.compile(contextAssets, run.spec.prompt, {
      vision: this.#modelCapability(resolvedSelection).vision,
      contextWindow: this.#modelCapability(resolvedSelection).contextWindow,
    });
    let content = "";
    const sink = this.#messageSink(run.id, assistantMessageId, (value) => {
      content = value;
    });
    const sessionSpec: ProviderSessionSpec = {
      runId,
      connectionId: connection!.id,
      mode: "agent",
      cwd: root.canonicalPath,
      workspaceRoots: [root.canonicalPath],
      model: resolvedSelection.modelId,
      effort: resolvedSelection.effort ?? "medium",
      permissions: run.spec.permissions,
      budget: run.spec.budget,
      tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    };
    const conversation = await this.#repository.getConversation(run.conversationId);
    const session = conversation.providerSessionId
      ? await adapter.resumeSession(
          { ...sessionSpec, resumeSessionId: conversation.providerSessionId },
          sink,
        )
      : await adapter.createSession(sessionSpec, sink);
    this.#trackSession(run.id, resolvedSelection.providerId, session.id, connection!.id);
    this.#providers.markSessionStarted(connection!.id);
    try {
      const completed = await adapter.send(session.id, compiled.parts);
      if (completed.nativeSessionId) {
        await this.#repository.updateConversation(run.conversationId, {
          providerSessionId: completed.nativeSessionId,
          providerConnectionId: connection!.id,
        });
      }
      await this.#repository.updateMessage(assistantMessageId, { content, status: "completed" });
      await this.#transition(run.id, "completed", "Agente direto concluído.");
    } finally {
      this.#untrackSession(run.id, resolvedSelection.providerId, session.id, connection!.id);
      this.#providers.markSessionEnded(connection!.id);
    }
  }

  async #executeRun(runId: string): Promise<void> {
    if (this.#controllers.has(runId)) return;
    const controller = new AbortController();
    this.#controllers.set(runId, controller);
    try {
      const run = await this.#repository.getRun(runId);
      if (run.state !== "queued") return;
      const version = run.currentPlanVersion;
      if (!version)
        throw new MaestroError("APPROVED_PLAN_MISSING", "A execução não possui plano aprovado.");
      const { plan, status } = await this.#repository.getPlan(runId, version);
      if (status !== "approved")
        throw new MaestroError(
          "PLAN_NOT_APPROVED",
          "Nenhuma escrita é permitida sem plano aprovado.",
        );
      const roots = await Promise.all(
        run.spec.workspaceRootIds.map((id) => this.#repository.getWorkspaceRoot(id)),
      );
      const root = roots[0]!;
      const gitContext = await this.#git.beginRun(runId, root.canonicalPath);
      await this.#transition(runId, "running", "DAG liberado para execução.");
      const taskCommits = new Map<string, string>();
      const taskLineages = new Map<string, string[]>();
      const scheduler = new DagScheduler({
        globalConcurrency: run.spec.concurrency,
        providerConcurrency: this.#providerConcurrency(),
        signal: controller.signal,
        onState: async (task, from, to, detail) => {
          await this.#repository.updateTaskRun(runId, task.id, {
            state: to,
            ...(detail ? { error: detail } : {}),
          });
          await this.#append({
            runId,
            type: "task.state",
            data: { taskId: task.id, from, to, ...(detail ? { detail } : {}) },
          });
        },
      });
      const result = await scheduler.run(plan.tasks, async (task, signal) => {
        let cwd = root.canonicalPath;
        let taskWorktree: TaskWorktree | null = null;
        const dependencyCommits = [
          ...new Set(task.dependencies.flatMap((dependency) => taskLineages.get(dependency) ?? [])),
        ];
        if (gitContext) {
          taskWorktree = await this.#git.createTaskWorktree(gitContext, task.id, dependencyCommits);
          cwd = taskWorktree.path;
          await this.#repository.updateTaskRun(runId, task.id, {
            branch: taskWorktree.branch,
            worktreePath: taskWorktree.path,
          });
        }
        const taskResult = await this.#executeTask(
          run,
          task,
          cwd,
          taskWorktree,
          taskCommits,
          signal,
        );
        const ownCommit = taskCommits.get(task.id);
        taskLineages.set(task.id, [
          ...new Set([...dependencyCommits, ...(ownCommit ? [ownCommit] : [])]),
        ]);
        return taskResult;
      });
      if (controller.signal.aborted) return;
      if (result.failed.length > 0 || result.canceled.length > 0) {
        throw new MaestroError(
          "TASKS_FAILED",
          `Tarefas não concluídas: ${[...result.failed, ...result.canceled].join(", ")}`,
          { recoverable: true },
        );
      }
      await this.#transition(
        runId,
        "validating",
        "Todas as tarefas concluíram; consolidando resultados.",
      );
      await this.#transition(runId, "integrating", "Integração final iniciada.");
      if (gitContext) {
        const orderedCommits = [
          ...new Set(
            plan.tasks
              .map((task) => taskCommits.get(task.id))
              .filter((commit): commit is string => Boolean(commit)),
          ),
        ];
        const integration = await this.#git.integrate(gitContext, orderedCommits);
        await this.#append({
          runId,
          type: "log",
          data: { level: integration.conflict ? "warn" : "info", message: integration.message },
        });
        if (integration.conflict) {
          await this.#transition(runId, "failed", integration.message, {
            error: integration.message,
            integrationBranch: integration.branch,
            integrationPath: integration.path,
          });
          return;
        }
        await this.#transition(runId, "completed", integration.message, {
          integrationBranch: integration.branch,
          integrationPath: integration.path,
        });
      } else {
        await this.#transition(
          runId,
          "completed",
          "Projeto sem Git concluído com um único escritor.",
        );
      }
    } finally {
      this.#controllers.delete(runId);
      this.#activeSessions.delete(runId);
    }
  }

  async #executeTask(
    run: Run,
    task: TaskSpec,
    cwd: string,
    worktree: TaskWorktree | null,
    taskCommits: Map<string, string>,
    signal: AbortSignal,
  ): Promise<{ state: "completed" | "failed" | "canceled"; error?: string }> {
    const resolved = this.#providers.resolve(task.model, "subscription-worker");
    const { adapter, connection } = resolved;
    if (!connection)
      throw new MaestroError("PAID_API_BLOCKED", "A tarefa exige uma conta por assinatura.");
    this.#providers.markSessionStarted(connection.id);
    const writable = task.role === "implementer" || task.role === "tester";
    let session: ProviderSession | null = null;
    const sink: ProviderEventSink = async (event) => {
      if (event.type === "file.diff") {
        const candidate = path.isAbsolute(event.data.path)
          ? event.data.path
          : path.join(cwd, event.data.path);
        await assertPathWithinRoots(candidate, [cwd], { allowMissing: true });
      }
      await this.#append(event);
    };
    try {
      const sessionSpec: ProviderSessionSpec = {
        runId: run.id,
        connectionId: connection.id,
        taskId: task.id,
        mode: "maestro",
        cwd,
        workspaceRoots: [cwd],
        model: task.model.modelId,
        effort: task.model.effort ?? "medium",
        permissions: {
          ...run.spec.permissions,
          writeWorkspace: writable,
          runCommands: writable,
        },
        budget: run.spec.budget,
        tools: task.tools,
        systemPrompt:
          "Você executa exatamente uma tarefa aprovada do Maestro. Trabalhe somente no workspace fornecido. Não publique, faça deploy, push, eleve privilégios nem acesse segredos. Pare quando os critérios estiverem atendidos.",
      };
      session = await adapter.createSession(sessionSpec, sink);
      this.#trackSession(run.id, task.model.providerId, session.id, connection.id);
      await this.#repository.updateTaskRun(run.id, task.id, {
        providerSessionId: session.nativeSessionId,
      });
      const taskPrompt = [
        `Tarefa: ${task.title}`,
        task.description,
        "Critérios de sucesso:",
        ...task.successCriteria.map((criterion) => `- ${criterion}`),
        task.role === "reviewer"
          ? "Revise e reporte achados; não altere arquivos."
          : "Implemente somente o necessário e mantenha o workspace consistente.",
      ].join("\n");
      const contextAssets = await this.#repository.getContextAssets(run.spec.contextAssetIds);
      const capability = this.#modelCapability(resolved.selection);
      const compiled = await this.#context.compile(contextAssets, taskPrompt, {
        vision: capability.vision,
        contextWindow: capability.contextWindow,
      });
      const completed = await adapter.send(session.id, compiled.parts);
      await this.#repository.updateTaskRun(run.id, task.id, {
        providerSessionId: completed.nativeSessionId,
      });

      for (const command of task.validationCommands) {
        await this.#runValidationCommand(run, task, command, cwd, signal);
      }
      if (worktree && writable) {
        const commit = await this.#git.commitTask(worktree, task.title);
        if (commit) taskCommits.set(task.id, commit);
      }
      return { state: "completed" };
    } catch (error) {
      if (signal.aborted) return { state: "canceled" };
      return { state: "failed", error: errorMessage(error) };
    } finally {
      if (session) {
        this.#untrackSession(run.id, task.model.providerId, session.id, connection.id);
      }
      this.#providers.markSessionEnded(connection.id);
    }
  }

  #providerConcurrency(): Record<string, number> {
    const limits: Record<string, number> = {};
    for (const { connection, health } of this.#providers.listConnectionsCached()) {
      if (!connection.enabled || health.status !== "ready") continue;
      limits[connection.id] = connection.concurrencyLimit;
      limits[connection.providerId] =
        (limits[connection.providerId] ?? 0) + connection.concurrencyLimit;
    }
    return limits;
  }

  async #runValidationCommand(
    run: Run,
    task: TaskSpec,
    command: TaskSpec["validationCommands"][number],
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    const allowed = await assertCommandAllowed(command, run.spec.permissions, [cwd], cwd);
    const commandId = randomUUID();
    const startedAt = Date.now();
    await this.#append({
      runId: run.id,
      type: "command.started",
      data: {
        taskId: task.id,
        commandId,
        executable: allowed.executable,
        args: allowed.args,
        cwd: allowed.cwd,
      },
    });
    const result = await this.#supervisor.capture(
      {
        executable: allowed.executable,
        args: allowed.args,
        cwd: allowed.cwd,
        label: `${task.title}: ${allowed.executable}`,
      },
      { timeoutMs: allowed.timeoutMs, signal, maxOutputBytes: 4 * 1024 * 1024 },
    );
    if (result.stdout) {
      await this.#append({
        runId: run.id,
        type: "command.output",
        data: { taskId: task.id, commandId, stream: "stdout", chunk: result.stdout },
      });
    }
    if (result.stderr) {
      await this.#append({
        runId: run.id,
        type: "command.output",
        data: { taskId: task.id, commandId, stream: "stderr", chunk: result.stderr },
      });
    }
    await this.#append({
      runId: run.id,
      type: "command.completed",
      data: {
        taskId: task.id,
        commandId,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: Date.now() - startedAt,
      },
    });
    if (result.exitCode !== 0) {
      throw new MaestroError(
        "VALIDATION_FAILED",
        `${allowed.executable} encerrou com código ${result.exitCode ?? "desconhecido"}.`,
        { recoverable: true },
      );
    }
  }

  #messageSink(
    runId: string,
    messageId: string,
    setContent: (content: string) => void,
  ): ProviderEventSink {
    let content = "";
    return async (event) => {
      if (event.type === "message.delta") {
        content += event.data.delta;
        setContent(content);
        await this.#append({ ...event, data: { ...event.data, messageId } });
        return;
      }
      if (event.type === "message.completed") {
        content = event.data.content || content;
        setContent(content);
        await this.#append({ ...event, data: { ...event.data, messageId, content } });
        return;
      }
      await this.#append(event);
    };
  }

  async #discoverValidationCommands(
    root: string,
  ): Promise<Array<{ executable: string; args: string[] }>> {
    const packageJsonPath = path.join(root, "package.json");
    const packageJson = await readFile(packageJsonPath, "utf8").catch(() => null);
    if (!packageJson) return [];
    try {
      const value = JSON.parse(packageJson) as {
        scripts?: Record<string, string>;
        packageManager?: string;
      };
      const scripts = value.scripts ?? {};
      const manager =
        value.packageManager?.split("@")[0] ??
        ((await stat(path.join(root, "pnpm-lock.yaml")).catch(() => null)) ? "pnpm" : "npm");
      const commands: Array<{ executable: string; args: string[] }> = [];
      for (const script of ["typecheck", "test", "lint", "build"]) {
        if (!scripts[script]) continue;
        commands.push({
          executable: manager,
          args: manager === "npm" ? ["run", script] : [script],
        });
      }
      return commands.slice(0, 4);
    } catch {
      return [];
    }
  }

  async #append<K extends NewRunEvent["type"]>(
    event: Extract<NewRunEvent, { type: K }>,
  ): Promise<RunEvent<K>> {
    const persisted = await this.#repository.appendEvent(event);
    this.#emit(persisted);
    return persisted;
  }

  async #transition(
    runId: string,
    to: RunState,
    reason: string,
    options: {
      error?: string | null;
      integrationBranch?: string | null;
      integrationPath?: string | null;
    } = {},
  ): Promise<Run> {
    const current = await this.#repository.getRun(runId);
    const updated = await this.#repository.transitionRun(runId, to, { reason, ...options });
    await this.#append({ runId, type: "run.state", data: { from: current.state, to, reason } });
    return updated;
  }

  async #failRun(runId: string, assistantMessageId: string | null, error: unknown): Promise<void> {
    const message = errorMessage(error);
    if (assistantMessageId)
      await this.#repository
        .updateMessage(assistantMessageId, { content: message, status: "failed" })
        .catch(() => null);
    const run = await this.#repository.getRun(runId).catch(() => null);
    if (!run || isTerminalRunState(run.state)) return;
    await this.#append({
      runId,
      type: "error",
      data: {
        code: error instanceof MaestroError ? error.code : "RUN_FAILED",
        message,
        recoverable: error instanceof MaestroError ? error.recoverable : true,
      },
    });
    await this.#transition(runId, "failed", message, { error: message });
  }

  async #failMessage(messageId: string, error: unknown): Promise<void> {
    await this.#repository.updateMessage(messageId, {
      content: errorMessage(error),
      status: "failed",
    });
  }

  #trackSession(runId: string, providerId: string, sessionId: string, connectionId?: string): void {
    const sessions = this.#activeSessions.get(runId) ?? new Set<ActiveProviderSession>();
    sessions.add({ providerId, sessionId, ...(connectionId ? { connectionId } : {}) });
    this.#activeSessions.set(runId, sessions);
  }

  #trackChat(conversation: Conversation): void {
    const active = this.#activeChats.get(conversation.id);
    this.#activeChats.set(conversation.id, {
      projectId: conversation.projectId,
      count: (active?.count ?? 0) + 1,
    });
  }

  #untrackChat(conversationId: string): void {
    const active = this.#activeChats.get(conversationId);
    if (!active || active.count <= 1) this.#activeChats.delete(conversationId);
    else this.#activeChats.set(conversationId, { ...active, count: active.count - 1 });
  }

  #untrackSession(
    runId: string,
    providerId: string,
    sessionId: string,
    connectionId?: string,
  ): void {
    const sessions = this.#activeSessions.get(runId);
    if (!sessions) return;
    for (const item of sessions) {
      if (
        item.providerId === providerId &&
        item.sessionId === sessionId &&
        item.connectionId === connectionId
      )
        sessions.delete(item);
    }
    if (sessions.size === 0) this.#activeSessions.delete(runId);
  }

  #firstSelection(summaries: ReturnType<ProviderRegistry["listCached"]>): ModelSelection | null {
    for (const summary of summaries) {
      if (summary.health.status !== "ready") continue;
      const model = summary.models.find((item) => item.isDefault) ?? summary.models[0];
      if (model) return { providerId: summary.descriptor.id, modelId: model.id, effort: "medium" };
    }
    return null;
  }

  async #runRequiresVision(run: Run): Promise<boolean> {
    if (run.spec.contextAssetIds.length === 0) return false;
    const records = await this.#repository.getContextAssets(run.spec.contextAssetIds);
    return records.some((record) => record.kind === "image" || record.metadata.scannedPdf === true);
  }

  #modelCapability(selection: ModelSelection): ModelCapability {
    const connectionModel = selection.connectionId
      ? this.#providers
          .listConnectionsCached()
          .find((item) => item.connection.id === selection.connectionId)
          ?.models.find(
            (model) => model.id === selection.modelId || selection.modelId === "default",
          )
      : null;
    const provider = this.#providers
      .listCached()
      .find((item) => item.descriptor.id === selection.providerId);
    const model =
      connectionModel ??
      provider?.models.find((item) => item.id === selection.modelId) ??
      (selection.modelId === "default"
        ? (provider?.models.find((item) => item.isDefault) ?? provider?.models[0])
        : undefined);
    return (
      model?.capabilities ?? {
        chat: true,
        coding: true,
        tools: false,
        vision: false,
        reasoningEffort: [],
        structuredOutput: false,
        contextWindow: null,
      }
    );
  }

  #emitEphemeralMessage(messageId: string, delta: string): void {
    this.#emit({
      id: `ephemeral:${randomUUID()}`,
      runId: `chat:${messageId}`,
      sequence: 0,
      type: "message.delta",
      data: { messageId, role: "assistant", delta },
      occurredAt: new Date().toISOString(),
    });
  }

  #emitEphemeralMessageComplete(messageId: string, content: string): void {
    this.#emit({
      id: `ephemeral:${randomUUID()}`,
      runId: `chat:${messageId}`,
      sequence: 0,
      type: "message.completed",
      data: { messageId, role: "assistant", content },
      occurredAt: new Date().toISOString(),
    });
  }
}
