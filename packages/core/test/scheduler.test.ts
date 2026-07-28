import type { TaskSpec } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { DagScheduler } from "../src/scheduler.js";

function task(
  id: string,
  dependencies: string[] = [],
  providerId = "codex",
  connectionId?: string,
): TaskSpec {
  return {
    id,
    title: id,
    description: id,
    role: "implementer",
    dependencies,
    workspaceRootId: "root",
    workspaceStrategy: "worktree",
    model: {
      providerId,
      ...(connectionId ? { connectionId } : {}),
      modelId: "model",
      effort: "medium",
    },
    tools: [],
    validationCommands: [],
    successCriteria: ["ok"],
  };
}

describe("DAG scheduler", () => {
  it("runs independent tasks concurrently and respects dependencies", async () => {
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const scheduler = new DagScheduler({ globalConcurrency: 2 });
    const result = await scheduler.run(
      [task("a"), task("b"), task("c", ["a", "b"])],
      async (item) => {
        started.push(item.id);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, item.id === "c" ? 1 : 10));
        active -= 1;
        return { state: "completed" };
      },
    );
    expect(peak).toBe(2);
    expect(started.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(started[2]).toBe("c");
    expect(result.completed).toHaveLength(3);
  });

  it("skips dependents of a failed task", async () => {
    const scheduler = new DagScheduler({ globalConcurrency: 2 });
    const result = await scheduler.run([task("a"), task("b", ["a"])], () =>
      Promise.resolve({
        state: "failed",
        error: "boom",
      }),
    );
    expect(result.states.get("a")).toBe("failed");
    expect(result.states.get("b")).toBe("skipped");
  });

  it("applies concurrency per account instead of collapsing all provider accounts", async () => {
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const scheduler = new DagScheduler({
      globalConcurrency: 4,
      providerConcurrency: { "codex-a": 1, "codex-b": 1 },
    });
    await scheduler.run(
      [
        task("a1", [], "codex", "codex-a"),
        task("a2", [], "codex", "codex-a"),
        task("b1", [], "codex", "codex-b"),
        task("b2", [], "codex", "codex-b"),
      ],
      async (item) => {
        const key = item.model.connectionId!;
        active.set(key, (active.get(key) ?? 0) + 1);
        peak.set(key, Math.max(peak.get(key) ?? 0, active.get(key)!));
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.set(key, active.get(key)! - 1);
        return { state: "completed" };
      },
    );
    expect(peak).toEqual(
      new Map([
        ["codex-a", 1],
        ["codex-b", 1],
      ]),
    );
  });
});
