import type { TaskSpec } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { runnableTasks, validateDag } from "../src/dag.js";

function task(id: string, dependencies: string[] = []): TaskSpec {
  return {
    id,
    title: id,
    description: `Task ${id}`,
    role: "implementer",
    dependencies,
    workspaceRootId: "root",
    workspaceStrategy: "worktree",
    model: { providerId: "codex", modelId: "default", effort: "medium" },
    tools: [],
    validationCommands: [],
    successCriteria: ["feito"],
  };
}

describe("DAG", () => {
  it("builds parallel levels", () => {
    const result = validateDag([task("a"), task("b"), task("c", ["a", "b"])]);
    expect(result.valid).toBe(true);
    expect(result.levels).toEqual([["a", "b"], ["c"]]);
  });

  it("detects cycles and unknown dependencies", () => {
    const cycle = validateDag([task("a", ["b"]), task("b", ["a"])]);
    expect(cycle.valid).toBe(false);
    expect(cycle.errors.join(" ")).toContain("Ciclo");
    expect(validateDag([task("a", ["missing"])]).valid).toBe(false);
  });

  it("only returns tasks whose dependencies completed", () => {
    const tasks = [task("a"), task("b", ["a"])];
    expect(runnableTasks(tasks, new Map([["a", "pending"]])).map((item) => item.id)).toEqual(["a"]);
    expect(runnableTasks(tasks, new Map([["a", "completed"]])).map((item) => item.id)).toEqual([
      "b",
    ]);
  });
});
