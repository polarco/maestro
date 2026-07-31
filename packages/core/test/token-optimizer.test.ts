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
  it("uses the quick estimate and OmniRoute-compatible context fallbacks", () => {
    expect(estimateTokens("12345")).toBe(2);
    expect(resolveModelContextWindow("codex", "default", null)).toBe(400_000);
    expect(resolveModelContextWindow("claude-code", "sonnet", null)).toBe(200_000);
    expect(resolveModelContextWindow("openai-compatible", "openai/gpt-4o", null)).toBe(128_000);
    expect(resolveModelContextWindow("anthropic", "claude-sonnet-4.6", null)).toBe(1_000_000);
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
});
