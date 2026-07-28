import { mkdir } from "node:fs/promises";
import path from "node:path";
import { MaestroError } from "@maestro/core";
import type { ProcessSupervisor } from "./process-supervisor.js";

export interface GitWorkspaceInfo {
  isGit: boolean;
  root: string;
  repositoryRoot: string | null;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  status: string;
}

export interface RunGitContext {
  runId: string;
  repositoryRoot: string;
  sourceRoot: string;
  sourceBranch: string;
  baseHead: string;
  initiallyDirty: boolean;
}

export interface TaskWorktree {
  taskId: string;
  path: string;
  repositoryPath: string;
  branch: string;
}

export interface IntegrationResult {
  branch: string;
  path: string;
  appliedToSource: boolean;
  conflict: boolean;
  message: string;
}

function safeRefPart(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe.slice(0, 60) || "task";
}

export class GitService {
  readonly #supervisor: ProcessSupervisor;
  readonly #worktreeBase: string;
  #worktreeMutation: Promise<void> = Promise.resolve();

  constructor(supervisor: ProcessSupervisor, userDataDirectory: string) {
    this.#supervisor = supervisor;
    this.#worktreeBase = path.join(userDataDirectory, "worktrees");
  }

  async inspect(root: string): Promise<GitWorkspaceInfo> {
    const repositoryRoot = await this.#git(
      ["-C", root, "rev-parse", "--show-toplevel"],
      root,
      true,
    );
    if (!repositoryRoot.ok) {
      return {
        isGit: false,
        root,
        repositoryRoot: null,
        branch: null,
        head: null,
        dirty: false,
        status: "",
      };
    }
    const [branch, head, status] = await Promise.all([
      this.#git(["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], root),
      this.#git(["-C", root, "rev-parse", "HEAD"], root),
      this.#git(["-C", root, "status", "--porcelain=v1", "--untracked-files=normal"], root),
    ]);
    return {
      isGit: true,
      root,
      repositoryRoot: repositoryRoot.stdout,
      branch: branch.stdout,
      head: head.stdout,
      dirty: Boolean(status.stdout.trim()),
      status: status.stdout,
    };
  }

  async beginRun(runId: string, sourceRoot: string): Promise<RunGitContext | null> {
    const info = await this.inspect(sourceRoot);
    if (!info.isGit || !info.repositoryRoot || !info.branch || !info.head) return null;
    if (info.branch === "HEAD") {
      throw new MaestroError(
        "DETACHED_HEAD",
        "O workspace está em detached HEAD; crie ou selecione um branch antes de executar.",
        { recoverable: true },
      );
    }
    return {
      runId,
      repositoryRoot: info.repositoryRoot,
      sourceRoot,
      sourceBranch: info.branch,
      baseHead: info.head,
      initiallyDirty: info.dirty,
    };
  }

  async createTaskWorktree(
    context: RunGitContext,
    taskId: string,
    dependencyCommits: readonly string[] = [],
  ): Promise<TaskWorktree> {
    const runPart = safeRefPart(context.runId);
    const taskPart = safeRefPart(taskId);
    const worktreeRoot = path.join(this.#worktreeBase, runPart, "tasks", taskPart);
    const branch = `maestro/${runPart}/task/${taskPart}`;
    await mkdir(path.dirname(worktreeRoot), { recursive: true });
    const add = await this.#serializeWorktreeMutation(() =>
      this.#git(
        [
          "-C",
          context.repositoryRoot,
          "worktree",
          "add",
          "-b",
          branch,
          worktreeRoot,
          context.baseHead,
        ],
        context.repositoryRoot,
        true,
        60_000,
      ),
    );
    if (!add.ok) {
      throw new MaestroError(
        "WORKTREE_CREATE_FAILED",
        add.stderr || add.stdout || `Falha ao criar worktree ${taskId}.`,
        { recoverable: true },
      );
    }
    for (const commit of dependencyCommits) {
      const cherryPick = await this.#git(
        ["-C", worktreeRoot, "cherry-pick", commit],
        worktreeRoot,
        true,
        60_000,
      );
      if (!cherryPick.ok) {
        await this.#git(["-C", worktreeRoot, "cherry-pick", "--abort"], worktreeRoot, true);
        throw new MaestroError(
          "DEPENDENCY_INTEGRATION_FAILED",
          `Conflito ao preparar ${taskId} com a dependência ${commit}.`,
          { recoverable: true, detail: cherryPick.stderr },
        );
      }
    }
    return {
      taskId,
      path: this.#scopedPath(context, worktreeRoot),
      repositoryPath: worktreeRoot,
      branch,
    };
  }

  async commitTask(worktree: TaskWorktree, title: string): Promise<string | null> {
    const status = await this.#git(
      ["-C", worktree.path, "status", "--porcelain=v1", "--", "."],
      worktree.path,
    );
    if (!status.stdout.trim()) return null;
    await this.#gitOrThrow(
      ["-C", worktree.path, "add", "--all", "--", "."],
      worktree.path,
      "Não foi possível preparar as alterações.",
    );
    await this.#gitOrThrow(
      [
        "-C",
        worktree.repositoryPath,
        "-c",
        "user.name=Maestro",
        "-c",
        "user.email=maestro@local",
        "commit",
        "--no-verify",
        "-m",
        `maestro: ${title}`,
      ],
      worktree.repositoryPath,
      "Não foi possível criar o commit da tarefa.",
      60_000,
    );
    return (
      await this.#git(["-C", worktree.repositoryPath, "rev-parse", "HEAD"], worktree.repositoryPath)
    ).stdout;
  }

  async integrate(context: RunGitContext, commits: readonly string[]): Promise<IntegrationResult> {
    const runPart = safeRefPart(context.runId);
    const integrationRoot = path.join(this.#worktreeBase, runPart, "integration");
    const branch = `maestro/${runPart}/integration`;
    await mkdir(path.dirname(integrationRoot), { recursive: true });
    const add = await this.#serializeWorktreeMutation(() =>
      this.#git(
        [
          "-C",
          context.repositoryRoot,
          "worktree",
          "add",
          "-b",
          branch,
          integrationRoot,
          context.baseHead,
        ],
        context.repositoryRoot,
        true,
        60_000,
      ),
    );
    if (!add.ok) {
      throw new MaestroError(
        "INTEGRATION_WORKTREE_FAILED",
        add.stderr || "Não foi possível criar a worktree de integração.",
        { recoverable: true },
      );
    }
    const integrationPath = this.#scopedPath(context, integrationRoot);

    for (const commit of commits) {
      const result = await this.#git(
        ["-C", integrationRoot, "cherry-pick", commit],
        integrationRoot,
        true,
        60_000,
      );
      if (!result.ok) {
        return {
          branch,
          path: integrationPath,
          appliedToSource: false,
          conflict: true,
          message: `Conflito ao integrar ${commit}. O estado foi preservado em ${branch}.`,
        };
      }
    }

    const current = await this.inspect(context.sourceRoot);
    const safeToApply =
      !context.initiallyDirty &&
      current.isGit &&
      !current.dirty &&
      current.branch === context.sourceBranch &&
      current.head === context.baseHead;
    if (!safeToApply) {
      return {
        branch,
        path: integrationPath,
        appliedToSource: false,
        conflict: false,
        message: `Resultado preservado em ${branch}; o workspace original mudou ou possui alterações locais.`,
      };
    }

    const merge = await this.#git(
      ["-C", context.sourceRoot, "merge", "--ff-only", branch],
      context.sourceRoot,
      true,
      60_000,
    );
    if (!merge.ok) {
      return {
        branch,
        path: integrationPath,
        appliedToSource: false,
        conflict: false,
        message: `Fast-forward não foi seguro; resultado preservado em ${branch}.`,
      };
    }
    return {
      branch,
      path: integrationPath,
      appliedToSource: true,
      conflict: false,
      message: "Integração aplicada ao branch de origem por fast-forward.",
    };
  }

  async #git(
    args: string[],
    cwd: string,
    allowFailure = false,
    timeoutMs = 30_000,
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const result = await this.#supervisor
      .capture(
        { executable: "git", args, cwd, label: "Git" },
        { timeoutMs, maxOutputBytes: 2 * 1024 * 1024 },
      )
      .catch((error: unknown) => ({
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
      }));
    const value = {
      ok: result.exitCode === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
    if (!value.ok && !allowFailure) {
      throw new MaestroError(
        "GIT_COMMAND_FAILED",
        value.stderr || `git ${args.join(" ")} falhou.`,
        { recoverable: true },
      );
    }
    return value;
  }

  async #gitOrThrow(
    args: string[],
    cwd: string,
    message: string,
    timeoutMs = 30_000,
  ): Promise<void> {
    const result = await this.#git(args, cwd, true, timeoutMs);
    if (!result.ok)
      throw new MaestroError("GIT_COMMAND_FAILED", `${message} ${result.stderr}`.trim(), {
        recoverable: true,
      });
  }

  #scopedPath(context: RunGitContext, worktreeRoot: string): string {
    const relative = path.relative(context.repositoryRoot, context.sourceRoot);
    if (relative === "") return worktreeRoot;
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new MaestroError(
        "WORKSPACE_OUTSIDE_REPOSITORY",
        "A raiz selecionada não pertence ao repositório detectado.",
      );
    }
    return path.join(worktreeRoot, relative);
  }

  #serializeWorktreeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#worktreeMutation.then(operation, operation);
    this.#worktreeMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
