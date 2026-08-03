import { createHash, randomUUID } from "node:crypto";
import type {
  ContextCheckpoint,
  ExecutionPolicy,
  ModelSelection,
  NewRunEvent,
  ProviderAdapter,
  ProviderChatMessage,
  ProviderToolDefinition,
  RecoveryAttempt,
  ToolDefinition,
  Turn,
} from "@maestro/contracts";
import type { MaestroRepository } from "@maestro/database";
import {
  checkpointAfterTool,
  checkpointHandoff,
  createContextCheckpoint,
  errorMessage,
  MaestroError,
  withTransientRetry,
  type PolicyToolExecutor,
} from "@maestro/core";

export interface ProviderToolLoopResult {
  content: string;
  selection: ModelSelection;
  checkpoint: ContextCheckpoint;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsd: number;
  };
}

export interface ProviderToolLoopInput {
  turn: Turn;
  runId: string | null;
  messages: ProviderChatMessage[];
  selection: ModelSelection;
  fallbackSelections?: ModelSelection[];
  policy: ExecutionPolicy;
  objective: string;
  maxIterations?: number;
  maxTokens?: number;
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onEvent?: (event: NewRunEvent) => void | Promise<void>;
}

export interface ProviderToolLoopDependencies {
  repository: MaestroRepository;
  executor: PolicyToolExecutor;
  resolveAdapter: (selection: ModelSelection) => ProviderAdapter;
}

function modelToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function toolMaps(definitions: readonly ToolDefinition[]): {
  tools: ProviderToolDefinition[];
  modelToActual: Map<string, string>;
  actualToModel: Map<string, string>;
} {
  const modelToActual = new Map<string, string>();
  const actualToModel = new Map<string, string>();
  const tools = definitions.map((definition) => {
    let name = modelToolName(definition.name);
    let suffix = 2;
    while (modelToActual.has(name))
      name = `${modelToolName(definition.name).slice(0, 58)}_${suffix++}`;
    modelToActual.set(name, definition.name);
    actualToModel.set(definition.name, name);
    return { name, description: definition.description, inputSchema: definition.inputSchema };
  });
  return { tools, modelToActual, actualToModel };
}

function contentString(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

export class ProviderToolLoop {
  readonly #repository: MaestroRepository;
  readonly #executor: PolicyToolExecutor;
  readonly #resolveAdapter: (selection: ModelSelection) => ProviderAdapter;

  constructor(dependencies: ProviderToolLoopDependencies) {
    this.#repository = dependencies.repository;
    this.#executor = dependencies.executor;
    this.#resolveAdapter = dependencies.resolveAdapter;
  }

  async run(input: ProviderToolLoopInput): Promise<ProviderToolLoopResult> {
    const definitions = this.#executor.definitions(input.policy);
    const names = toolMaps(definitions);
    const messages = [...input.messages];
    const candidates = [input.selection, ...(input.fallbackSelections ?? [])].filter(
      (selection, index, all) =>
        all.findIndex(
          (item) =>
            item.providerId === selection.providerId &&
            item.connectionId === selection.connectionId &&
            item.modelId === selection.modelId,
        ) === index,
    );
    let selection = candidates[0]!;
    let candidateIndex = 0;
    const existingCheckpoint = await this.#repository.getLatestCheckpoint({
      turnId: input.turn.id,
      safeOnly: true,
    });
    let checkpoint =
      existingCheckpoint ??
      createContextCheckpoint({
        conversationId: input.turn.conversationId,
        runId: input.runId,
        turnId: input.turn.id,
        update: { objective: input.objective, pending: ["Concluir o turno atual."] },
      });
    if (!existingCheckpoint) await this.#repository.saveCheckpoint(checkpoint);
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 };
    let finalContent = "";
    let openRecoveryIds: string[] = [];

    for (let iteration = 0; iteration < Math.max(1, input.maxIterations ?? 24); iteration += 1) {
      const adapter = this.#resolveAdapter(selection);
      if (!adapter.chat)
        throw new MaestroError(
          "PROVIDER_TOOL_LOOP_UNSUPPORTED",
          `${adapter.descriptor.name} não oferece chat estruturado para o loop de ferramentas.`,
          { recoverable: true },
        );
      const startedAt = Date.now();
      try {
        const response = await withTransientRetry(
          () =>
            adapter.chat!({
              selection,
              messages,
              tools: names.tools,
              toolChoice: names.tools.length > 0 ? "auto" : "none",
              checkpoint,
              maxTokens: input.maxTokens ?? 8_192,
              ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
              ...(input.signal ? { signal: input.signal } : {}),
            }),
          {
            maxRetries: adapter.capabilities?.safeRetry === false ? 0 : 2,
            ...(input.signal ? { signal: input.signal } : {}),
            onRetry: async ({ attempt, error }) => {
              const recovery = this.#recovery(
                input,
                "retry",
                attempt,
                selection,
                selection,
                checkpoint.id,
                errorMessage(error),
              );
              await this.#repository.saveRecoveryAttempt(recovery);
              openRecoveryIds.push(recovery.id);
              await input.onEvent?.({
                runId: input.runId ?? `turn:${input.turn.id}`,
                type: "recovery.attempted",
                data: { attempt: recovery },
              });
            },
          },
        );
        await this.#finishRecoveries(openRecoveryIds, "succeeded", input);
        openRecoveryIds = [];
        await this.#repository.recordModelOutcome({
          selection,
          success: true,
          latencyMs: Date.now() - startedAt,
          ...(response.usage.inputTokens === undefined
            ? {}
            : { inputTokens: response.usage.inputTokens }),
          ...(response.usage.outputTokens === undefined
            ? {}
            : { outputTokens: response.usage.outputTokens }),
          ...(response.usage.cachedTokens === undefined
            ? {}
            : { cachedTokens: response.usage.cachedTokens }),
          ...(response.usage.costUsd === undefined ? {} : { costUsd: response.usage.costUsd }),
        });
        usage.inputTokens += response.usage.inputTokens ?? 0;
        usage.outputTokens += response.usage.outputTokens ?? 0;
        usage.cachedTokens += response.usage.cachedTokens ?? 0;
        usage.costUsd += response.usage.costUsd ?? 0;
        if (response.content) {
          finalContent += response.content;
          input.onDelta?.(response.content);
        }
        const requestedCalls = response.toolCalls ?? [];
        if (requestedCalls.length === 0) {
          checkpoint = createContextCheckpoint({
            conversationId: input.turn.conversationId,
            runId: input.runId,
            turnId: input.turn.id,
            previous: checkpoint,
            update: {
              progress: ["Resposta final produzida."],
              pending: [],
              safeToResume: true,
            },
          });
          await this.#repository.saveCheckpoint(checkpoint);
          return { content: finalContent, selection, checkpoint, usage };
        }

        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: requestedCalls,
        });
        for (const providerCall of requestedCalls) {
          const actualName = names.modelToActual.get(providerCall.name);
          if (!actualName)
            throw new MaestroError(
              "MODEL_REQUESTED_UNKNOWN_TOOL",
              `O modelo solicitou uma ferramenta não registrada: ${providerCall.name}.`,
              { recoverable: true },
            );
          await input.onEvent?.({
            runId: input.runId ?? `turn:${input.turn.id}`,
            type: "tool.started",
            data: { toolCallId: providerCall.id, name: actualName, input: providerCall.input },
          });
          const executed = await this.#executor.execute(
            actualName,
            providerCall.input,
            {
              turnId: input.turn.id,
              runId: input.runId,
              checkpointId: checkpoint.id,
              policy: input.policy,
              ...(input.signal ? { signal: input.signal } : {}),
              onStarted: async (call) => {
                if (call.mutability === "read") return;
                checkpoint = createContextCheckpoint({
                  conversationId: input.turn.conversationId,
                  runId: input.runId,
                  turnId: input.turn.id,
                  previous: checkpoint,
                  update: {
                    toolState: {
                      [call.id]: {
                        name: call.toolName,
                        status: "running",
                        idempotencyKey: call.idempotencyKey,
                      },
                    },
                    safeToResume: false,
                  },
                });
                await this.#repository.saveCheckpoint(checkpoint);
              },
            },
            createHash("sha256")
              .update(
                JSON.stringify([input.runId, input.objective, actualName, providerCall.input]),
              )
              .digest("hex"),
          );
          checkpoint = checkpointAfterTool(checkpoint, executed.call, executed.result);
          await this.#repository.saveCheckpoint(checkpoint);
          await input.onEvent?.({
            runId: input.runId ?? `turn:${input.turn.id}`,
            type: "tool.completed",
            data: {
              toolCallId: providerCall.id,
              name: actualName,
              output: executed.result.output,
              isError: executed.result.isError,
            },
          });
          messages.push({
            role: "tool",
            name: providerCall.name,
            toolCallId: providerCall.id,
            content: contentString(
              executed.result.artifactRef
                ? {
                    output: executed.result.output,
                    artifactRef: executed.result.artifactRef,
                    contentHash: executed.result.contentHash,
                  }
                : executed.result.output,
            ),
          });
        }
      } catch (error) {
        await this.#finishRecoveries(openRecoveryIds, "failed", input);
        openRecoveryIds = [];
        await this.#repository.recordModelOutcome({
          selection,
          success: false,
          latencyMs: Date.now() - startedAt,
        });
        if (input.signal?.aborted) throw error;
        const next = candidates[candidateIndex + 1];
        if (!next || input.turn.modelPreference.noFallback || !checkpoint.safeToResume) throw error;
        const previous = selection;
        candidateIndex += 1;
        selection = next;
        const recovery = this.#recovery(
          input,
          "failover",
          candidateIndex,
          previous,
          selection,
          checkpoint.id,
          errorMessage(error),
        );
        await this.#repository.saveRecoveryAttempt(recovery);
        openRecoveryIds.push(recovery.id);
        await input.onEvent?.({
          runId: input.runId ?? `turn:${input.turn.id}`,
          type: "route.fallback",
          data: {
            from: previous,
            to: selection,
            reason: recovery.reason,
            checkpointId: checkpoint.id,
          },
        });
        messages.unshift({
          role: "system",
          content: `Retome do checkpoint seguro abaixo. Não repita ferramentas já concluídas; respeite seus idempotency keys.\n${checkpointHandoff(checkpoint)}`,
        });
      }
    }
    await this.#finishRecoveries(openRecoveryIds, "failed", input);
    throw new MaestroError(
      "TOOL_LOOP_LIMIT_REACHED",
      "O provider excedeu o limite de iterações de ferramentas.",
      { recoverable: true },
    );
  }

  #recovery(
    input: ProviderToolLoopInput,
    kind: RecoveryAttempt["kind"],
    attempt: number,
    from: ModelSelection,
    to: ModelSelection,
    checkpointId: string,
    reason: string,
  ): RecoveryAttempt {
    return {
      id: randomUUID(),
      turnId: input.turn.id,
      runId: input.runId,
      kind,
      attempt,
      from,
      to,
      checkpointId,
      reason,
      outcome: "pending",
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
  }

  async #finishRecoveries(
    ids: readonly string[],
    outcome: "succeeded" | "failed",
    input: ProviderToolLoopInput,
  ): Promise<void> {
    const attempts = await Promise.all(
      ids.map((id) => this.#repository.finishRecoveryAttempt(id, outcome)),
    );
    for (const attempt of attempts)
      await input.onEvent?.({
        runId: input.runId ?? `turn:${input.turn.id}`,
        type: "recovery.completed",
        data: { attempt },
      });
  }
}
