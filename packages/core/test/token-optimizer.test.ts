import { describe, expect, it } from "vitest";
import {
  buildContextHandoff,
  estimateTokens,
  optimizeConversationContext,
  resolveModelContextWindow,
  type ContextHistoryMessage,
} from "../src/token-optimizer.js";

function message(
  id: string,
  role: ContextHistoryMessage["role"],
  content: string,
  extra: Partial<ContextHistoryMessage> = {},
): ContextHistoryMessage {
  return { id, role, content, ...extra };
}

describe("token optimizer", () => {
  it("uses the quick estimate, provider metadata and one conservative fallback", () => {
    expect(estimateTokens("12345")).toBe(2);
    expect(resolveModelContextWindow("codex", "default", null)).toBe(128_000);
    expect(resolveModelContextWindow("claude-code", "sonnet", null)).toBe(128_000);
    expect(resolveModelContextWindow("openai-compatible", "openai/gpt-4o", null)).toBe(128_000);
    expect(resolveModelContextWindow("anthropic", "claude-sonnet-4.6", null)).toBe(128_000);
    expect(resolveModelContextWindow("custom", "small", 64_000)).toBe(64_000);
  });

  it("applies deterministic lite compression without mutating the transcript", () => {
    const input = [
      message("1", "user", "Pedido com espaços.   \n\n\n\n"),
      message("2", "assistant", "Resposta repetida"),
      message("3", "assistant", "Resposta repetida"),
    ];
    const snapshot = structuredClone(input);
    const result = optimizeConversationContext(input, {
      mode: "balanced",
      contextWindow: 128_000,
    });

    expect(input).toEqual(snapshot);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content).toBe("Pedido com espaços.");
    expect(result.stats.techniques).toEqual(
      expect.arrayContaining(["whitespace", "duplicate-removal"]),
    );
  });

  it("preserves the newest conversation slice and replaces old overflow with a handoff", () => {
    const input = Array.from({ length: 18 }, (_, index) =>
      message(
        String(index),
        index % 2 === 0 ? "user" : "assistant",
        `Mensagem ${index}: ${"conteúdo importante ".repeat(90)}`,
        index === 3
          ? {
              hasContext: true,
              contextLabels: ["requisitos.pdf"],
              estimatedContextTokens: 400,
            }
          : {},
      ),
    );
    const result = optimizeConversationContext(input, {
      mode: "balanced",
      contextWindow: 4_000,
      currentInputTokens: 300,
    });

    expect(result.messages.at(-1)?.id).toBe("17");
    expect(result.stats.droppedMessages).toBeGreaterThan(0);
    expect(result.stats.optimizedTokens).toBeLessThanOrEqual(result.stats.targetTokens);
    expect(result.handoff).toContain("<context_handoff");
    expect(result.handoff).toContain("requisitos.pdf");
    expect(result.stats.techniques).toContain("history-pruning");
  });

  it("creates an explicit, escaped handoff for a model switch", () => {
    const handoff = buildContextHandoff(
      [
        message("1", "user", "Use `src/app.ts` e não gere HTML."),
        message("2", "assistant", "A análise do projeto foi concluída."),
      ],
      {
        transition: {
          from: { providerId: "codex", modelId: "gpt<old>" },
          to: { providerId: "claude-code", modelId: "sonnet" },
        },
      },
    );

    expect(handoff).toContain("codex/gpt&lt;old&gt;");
    expect(handoff).toContain("claude-code/sonnet");
    expect(handoff).toContain("src/app.ts");
    expect(handoff).not.toContain("gpt<old>");
  });

  it("respects off mode while still transferring context across models", () => {
    const input = [message("1", "user", "Texto sem compactação")];
    const result = optimizeConversationContext(input, {
      mode: "off",
      contextWindow: 1_000,
      transition: {
        from: { providerId: "codex", modelId: "a" },
        to: { providerId: "codex", modelId: "b" },
      },
    });

    expect(result.messages[0]?.content).toBe(input[0]?.content);
    expect(result.stats.droppedMessages).toBe(0);
    expect(result.handoff).toContain("codex/b");
  });

  it("keeps tool calls and results structurally paired after aggressive pruning", () => {
    const input = [
      message("old", "user", "contexto antigo ".repeat(500)),
      message("call-1", "assistant", '{"path":"src/app.ts"}', {
        contentKind: "tool-call",
        toolCallId: "tool-1",
      }),
      message("result-1", "assistant", "resultado da leitura ".repeat(400), {
        contentKind: "tool-result",
        toolResultFor: "tool-1",
      }),
      message("middle-user", "user", "Continue depois da leitura antiga."),
      message("middle-assistant", "assistant", "Continuidade registrada."),
      message(
        "recent-user",
        "user",
        `Preserve o par de ferramentas e responda. ${"contexto recente ".repeat(450)}`,
      ),
      message("recent-assistant", "assistant", "Entendido."),
    ];
    const result = optimizeConversationContext(input, {
      mode: "aggressive",
      contextWindow: 5_000,
      currentInputTokens: 200,
    });
    const ids = new Set(result.messages.map((item) => item.id));
    expect(ids.has("call-1")).toBe(ids.has("result-1"));
    expect(result.fidelity.orphanedToolCallIds).toEqual([]);
    expect(result.fidelity.passed).toBe(true);
  });

  it("preserves code, paths, JSON, numbers and errors and records provider token counts", () => {
    const protectedPayload = [
      "src/payments/retry.ts:417",
      "const LIMIT = 98317;",
      '{"request_id":"req_7f91","attempt":2}',
      "TypeError: balance 1200.55 differs from 1200.50",
      '```ts\nthrow new Error("E_RETRY_42")\n```',
    ].join("\n");
    const input = [
      message("protected", "user", protectedPayload, { protected: true }),
      ...Array.from({ length: 16 }, (_, index) =>
        message(
          `filler-${index}`,
          index % 2 ? "assistant" : "user",
          "texto descartável ".repeat(180),
        ),
      ),
      message("latest-user", "user", "Não perca os valores protegidos."),
      message("latest-assistant", "assistant", "Vou preservar exatamente."),
    ];
    const result = optimizeConversationContext(input, {
      mode: "aggressive",
      contextWindow: 5_000,
      currentInputTokens: 300,
      providerInputTokens: 14_321,
    });
    const transmitted = `${result.messages.map((item) => item.content).join("\n")}\n${result.handoff ?? ""}`;
    for (const literal of [
      "src/payments/retry.ts:417",
      "98317",
      "req_7f91",
      "1200.55",
      "E_RETRY_42",
    ])
      expect(transmitted).toContain(literal);
    expect(result.stats.providerTokenCountUsed).toBe(true);
    expect(result.fidelity.passed).toBe(true);
  });

  it("stores oversized old tool output by reference while preserving its header, tail and error", () => {
    const output = `header-id=abc123\n${"ordinary line\n".repeat(5_000)}Error: exit code 17\ntail-id=xyz789`;
    const result = optimizeConversationContext(
      [
        message("call", "assistant", '{"cmd":"test"}', {
          contentKind: "tool-call",
          toolCallId: "tool-large",
        }),
        message("result", "assistant", output, {
          contentKind: "tool-result",
          toolResultFor: "tool-large",
        }),
        ...Array.from({ length: 5 }, (_, index) =>
          message(`turn-${index}`, index % 2 ? "assistant" : "user", `turno ${index}`),
        ),
      ],
      {
        mode: "balanced",
        contextWindow: 12_000,
        storeToolResult: () => "artifact://large-result",
      },
    );
    const stored = result.messages.find((item) => item.id === "result");
    expect(stored?.content).toContain("artifact://large-result");
    expect(stored?.content).toContain("header-id=abc123");
    expect(stored?.content).toContain("Error: exit code 17");
    expect(stored?.content).toContain("tail-id=xyz789");
    expect(result.stats.techniques).toContain("tool-result-reference");
  });

  it("rejects an over-budget payload instead of dropping protected content or overflowing the model", () => {
    const result = optimizeConversationContext(
      [message("protected", "system", "regra vinculante ".repeat(2_000))],
      {
        mode: "off",
        contextWindow: 2_000,
        currentInputTokens: 500,
      },
    );
    expect(result.messages[0]?.content).toContain("regra vinculante");
    expect(result.fidelity.passed).toBe(false);
    expect(result.fidelity.reasons).toContain("context-budget-exceeded");
  });
});
