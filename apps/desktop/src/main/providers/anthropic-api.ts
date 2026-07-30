import { readFile } from "node:fs/promises";
import type {
  ProviderChatRequest,
  ProviderChatResult,
  ProviderConfigSchema,
  ProviderDescriptor,
  ProviderHealth,
  ProviderModel,
} from "@maestro/contracts";
import { MaestroError } from "@maestro/core";
import { ApiProviderAdapter } from "./api-base.js";
import { consumeSse, responseError } from "./sse.js";
import { configString } from "./types.js";

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
    return [
      {
        id: model,
        name: model,
        isDefault: true,
        capabilities: {
          chat: true,
          coding: false,
          tools: false,
          vision: true,
          reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
          structuredOutput: true,
          contextWindow: null,
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
        .map(async (message) => ({
          role: message.role,
          content: await anthropicContent(message.content),
        })),
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
      const usage = (value.usage ?? {}) as UnknownRecord;
      return {
        content,
        model: typeof value.model === "string" ? value.model : request.selection.modelId,
        providerMessageId: typeof value.id === "string" ? value.id : null,
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
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      },
    };
  }
}
