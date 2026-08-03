import type { ProviderConnectionSummary, ProviderSummary } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { routeModel } from "../src/router.js";

function provider(
  id: string,
  ready: boolean,
  coding: boolean,
  structuredOutput: boolean,
  options: {
    kind?: "cli" | "api" | "local";
    quality?: number;
    inputPrice?: number | null;
    outputPrice?: number | null;
  } = {},
): ProviderSummary {
  return {
    descriptor: {
      id,
      name: id,
      kind: options.kind ?? "cli",
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
        ...(options.quality === undefined ? {} : { quality: { coding: options.quality } }),
        ...(options.inputPrice === undefined && options.outputPrice === undefined
          ? {}
          : {
              pricing: {
                inputUsdPerMillion: options.inputPrice ?? null,
                outputUsdPerMillion: options.outputPrice ?? null,
              },
            }),
      },
    ],
    configSchema: { providerId: id, fields: [] },
    configValues: {},
    configured: true,
  };
}

function connection(
  providerId: "codex" | "claude-code",
  id: string,
  activeSessions: number,
): ProviderConnectionSummary {
  const base = provider(providerId, true, true, true);
  const timestamp = new Date().toISOString();
  return {
    connection: {
      id,
      providerId,
      name: id,
      billingMode: "subscription",
      enabled: true,
      isDefault: id === "primary",
      stateDirectory: null,
      priority: id === "primary" ? 0 : 1,
      concurrencyLimit: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
    },
    health: { ...base.health, connectionId: id },
    models: base.models,
    activeSessions,
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

  it("filters quality and open circuits before minimizing expected marginal cost", () => {
    const decision = routeModel({
      role: "implementer",
      providers: [
        provider("cheap-open", true, true, true, {
          kind: "api",
          quality: 0.9,
          inputPrice: 0.1,
          outputPrice: 0.1,
        }),
        provider("too-weak", true, true, true, {
          kind: "api",
          quality: 0.3,
          inputPrice: 0.01,
          outputPrice: 0.01,
        }),
        provider("eligible", true, true, true, {
          kind: "api",
          quality: 0.8,
          inputPrice: 2,
          outputPrice: 4,
        }),
      ],
      requirements: { coding: true, tools: true },
      profile: "deep",
      estimatedInputTokens: 10_000,
      estimatedOutputTokens: 2_000,
      telemetry: [
        {
          providerId: "cheap-open",
          connectionId: null,
          modelId: "model",
          successes: 1,
          failures: 3,
          consecutiveFailures: 3,
          latencyEwmaMs: 50,
          successRate: 0.25,
          quotaRemaining: null,
          quotaLimit: null,
          activeSessions: 0,
          concurrencyLimit: null,
          cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
          circuitState: "open",
          cachedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    expect(decision.selection.providerId).toBe("eligible");
    expect(
      decision.candidates.find((candidate) => candidate.selection.providerId === "cheap-open")
        ?.excludedReasons,
    ).toContain("circuit-open");
    expect(
      decision.candidates.find((candidate) => candidate.selection.providerId === "too-weak")
        ?.excludedReasons,
    ).toContain("quality-floor");
  });

  it("keeps manual pins first but permits technical failover unless disabled", () => {
    const providers = [
      provider("manual", true, true, true),
      provider("fallback", true, true, true),
    ];
    const withFallback = routeModel({
      role: "implementer",
      providers,
      requirements: { coding: true },
      pin: { providerId: "manual", modelId: "model" },
    });
    expect(withFallback.source).toBe("pinned");
    expect(withFallback.fallbackAllowed).toBe(true);
    const withoutFallback = routeModel({
      role: "implementer",
      providers,
      requirements: { coding: true },
      pin: { providerId: "manual", modelId: "model" },
      noFallback: true,
    });
    expect(withoutFallback.fallbackAllowed).toBe(false);
  });

  it("routes subscription accounts independently and respects connection pins and headroom", () => {
    const providers = [provider("codex", true, true, true)];
    const connections = [connection("codex", "primary", 1), connection("codex", "spare", 0)];
    const automatic = routeModel({
      role: "implementer",
      providers,
      connections,
      requirements: { coding: true },
    });
    expect(automatic.selection.connectionId).toBe("spare");
    expect(
      automatic.candidates.find((candidate) => candidate.selection.connectionId === "primary")
        ?.excludedReasons,
    ).toContain("concurrency-limit");
    const pinned = routeModel({
      role: "implementer",
      providers,
      connections,
      requirements: { coding: true },
      pin: { providerId: "codex", connectionId: "spare", modelId: "model" },
    });
    expect(pinned.source).toBe("pinned");
    expect(pinned.selection.connectionId).toBe("spare");
  });

  it("uses latency first for the fast profile and cost first for the economical profile", () => {
    const providers = [
      provider("cheap", true, true, true, {
        kind: "api",
        quality: 0.8,
        inputPrice: 0.1,
        outputPrice: 0.2,
      }),
      provider("quick", true, true, true, {
        kind: "api",
        quality: 0.8,
        inputPrice: 3,
        outputPrice: 6,
      }),
    ];
    const timestamp = new Date().toISOString();
    const metric = (providerId: string, latencyEwmaMs: number) => ({
      providerId,
      connectionId: null,
      modelId: "model",
      successes: 10,
      failures: 0,
      consecutiveFailures: 0,
      latencyEwmaMs,
      successRate: 1,
      quotaRemaining: null,
      quotaLimit: null,
      activeSessions: 0,
      concurrencyLimit: null,
      cooldownUntil: null,
      circuitState: "closed" as const,
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      updatedAt: timestamp,
    });
    const telemetry = [metric("cheap", 2_000), metric("quick", 100)];
    expect(
      routeModel({
        role: "implementer",
        providers,
        requirements: { coding: true },
        profile: "fast",
        telemetry,
        estimatedInputTokens: 10_000,
        estimatedOutputTokens: 2_000,
      }).selection.providerId,
    ).toBe("quick");
    expect(
      routeModel({
        role: "implementer",
        providers,
        requirements: { coding: true },
        profile: "economical",
        telemetry,
        estimatedInputTokens: 10_000,
        estimatedOutputTokens: 2_000,
      }).selection.providerId,
    ).toBe("cheap");
  });

  it("allows one half-open probe after the persisted circuit cooldown expires", () => {
    const timestamp = new Date().toISOString();
    const decision = routeModel({
      role: "implementer",
      providers: [provider("recovering", true, true, true)],
      requirements: { coding: true },
      now: new Date("2026-08-03T12:00:00.000Z"),
      telemetry: [
        {
          providerId: "recovering",
          connectionId: null,
          modelId: "model",
          successes: 1,
          failures: 3,
          consecutiveFailures: 3,
          latencyEwmaMs: 100,
          successRate: 0.25,
          quotaRemaining: null,
          quotaLimit: null,
          activeSessions: 0,
          concurrencyLimit: null,
          cooldownUntil: "2026-08-03T11:59:00.000Z",
          circuitState: "open",
          cachedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          updatedAt: timestamp,
        },
      ],
    });
    expect(decision.selection.providerId).toBe("recovering");
    expect(decision.candidates[0]?.circuitState).toBe("half_open");
  });
});
