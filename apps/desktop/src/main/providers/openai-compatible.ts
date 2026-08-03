import type {
  ProviderChatRequest,
  ProviderChatResult,
  ProviderConfigSchema,
  ProviderDescriptor,
  ProviderHealth,
  ProviderModel,
} from "@maestro/contracts";
import { MaestroError, resolveModelContextWindow } from "@maestro/core";
import { ApiProviderAdapter } from "./api-base.js";
import { consumeSse, responseError } from "./sse.js";
import { configNumber, configString } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function textContent(content: ProviderChatRequest["messages"][number]["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
}

export class OpenAiCompatibleAdapter extends ApiProviderAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: "openai-compatible",
    name: "OpenAI-compatible",
    kind: "api",
    description: "Endpoint Chat Completions configurável para nuvem ou modelos locais.",
    supportsStructuredSessions: false,
    supportsPty: false,
  };

  readonly configSchema: ProviderConfigSchema = {
    providerId: "openai-compatible",
    fields: [
      {
        key: "baseUrl",
        label: "Endpoint",
        type: "text",
        required: true,
        placeholder: "https://…/v1",
      },
      {
        key: "apiKey",
        label: "Chave da API",
        type: "secret",
        required: false,
        placeholder: "Opcional para endpoints locais",
      },
      {
        key: "model",
        label: "Modelo",
        type: "text",
        required: true,
        placeholder: "nome-do-modelo",
      },
      {
        key: "structuredOutput",
        label: "Structured output",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      {
        key: "toolCalling",
        label: "Tool calling",
        description: "Permite que o loop do Maestro execute ferramentas aprovadas.",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      {
        key: "contextWindow",
        label: "Janela de contexto",
        description: "Limite divulgado pelo endpoint; usado no orçamento seguro de entrada.",
        type: "number",
        required: false,
        defaultValue: 128_000,
      },
      {
        key: "quality",
        label: "Qualidade funcional (0–1)",
        description: "Piso comparável usado pelo roteamento Auto quando conhecido.",
        type: "number",
        required: false,
        defaultValue: 0.7,
      },
      {
        key: "inputUsdPerMillion",
        label: "US$ / 1M tokens de entrada",
        type: "number",
        required: false,
      },
      {
        key: "outputUsdPerMillion",
        label: "US$ / 1M tokens de saída",
        type: "number",
        required: false,
      },
      {
        key: "cacheSupported",
        label: "Cache de prompt",
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    ],
  };

  async detect(): Promise<ProviderHealth> {
    const config = await this.dependencies.repository.getProviderConfig(this.descriptor.id);
    const configured = Boolean(configString(config, "baseUrl") && configString(config, "model"));
    return {
      providerId: this.descriptor.id,
      status: configured ? "ready" : "unavailable",
      installed: configured,
      authenticated:
        (await this.dependencies.vault.has("provider:openai-compatible:apiKey")) || null,
      version: null,
      message: configured ? "Endpoint configurado." : "Informe endpoint e modelo.",
      checkedAt: new Date().toISOString(),
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const config = await this.dependencies.repository.getProviderConfig(this.descriptor.id);
    const model = configString(config, "model");
    if (!model) return [];
    const quality = Math.min(1, configNumber(config, "quality") ?? 0.7);
    const inputPrice = configNumber(config, "inputUsdPerMillion");
    const outputPrice = configNumber(config, "outputUsdPerMillion");
    return [
      {
        id: model,
        name: model,
        isDefault: true,
        capabilities: {
          chat: true,
          coding: config.toolCalling !== false,
          tools: config.toolCalling !== false,
          vision: false,
          reasoningEffort: [],
          structuredOutput: config.structuredOutput !== false,
          contextWindow: resolveModelContextWindow(
            "openai-compatible",
            model,
            configNumber(config, "contextWindow"),
          ),
        },
        quality: {
          answer: quality,
          research: quality,
          planning: quality,
          coding: quality,
          review: quality,
        },
        ...(inputPrice === null || outputPrice === null
          ? {}
          : {
              pricing: {
                inputUsdPerMillion: inputPrice,
                outputUsdPerMillion: outputPrice,
              },
            }),
        cache: { supported: config.cacheSupported === true, sessionAffinity: true },
      },
    ];
  }

  async chat(
    request: ProviderChatRequest,
    onDelta?: (delta: string) => void,
  ): Promise<ProviderChatResult> {
    const [config, apiKey] = await Promise.all([
      this.dependencies.repository.getProviderConfig(this.descriptor.id),
      this.dependencies.vault.get("provider:openai-compatible:apiKey"),
    ]);
    const baseUrl = configString(config, "baseUrl").replace(/\/$/, "");
    if (!baseUrl)
      throw new MaestroError(
        "PROVIDER_NOT_CONFIGURED",
        "O endpoint OpenAI-compatible não foi configurado.",
        { recoverable: true },
      );
    const body: UnknownRecord = {
      model: request.selection.modelId,
      messages: request.messages.map((message) => {
        if (message.role === "tool")
          return {
            role: "tool",
            content: textContent(message.content),
            tool_call_id: message.toolCallId,
            ...(message.name ? { name: message.name } : {}),
          };
        return {
          role: message.role,
          content: textContent(message.content),
          ...(message.toolCalls && message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.input) },
                })),
              }
            : {}),
        };
      }),
      stream: Boolean(onDelta),
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      body.tool_choice =
        typeof request.toolChoice === "object"
          ? { type: "function", function: { name: request.toolChoice.name } }
          : (request.toolChoice ?? "auto");
    }
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.outputSchema && config.structuredOutput !== false) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "maestro_output", strict: true, schema: request.outputSchema },
      };
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) throw await responseError(response);

    if (!onDelta) {
      const value = (await response.json()) as UnknownRecord;
      const choices = Array.isArray(value.choices) ? value.choices : [];
      const choice = (choices[0] ?? {}) as UnknownRecord;
      const message = (choice.message ?? {}) as UnknownRecord;
      const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const toolCalls = rawToolCalls.flatMap(
        (raw): Array<{ id: string; name: string; input: unknown }> => {
          if (typeof raw !== "object" || raw === null) return [];
          const call = raw as UnknownRecord;
          const fn = (call.function ?? {}) as UnknownRecord;
          if (typeof call.id !== "string" || typeof fn.name !== "string") return [];
          let input: unknown = {};
          if (typeof fn.arguments === "string" && fn.arguments.trim()) {
            try {
              input = JSON.parse(fn.arguments);
            } catch {
              input = { _raw: fn.arguments };
            }
          }
          return [{ id: call.id, name: fn.name, input }];
        },
      );
      const usage = (value.usage ?? {}) as UnknownRecord;
      return {
        content: typeof message.content === "string" ? message.content : "",
        model: typeof value.model === "string" ? value.model : request.selection.modelId,
        providerMessageId: typeof value.id === "string" ? value.id : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        finishReason:
          choice.finish_reason === "tool_calls"
            ? "tool_calls"
            : choice.finish_reason === "length"
              ? "length"
              : choice.finish_reason === "content_filter"
                ? "content_filter"
                : choice.finish_reason === "stop"
                  ? "stop"
                  : "unknown",
        usage: {
          ...(typeof usage.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}),
          ...(typeof usage.completion_tokens === "number"
            ? { outputTokens: usage.completion_tokens }
            : {}),
        },
      };
    }

    let content = "";
    let providerMessageId: string | null = null;
    let model = request.selection.modelId;
    await consumeSse(response, (data) => {
      if (data === "[DONE]") return;
      const value = JSON.parse(data) as UnknownRecord;
      if (typeof value.id === "string") providerMessageId = value.id;
      if (typeof value.model === "string") model = value.model;
      const choices = Array.isArray(value.choices) ? value.choices : [];
      const choice = (choices[0] ?? {}) as UnknownRecord;
      const delta = (choice.delta ?? {}) as UnknownRecord;
      if (typeof delta.content === "string") {
        content += delta.content;
        onDelta(delta.content);
      }
    });
    return { content, model, providerMessageId, finishReason: "stop", usage: {} };
  }
}
