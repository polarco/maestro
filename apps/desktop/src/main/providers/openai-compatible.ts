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
import { configString } from "./types.js";

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
    return [
      {
        id: model,
        name: model,
        isDefault: true,
        capabilities: {
          chat: true,
          coding: false,
          tools: false,
          vision: false,
          reasoningEffort: [],
          structuredOutput: config.structuredOutput !== false,
          contextWindow: resolveModelContextWindow("openai-compatible", model, null),
        },
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
      messages: request.messages.map((message) => ({
        ...message,
        content: textContent(message.content),
      })),
      stream: Boolean(onDelta),
    };
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
      const usage = (value.usage ?? {}) as UnknownRecord;
      return {
        content: typeof message.content === "string" ? message.content : "",
        model: typeof value.model === "string" ? value.model : request.selection.modelId,
        providerMessageId: typeof value.id === "string" ? value.id : null,
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
    return { content, model, providerMessageId, usage: {} };
  }
}
