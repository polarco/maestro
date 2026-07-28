import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/main/services/git-service.js";
import { ProcessSupervisor } from "../src/main/services/process-supervisor.js";

const execute = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

describe("GitService", () => {
  let repository: string;
  let dataDirectory: string;
  let supervisor: ProcessSupervisor;
  let service: GitService;

  beforeEach(async () => {
    repository = await mkdtemp(path.join(tmpdir(), "maestro-repository-"));
    dataDirectory = await mkdtemp(path.join(tmpdir(), "maestro-data-"));
    supervisor = new ProcessSupervisor();
    service = new GitService(supervisor, dataDirectory);
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.name", "Fixture"]);
    await git(repository, ["config", "user.email", "fixture@local"]);
    await mkdir(path.join(repository, "allowed"));
    await writeFile(path.join(repository, "allowed", "inside.txt"), "base\n", "utf8");
    await writeFile(path.join(repository, "outside.txt"), "outside base\n", "utf8");
    await git(repository, ["add", "--all"]);
    await git(repository, ["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await supervisor.killAll();
    await rm(repository, { recursive: true, force: true });
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it("maps a selected repository subdirectory to the same scoped worktree path", async () => {
    const sourceRoot = path.join(repository, "allowed");
    const context = await service.beginRun("scope-run", sourceRoot);
    expect(context).not.toBeNull();

    const worktree = await service.createTaskWorktree(context!, "implement");
    expect(worktree.path).toBe(path.join(worktree.repositoryPath, "allowed"));

    await writeFile(path.join(worktree.path, "created.txt"), "inside scope\n", "utf8");
    await writeFile(
      path.join(worktree.repositoryPath, "outside.txt"),
      "must not be committed\n",
      "utf8",
    );
    const commit = await service.commitTask(worktree, "scoped change");
    expect(commit).toBeTruthy();

    const changed = await git(worktree.repositoryPath, [
      "show",
      "--name-only",
      "--format=",
      commit!,
    ]);
    expect(changed.split("\n")).toEqual(["allowed/created.txt"]);

    const result = await service.integrate(context!, [commit!]);
    expect(result.appliedToSource).toBe(true);
    await expect(readFile(path.join(sourceRoot, "created.txt"), "utf8")).resolves.toBe(
      "inside scope\n",
    );
    await expect(readFile(path.join(repository, "outside.txt"), "utf8")).resolves.toBe(
      "outside base\n",
    );
  });

  it("serializes parallel worktree creation and carries dependency commits", async () => {
    const context = await service.beginRun("parallel-run", path.join(repository, "allowed"));
    expect(context).not.toBeNull();
    const [first, independent] = await Promise.all([
      service.createTaskWorktree(context!, "first"),
      service.createTaskWorktree(context!, "independent"),
    ]);
    expect(first.branch).not.toBe(independent.branch);

    await writeFile(path.join(first.path, "dependency.txt"), "dependency\n", "utf8");
    const dependency = await service.commitTask(first, "dependency");
    const dependent = await service.createTaskWorktree(context!, "dependent", [dependency!]);
    await expect(readFile(path.join(dependent.path, "dependency.txt"), "utf8")).resolves.toBe(
      "dependency\n",
    );
  });

  it("preserves the integration branch when the source becomes dirty", async () => {
    const context = await service.beginRun("dirty-run", path.join(repository, "allowed"));
    expect(context?.initiallyDirty).toBe(false);
    const worktree = await service.createTaskWorktree(context!, "change");
    await writeFile(path.join(worktree.path, "result.txt"), "result\n", "utf8");
    const commit = await service.commitTask(worktree, "result");
    await writeFile(path.join(repository, "outside.txt"), "user edit\n", "utf8");

    const result = await service.integrate(context!, [commit!]);
    expect(result.appliedToSource).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.branch).toBe("maestro/dirty-run/integration");
    await expect(
      readFile(path.join(repository, "allowed", "result.txt"), "utf8"),
    ).rejects.toThrow();
    expect(await git(repository, ["rev-parse", "--verify", result.branch])).toBeTruthy();
  });

  it("keeps a conflicting cherry-pick recoverable in the integration worktree", async () => {
    const context = await service.beginRun("conflict-run", path.join(repository, "allowed"));
    const [left, right] = await Promise.all([
      service.createTaskWorktree(context!, "left"),
      service.createTaskWorktree(context!, "right"),
    ]);
    await writeFile(path.join(left.path, "inside.txt"), "left\n", "utf8");
    await writeFile(path.join(right.path, "inside.txt"), "right\n", "utf8");
    const leftCommit = await service.commitTask(left, "left");
    const rightCommit = await service.commitTask(right, "right");

    const result = await service.integrate(context!, [leftCommit!, rightCommit!]);
    expect(result.appliedToSource).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.path).toContain(path.join("conflict-run", "integration", "allowed"));
  });
});
