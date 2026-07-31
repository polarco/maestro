import type { EventDataMap, NewRunEvent } from "@maestro/contracts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metricData(values: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedTokens: number | undefined;
  costUsd: number | undefined;
  durationMs: number | undefined;
}): EventDataMap["metric"] {
  const result: EventDataMap["metric"] = {};
  if (values.inputTokens !== undefined) result.inputTokens = values.inputTokens;
  if (values.outputTokens !== undefined) result.outputTokens = values.outputTokens;
  if (values.cachedTokens !== undefined) result.cachedTokens = values.cachedTokens;
  if (values.costUsd !== undefined) result.costUsd = values.costUsd;
  if (values.durationMs !== undefined) result.durationMs = values.durationMs;
  return result;
}

export interface NormalizeContext {
  runId: string;
  taskId?: string;
  agentId: string;
  providerId: string;
  modelId: string;
  cwd: string;
}

function withTask<T extends object>(context: NormalizeContext, data: T): T & { taskId?: string } {
  return context.taskId ? { ...data, taskId: context.taskId } : data;
}

export function normalizeCodexEvent(raw: unknown, context: NormalizeContext): NewRunEvent[] {
  const value = record(raw);
  if (!value) return [];
  const methodOrType = string(value.method) ?? string(value.type);
  if (!methodOrType) return [];
  const params = record(value.params) ?? value;

  if (methodOrType === "item/agentMessage/delta") {
    const delta = string(params.delta);
    if (!delta) return [];
    return [
      {
        runId: context.runId,
        type: "message.delta",
        data: withTask(context, { messageId: context.agentId, role: "assistant", delta }),
      },
    ];
  }

  if (methodOrType === "thread.started") {
    return [
      {
        runId: context.runId,
        type: "agent.started",
        data: withTask(context, {
          agentId: context.agentId,
          providerId: context.providerId,
          modelId: context.modelId,
          label: "Codex",
        }),
      },
    ];
  }

  if (methodOrType === "turn.completed" || methodOrType === "turn/completed") {
    const usage = record(params.usage) ?? {};
    return [
      {
        runId: context.runId,
        type: "metric",
        data: metricData({
          inputTokens: number(usage.input_tokens ?? usage.inputTokens),
          outputTokens: number(usage.output_tokens ?? usage.outputTokens),
          cachedTokens: number(usage.cached_input_tokens ?? usage.cachedInputTokens),
          costUsd: undefined,
          durationMs: undefined,
        }),
      },
      {
        runId: context.runId,
        type: "agent.stopped",
        data: withTask(context, { agentId: context.agentId, outcome: "completed" }),
      },
    ];
  }

  if (methodOrType === "turn.failed" || methodOrType === "error" || methodOrType === "error") {
    return [
      {
        runId: context.runId,
        type: "error",
        data: {
          code: "CODEX_ERROR",
          message: string(params.message) ?? string(value.message) ?? "Codex reportou um erro.",
          recoverable: true,
          detail: raw,
        },
      },
    ];
  }

  const item = record(params.item) ?? record(value.item);
  if (item) {
    const itemType = string(item.type);
    const itemId = string(item.id) ?? `${context.agentId}:item`;
    const completed = methodOrType === "item/completed" || methodOrType === "item.completed";
    const started = methodOrType === "item/started" || methodOrType === "item.started";

    if (itemType === "agent_message" && completed) {
      const content = string(item.text) ?? "";
      return [
        {
          runId: context.runId,
          type: "message.completed",
          data: withTask(context, {
            messageId: context.agentId,
            role: "assistant",
            content,
          }),
        },
      ];
    }
    if (itemType === "command_execution") {
      if (started) {
        const command = string(item.command) ?? "command";
        return [
          {
            runId: context.runId,
            type: "command.started",
            data: withTask(context, {
              commandId: itemId,
              executable: command,
              args: [],
              cwd: context.cwd,
            }),
          },
        ];
      }
      if (completed) {
        return [
          {
            runId: context.runId,
            type: "command.completed",
            data: withTask(context, {
              commandId: itemId,
              exitCode: number(item.exit_code ?? item.exitCode) ?? null,
              signal: null,
              durationMs: number(item.duration_ms ?? item.durationMs) ?? 0,
            }),
          },
        ];
      }
    }
    if (itemType === "file_change" && completed) {
      const changes = Array.isArray(item.changes) ? item.changes : [item];
      return changes.flatMap((change): NewRunEvent[] => {
        const entry = record(change);
        const filePath = entry ? string(entry.path) : null;
        if (!filePath) return [];
        return [
          {
            runId: context.runId,
            type: "file.diff",
            data: withTask(context, { path: filePath, patch: string(entry?.patch) ?? "" }),
          },
        ];
      });
    }
    if (itemType?.includes("tool") || itemType === "mcp_tool_call") {
      return [
        {
          runId: context.runId,
          type: completed ? "tool.completed" : "tool.started",
          data: completed
            ? withTask(context, {
                toolCallId: itemId,
                name: string(item.name) ?? itemType,
                output: item.result ?? item.output,
                isError: item.status === "failed",
              })
            : withTask(context, {
                toolCallId: itemId,
                name: string(item.name) ?? itemType ?? "tool",
                input: item.arguments ?? item.input,
              }),
        } as NewRunEvent,
      ];
    }
  }

  return [
    {
      runId: context.runId,
      type: "log",
      data: { level: "debug", message: `Evento Codex não mapeado: ${methodOrType}` },
    },
  ];
}

export function normalizeClaudeEvent(raw: unknown, context: NormalizeContext): NewRunEvent[] {
  const value = record(raw);
  if (!value) return [];
  const type = string(value.type);
  if (!type) return [];

  if (type === "system" && value.subtype === "init") {
    return [
      {
        runId: context.runId,
        type: "agent.started",
        data: withTask(context, {
          agentId: context.agentId,
          providerId: context.providerId,
          modelId: string(value.model) ?? context.modelId,
          label: "Claude Code",
        }),
      },
    ];
  }

  if (type === "stream_event") {
    const event = record(value.event);
    const delta = event ? record(event.delta) : null;
    const textDelta = delta ? string(delta.text) : null;
    if (textDelta) {
      return [
        {
          runId: context.runId,
          type: "message.delta",
          data: withTask(context, {
            messageId: context.agentId,
            role: "assistant",
            delta: textDelta,
          }),
        },
      ];
    }
    return [];
  }

  if (type === "assistant") {
    const message = record(value.message);
    const content = message && Array.isArray(message.content) ? message.content : [];
    const events: NewRunEvent[] = [];
    for (const blockValue of content) {
      const block = record(blockValue);
      if (!block) continue;
      if (block.type === "text") {
        const text = string(block.text);
        if (text)
          events.push({
            runId: context.runId,
            type: "message.delta",
            data: withTask(context, {
              messageId: context.agentId,
              role: "assistant",
              delta: text,
            }),
          });
      }
      // Thinking blocks are deliberately ignored: raw chain-of-thought is never persisted.
      if (block.type === "tool_use") {
        events.push({
          runId: context.runId,
          type: "tool.started",
          data: withTask(context, {
            toolCallId: string(block.id) ?? `${context.agentId}:tool`,
            name: string(block.name) ?? "tool",
            input: block.input,
          }),
        });
      }
    }
    return events;
  }

  if (type === "user") {
    const message = record(value.message);
    const content = message && Array.isArray(message.content) ? message.content : [];
    return content.flatMap((blockValue): NewRunEvent[] => {
      const block = record(blockValue);
      if (!block || block.type !== "tool_result") return [];
      return [
        {
          runId: context.runId,
          type: "tool.completed",
          data: withTask(context, {
            toolCallId: string(block.tool_use_id) ?? `${context.agentId}:tool`,
            name: "tool",
            output: block.content,
            isError: block.is_error === true,
          }),
        },
      ];
    });
  }

  if (type === "result") {
    const usage = record(value.usage) ?? {};
    const result = string(value.result) ?? "";
    const isError = value.is_error === true || value.subtype !== "success";
    const events: NewRunEvent[] = [];
    if (result) {
      events.push({
        runId: context.runId,
        type: "message.completed",
        data: withTask(context, {
          messageId: context.agentId,
          role: "assistant",
          content: result,
        }),
      });
    }
    events.push({
      runId: context.runId,
      type: "metric",
      data: metricData({
        inputTokens: number(usage.input_tokens),
        outputTokens: number(usage.output_tokens),
        cachedTokens: number(usage.cache_read_input_tokens),
        costUsd: number(value.total_cost_usd),
        durationMs: number(value.duration_ms),
      }),
    });
    events.push({
      runId: context.runId,
      type: "agent.stopped",
      data: withTask(context, {
        agentId: context.agentId,
        outcome: isError ? "failed" : "completed",
      }),
    });
    if (isError) {
      events.push({
        runId: context.runId,
        type: "error",
        data: {
          code: "CLAUDE_CODE_ERROR",
          message: result || "Claude Code reportou um erro.",
          recoverable: true,
        },
      });
    }
    return events;
  }

  return [
    {
      runId: context.runId,
      type: "log",
      data: { level: "debug", message: `Evento Claude não mapeado: ${type}` },
    },
  ];
}
