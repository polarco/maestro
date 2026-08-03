import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecutionPolicy, ToolCall, ToolResult } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { assertStructuredCommandAllowed } from "../src/command-policy.js";
import { executionPolicyHash } from "../src/turn-coordinator.js";
import {
  PolicyToolExecutor,
  ToolRegistry,
  createBuiltinToolRegistry,
} from "../src/tool-registry.js";

function policy(root: string, tools: string[]): ExecutionPolicy {
  const value: Omit<ExecutionPolicy, "scopeHash"> = {
    readableRoots: [root],
    writableRoots: [root],
    allowedTools: tools,
    allowedExecutables: [{ executable: "pnpm", argsPrefix: ["test"], cwdRoots: [root] }],
    network: "denied",
    externalMutations: false,
    writeApproved: true,
    approvalId: "approval-1",
    approvedPlanVersion: 1,
  };
  return { ...value, scopeHash: executionPolicyHash(value) };
}

describe("policy tool executor", () => {
  it("treats an empty tool allow-list as no tools", () => {
    const registry = createBuiltinToolRegistry();
    expect(registry.definitions(policy("/workspace", []))).toEqual([]);
  });

  it("returns a persisted idempotent result without repeating an effect", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "maestro-tool-"));
    const registry = new ToolRegistry();
    let effects = 0;
    registry.register(
      {
        name: "fixture.write",
        title: "Fixture",
        description: "Mutação de teste",
        category: "filesystem",
        mutability: "workspace",
        inputSchema: { type: "object" },
        outputSchema: null,
        requiresApproval: true,
        idempotent: true,
      },
      () => Promise.resolve({ output: { effects: ++effects } }),
    );
    const records = new Map<string, { call: ToolCall; result: ToolResult | null }>();
    const executor = new PolicyToolExecutor({
      registry,
      persistence: {
        findToolCallByIdempotencyKey: (key) => Promise.resolve(records.get(key) ?? null),
        createToolCall: (call) => {
          records.set(call.idempotencyKey, { call, result: null });
          return Promise.resolve();
        },
        updateToolCall: (call) => {
          const record = records.get(call.idempotencyKey)!;
          records.set(call.idempotencyKey, { ...record, call });
          return Promise.resolve();
        },
        saveToolResult: (result) => {
          const record = [...records.values()].find((item) => item.call.id === result.toolCallId)!;
          records.set(record.call.idempotencyKey, { ...record, result });
          return Promise.resolve();
        },
      },
    });
    const context = {
      turnId: "turn-1",
      runId: "run-1",
      policy: policy(root, ["fixture.write"]),
    };
    const first = await executor.execute("fixture.write", { value: 1 }, context, "stable-key");
    const second = await executor.execute("fixture.write", { value: 1 }, context, "stable-key");
    expect(first.result.output).toEqual({ effects: 1 });
    expect(second.result.id).toBe(first.result.id);
    expect(effects).toBe(1);
  });

  it("enforces executable, argument, cwd, network and external-effect boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "maestro-command-"));
    const approved = policy(root, ["command.run"]);
    await expect(
      assertStructuredCommandAllowed(
        { executable: "pnpm", args: ["test", "--runInBand"], timeoutMs: 1_000 },
        approved,
        root,
      ),
    ).resolves.toMatchObject({ executable: "pnpm", args: ["test", "--runInBand"] });
    await expect(
      assertStructuredCommandAllowed(
        { executable: "pnpm", args: ["build"], timeoutMs: 1_000 },
        approved,
        root,
      ),
    ).rejects.toThrow("argumentos");
    await expect(
      assertStructuredCommandAllowed(
        { executable: "bash", args: ["-lc", "pnpm test"], timeoutMs: 1_000 },
        approved,
        root,
      ),
    ).rejects.toThrow("Shell genérico");
  });
});
