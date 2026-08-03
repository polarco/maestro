import { readFile } from "node:fs/promises";
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

function providerText(content: ProviderChatRequest["messages"][number]["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
}

export async function anthropicContent(
  content: ProviderChatRequest["messages"][number]["content"],
): Promise<string | UnknownRecord[]> {
  if (typeof content === "string") return content;
  return Promise.all(
    content.map(async (part): Promise<UnknownRecord> =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: part.mimeType ?? "image/jpeg",
              data: (await readFile(part.path)).toString("base64"),
            },
          },
    ),
  );
}

export class AnthropicApiAdapter extends ApiProviderAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: "anthropic",
    name: "Anthropic API",
    kind: "api",
    description: "Claude via Messages API, usado pelo Maestro e pelo chat simples.",
    supportsStructuredSessions: false,
    supportsPty: false,
    homepage: "https://docs.anthropic.com/",
  };

  readonly configSchema: ProviderConfigSchema = {
    providerId: "anthropic",
    fields: [
      {
        key: "apiKey",
        label: "Chave da API",
        type: "secret",
        required: true,
        placeholder: "sk-ant-…",
      },
      {
        key: "baseUrl",
        label: "Endpoint",
        type: "text",
        required: true,
        defaultValue: "https://api.anthropic.com/v1",
      },
      {
        key: "model",
        label: "Modelo padrão",
        type: "text",
        required: true,
        defaultValue: "claude-fable-5",
      },
      {
        key: "anthropicVersion",
        label: "Versão da API",
        type: "text",
        required: true,
        defaultValue: "2023-06-01",
      },
      {
        key: "contextWindow",
        label: "Janela de contexto",
        type: "number",
        required: false,
        defaultValue: 200_000,
      },
      {
        key: "quality",
        label: "Qualidade funcional (0–1)",
        type: "number",
        required: false,
        defaultValue: 0.8,
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
    ],
  };

  async detect(): Promise<ProviderHealth> {
    const [config, hasKey] = await Promise.all([
      this.dependencies.repository.getProviderConfig(this.descriptor.id),
      this.dependencies.vault.has("provider:anthropic:apiKey"),
    ]);
    const configured = hasKey && Boolean(configString(config, "model"));
    return {
      providerId: this.descriptor.id,
      status: configured ? "ready" : "unauthenticated",
      installed: true,
      authenticated: hasKey,
      version: null,
      message: configured
        ? "API configurada; a chave permanece no cofre local."
        : "Adicione uma chave e um modelo para conectar.",
      checkedAt: new Date().toISOString(),
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const config = await this.dependencies.repository.getProviderConfig(this.descriptor.id);
    const model = configString(config, "model", "claude-fable-5");
    const quality = Math.min(1, configNumber(config, "quality") ?? 0.8);
    const inputPrice = configNumber(config, "inputUsdPerMillion");
    const outputPrice = configNumber(config, "outputUsdPerMillion");
    return [
      {
        id: model,
        name: model,
        isDefault: true,
        capabilities: {
          chat: true,
          coding: true,
          tools: true,
          vision: true,
          reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
          structuredOutput: true,
          contextWindow: resolveModelContextWindow(
            "anthropic",
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
        cache: { supported: false, sessionAffinity: true },
      },
    ];
  }

  async chat(
    request: ProviderChatRequest,
    onDelta?: (delta: string) => void,
  ): Promise<ProviderChatResult> {
    const [config, apiKey] = await Promise.all([
      this.dependencies.repository.getProviderConfig(this.descriptor.id),
      this.dependencies.vault.get("provider:anthropic:apiKey"),
    ]);
    if (!apiKey)
      throw new MaestroError(
        "PROVIDER_NOT_CONFIGURED",
        "A chave da Anthropic não foi configurada.",
        { recoverable: true },
      );
    const baseUrl = configString(config, "baseUrl", "https://api.anthropic.com/v1").replace(
      /\/$/,
      "",
    );
    const systemMessages = request.messages
      .filter((message) => message.role === "system")
      .map((message) => providerText(message.content));
    const messages = await Promise.all(
      request.messages
        .filter((message) => message.role !== "system")
        .map(async (message) => {
          if (message.role === "tool")
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: message.toolCallId,
                  content: providerText(message.content),
                },
              ],
            };
          const converted = await anthropicContent(message.content);
          if (message.role === "assistant" && message.toolCalls?.length) {
            const blocks: UnknownRecord[] =
              typeof converted === "string"
                ? converted
                  ? [{ type: "text", text: converted }]
                  : []
                : converted;
            blocks.push(
              ...message.toolCalls.map((call) => ({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.input,
              })),
            );
            return { role: "assistant", content: blocks };
          }
          return { role: message.role, content: converted };
        }),
    );
    if (request.outputSchema) {
      systemMessages.push(
        `Responda somente com JSON válido que siga este JSON Schema, sem markdown: ${JSON.stringify(request.outputSchema)}`,
      );
    }
    const body: UnknownRecord = {
      model: request.selection.modelId,
      max_tokens: request.maxTokens ?? 8_192,
      messages,
      stream: Boolean(onDelta),
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      if (request.toolChoice === "none") body.tool_choice = { type: "none" };
      else if (typeof request.toolChoice === "object")
        body.tool_choice = { type: "tool", name: request.toolChoice.name };
      else body.tool_choice = { type: "auto" };
    }
    if (systemMessages.length > 0) body.system = systemMessages.join("\n\n");
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": configString(config, "anthropicVersion", "2023-06-01"),
      },
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) throw await responseError(response);

    if (!onDelta) {
      const value = (await response.json()) as UnknownRecord;
      const content = Array.isArray(value.content)
        ? value.content
            .map((part) => {
              if (typeof part !== "object" || !part) return "";
              const block = part as UnknownRecord;
              return typeof block.text === "string" ? block.text : "";
            })
            .join("")
        : "";
      const toolCalls = Array.isArray(value.content)
        ? value.content.flatMap((part): Array<{ id: string; name: string; input: unknown }> => {
            if (typeof part !== "object" || !part) return [];
            const block = part as UnknownRecord;
            if (
              block.type !== "tool_use" ||
              typeof block.id !== "string" ||
              typeof block.name !== "string"
            )
              return [];
            return [{ id: block.id, name: block.name, input: block.input ?? {} }];
          })
        : [];
      const usage = (value.usage ?? {}) as UnknownRecord;
      return {
        content,
        model: typeof value.model === "string" ? value.model : request.selection.modelId,
        providerMessageId: typeof value.id === "string" ? value.id : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        finishReason:
          value.stop_reason === "tool_use"
            ? "tool_calls"
            : value.stop_reason === "max_tokens"
              ? "length"
              : value.stop_reason === "end_turn" || value.stop_reason === "stop_sequence"
                ? "stop"
                : "unknown",
        usage: {
          ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
          ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
        },
      };
    }

    let content = "";
    let providerMessageId: string | null = null;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    await consumeSse(response, (data) => {
      if (data === "[DONE]") return;
      const value = JSON.parse(data) as UnknownRecord;
      if (value.type === "message_start") {
        const message = (value.message ?? {}) as UnknownRecord;
        if (typeof message.id === "string") providerMessageId = message.id;
        const usage = (message.usage ?? {}) as UnknownRecord;
        if (typeof usage.input_tokens === "number") inputTokens = usage.input_tokens;
      }
      if (value.type === "content_block_delta") {
        const delta = (value.delta ?? {}) as UnknownRecord;
        if (typeof delta.text === "string") {
          content += delta.text;
          onDelta(delta.text);
        }
      }
      if (value.type === "message_delta") {
        const usage = (value.usage ?? {}) as UnknownRecord;
        if (typeof usage.output_tokens === "number") outputTokens = usage.output_tokens;
      }
      if (value.type === "error")
        throw new MaestroError("PROVIDER_STREAM_ERROR", JSON.stringify(value.error), {
          recoverable: true,
        });
    });
    return {
      content,
      model: request.selection.modelId,
      providerMessageId,
      finishReason: "stop",
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      },
    };
  }
}
