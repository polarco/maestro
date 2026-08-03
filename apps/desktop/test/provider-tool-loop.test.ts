import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ExecutionPolicy,
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatMessage,
  ProviderChatResult,
} from "@maestro/contracts";
import { MaestroRepository } from "@maestro/database";
import {
  executionPolicyHash,
  PolicyToolExecutor,
  ToolRegistry,
  TurnCoordinator,
} from "@maestro/core";
import { describe, expect, it, vi } from "vitest";
import { ProviderToolLoop } from "../src/main/services/provider-tool-loop.js";

function adapter(id: string, chat: ProviderAdapter["chat"], safeRetry = true): ProviderAdapter {
  return {
    descriptor: {
      id,
      name: id,
      kind: "api",
      description: id,
      supportsStructuredSessions: false,
      supportsPty: false,
    },
    configSchema: { providerId: id, fields: [] },
    capabilities: {
      nativeLoop: false,
      tools: true,
      mcp: false,
      tokenization: "estimated",
      promptCache: false,
      pricing: true,
      safeRetry,
      checkpointResume: true,
      steering: false,
    },
    detect: () => Promise.reject(new Error("unused")),
    listModels: () => Promise.resolve([]),
    createSession: () => Promise.reject(new Error("unused")),
    resumeSession: () => Promise.reject(new Error("unused")),
    send: () => Promise.reject(new Error("unused")),
    steer: () => Promise.reject(new Error("unused")),
    cancel: () => Promise.resolve(),
    ...(chat ? { chat } : {}),
    dispose: () => Promise.resolve(),
  };
}

function policy(root: string): ExecutionPolicy {
  const value: Omit<ExecutionPolicy, "scopeHash"> = {
    readableRoots: [root],
    writableRoots: [],
    allowedTools: ["fixture.read"],
    allowedExecutables: [],
    network: "denied",
    externalMutations: false,
    writeApproved: false,
    approvalId: null,
    approvedPlanVersion: null,
  };
  return { ...value, scopeHash: executionPolicyHash(value) };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-provider-loop-"));
  const repository = new MaestroRepository(path.join(directory, "maestro.db"));
  const project = await repository.createProject({
    name: "Fixture",
    path: directory,
    canonicalPath: directory,
    displayName: "fixture",
  });
  const conversation = await repository.createConversation({
    projectId: project.id,
    title: "Fixture",
    mode: "maestro",
    sessionKind: "structured",
    workspaceRootId: project.roots[0]!.id,
  });
  const turn = await new TurnCoordinator(repository).start({
    conversationId: conversation.id,
    sequence: 1,
    prompt: "Leia a fixture",
    readableRoots: [directory],
    hasWorkspace: true,
    intent: {
      path: "research",
      category: "workspace_question",
      confidence: 1,
      rationale: "fixture",
      requiresWorkspace: true,
      requiresApproval: false,
      materialDecisions: [],
      requestedCapabilities: ["workspace-read"],
    },
  });
  const registry = new ToolRegistry();
  const execute = vi.fn(() => Promise.resolve({ output: { value: 42 } }));
  registry.register(
    {
      name: "fixture.read",
      title: "Fixture read",
      description: "Reads a deterministic fixture",
      category: "filesystem",
      mutability: "read",
      inputSchema: { type: "object" },
      outputSchema: null,
      requiresApproval: false,
      idempotent: true,
    },
    execute,
  );
  return {
    directory,
    repository,
    turn: await repository.updateTurn(turn.id, { policy: policy(directory) }),
    executor: new PolicyToolExecutor({ registry, persistence: repository }),
    execute,
  };
}

describe("provider-owned tool loop", () => {
  it("persists tool pairs and a safe checkpoint before returning the answer", async () => {
    const value = await fixture();
    const requests: ProviderChatMessage[][] = [];
    const chat = vi.fn((request: ProviderChatRequest): Promise<ProviderChatResult> => {
      requests.push(request.messages);
      if (requests.length === 1)
        return Promise.resolve({
          content: "",
          model: "model",
          providerMessageId: "one",
          toolCalls: [{ id: "call-1", name: "fixture_read", input: {} }],
          finishReason: "tool_calls",
          usage: { inputTokens: 10, outputTokens: 2 },
        });
      return Promise.resolve({
        content: "Valor 42.",
        model: "model",
        providerMessageId: "two",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 4, cachedTokens: 3, costUsd: 0.01 },
      });
    });
    const fixtureAdapter = adapter("fixture", chat);
    const loop = new ProviderToolLoop({
      repository: value.repository,
      executor: value.executor,
      resolveAdapter: () => fixtureAdapter,
    });
    const result = await loop.run({
      turn: value.turn,
      runId: null,
      messages: [{ role: "user", content: "Leia" }],
      selection: { providerId: "fixture", modelId: "model" },
      policy: value.turn.policy,
      objective: "Leia a fixture",
    });
    expect(result.content).toBe("Valor 42.");
    expect(result.checkpoint.safeToResume).toBe(true);
    expect(value.execute).toHaveBeenCalledTimes(1);
    expect(requests[1]?.some((message) => message.role === "tool")).toBe(true);
    expect(
      value.repository.sqlite.prepare("SELECT COUNT(*) AS count FROM tool_calls").get(),
    ).toEqual({ count: 1 });
    expect(
      value.repository.sqlite.prepare("SELECT COUNT(*) AS count FROM tool_results").get(),
    ).toEqual({ count: 1 });
    value.repository.close();
  });

  it("fails over only from a safe checkpoint and records the recovery", async () => {
    const value = await fixture();
    const primary = adapter(
      "primary",
      () => Promise.reject(new Error("503 temporarily unavailable")),
      false,
    );
    const fallback = adapter("fallback", () =>
      Promise.resolve({
        content: "Retomado.",
        model: "fallback-model",
        providerMessageId: "fallback-message",
        finishReason: "stop",
        usage: {},
      }),
    );
    const events: string[] = [];
    const loop = new ProviderToolLoop({
      repository: value.repository,
      executor: value.executor,
      resolveAdapter: (selection) => (selection.providerId === "primary" ? primary : fallback),
    });
    const result = await loop.run({
      turn: value.turn,
      runId: null,
      messages: [{ role: "user", content: "Continue" }],
      selection: { providerId: "primary", modelId: "primary-model" },
      fallbackSelections: [{ providerId: "fallback", modelId: "fallback-model" }],
      policy: value.turn.policy,
      objective: "Continue",
      onEvent: (event) => {
        events.push(event.type);
      },
    });
    expect(result.selection.providerId).toBe("fallback");
    expect(events).toContain("route.fallback");
    expect(
      value.repository.sqlite.prepare("SELECT COUNT(*) AS count FROM recovery_attempts").get(),
    ).toEqual({ count: 1 });
    const recovery = value.repository.sqlite
      .prepare("SELECT attempt FROM recovery_attempts LIMIT 1")
      .get() as { attempt: string };
    expect(JSON.parse(recovery.attempt)).toMatchObject({
      kind: "failover",
      outcome: "succeeded",
    });
    value.repository.close();
  });
});
