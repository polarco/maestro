import type { ProviderSummary } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { routeModel } from "../src/router.js";

function provider(
  id: string,
  ready: boolean,
  coding: boolean,
  structuredOutput: boolean,
): ProviderSummary {
  return {
    descriptor: {
      id,
      name: id,
      kind: "cli",
      description: id,
      supportsStructuredSessions: true,
      supportsPty: false,
    },
    health: {
      providerId: id,
      status: ready ? "ready" : "unavailable",
      installed: ready,
      authenticated: ready,
      version: "1",
      message: "ok",
      checkedAt: new Date().toISOString(),
    },
    models: [
      {
        id: "model",
        name: "Model",
        isDefault: true,
        capabilities: {
          chat: true,
          coding,
          tools: coding,
          vision: false,
          reasoningEffort: ["low", "medium", "high"],
          structuredOutput,
          contextWindow: 200_000,
        },
      },
    ],
    configSchema: { providerId: id, fields: [] },
    configValues: {},
    configured: true,
  };
}

describe("deterministic router", () => {
  it("honors a compatible user-fixed model", () => {
    const decision = routeModel({
      role: "implementer",
      providers: [provider("codex", true, true, true)],
      requirements: { coding: true },
      fixed: { providerId: "codex", modelId: "model", effort: "high" },
    });
    expect(decision.source).toBe("fixed");
  });

  it("rejects an unavailable fixed model instead of silently rerouting", () => {
    expect(() =>
      routeModel({
        role: "planner",
        providers: [provider("api", false, false, true)],
        requirements: { structuredOutput: true },
        fixed: { providerId: "api", modelId: "model" },
      }),
    ).toThrow("não está disponível");
  });

  it("falls back according to compatibility and preference", () => {
    const decision = routeModel({
      role: "planner",
      providers: [provider("coding", true, true, false), provider("api", true, false, true)],
      requirements: { chat: true, structuredOutput: true },
      preferredProviderIds: ["api", "coding"],
    });
    expect(decision.selection.providerId).toBe("api");
  });
});
