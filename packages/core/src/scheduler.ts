import type { TaskSpec, TaskState } from "@maestro/contracts";
import { assertValidDag, blockedByFailedDependency, runnableTasks } from "./dag.js";
import { MaestroError } from "./errors.js";

export interface SchedulerOptions {
  globalConcurrency: number;
  providerConcurrency?: Readonly<Record<string, number>>;
  signal?: AbortSignal;
  onState?: (
    task: TaskSpec,
    from: TaskState,
    to: TaskState,
    detail?: string,
  ) => void | Promise<void>;
}

export interface TaskExecutionResult {
  state: "completed" | "failed" | "canceled";
  error?: string;
}

export type TaskExecutor = (task: TaskSpec, signal: AbortSignal) => Promise<TaskExecutionResult>;

export interface SchedulerResult {
  states: Map<string, TaskState>;
  failed: string[];
  canceled: string[];
  completed: string[];
}

interface ActiveTask {
  task: TaskSpec;
  promise: Promise<{ task: TaskSpec; result: TaskExecutionResult }>;
  controller: AbortController;
}

export class DagScheduler {
  readonly #options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    if (!Number.isInteger(options.globalConcurrency) || options.globalConcurrency < 1) {
      throw new MaestroError(
        "INVALID_CONCURRENCY",
        "A concorrência global deve ser maior que zero.",
      );
    }
    this.#options = options;
  }

  async run(tasks: readonly TaskSpec[], executor: TaskExecutor): Promise<SchedulerResult> {
    assertValidDag(tasks);
    const states = new Map<string, TaskState>(tasks.map((task) => [task.id, "pending"]));
    const active = new Map<string, ActiveTask>();
    const providerCounts = new Map<string, number>();
    const workspaceWriters = new Set<string>();
    let aborted = this.#options.signal?.aborted ?? false;

    const abortListener = () => {
      aborted = true;
      for (const item of active.values()) item.controller.abort();
    };
    this.#options.signal?.addEventListener("abort", abortListener, { once: true });

    const setState = async (task: TaskSpec, to: TaskState, detail?: string) => {
      const from = states.get(task.id) ?? "pending";
      states.set(task.id, to);
      await this.#options.onState?.(task, from, to, detail);
    };

    const canStart = (task: TaskSpec): boolean => {
      if (active.size >= this.#options.globalConcurrency) return false;
      const providerId = task.model.connectionId ?? task.model.providerId;
      const providerLimit =
        this.#options.providerConcurrency?.[providerId] ?? this.#options.globalConcurrency;
      if ((providerCounts.get(providerId) ?? 0) >= providerLimit) return false;
      if (
        task.workspaceStrategy === "single-writer" &&
        workspaceWriters.has(task.workspaceRootId)
      ) {
        return false;
      }
      return true;
    };

    try {
      while (true) {
        if (aborted) {
          for (const task of tasks) {
            if ((states.get(task.id) ?? "pending") === "pending") await setState(task, "canceled");
          }
        }

        for (const task of blockedByFailedDependency(tasks, states)) {
          await setState(task, "skipped", "Dependência não concluída.");
        }

        if (!aborted) {
          for (const task of runnableTasks(tasks, states)) {
            if (!canStart(task)) continue;
            await setState(task, "queued");
            const controller = new AbortController();
            if (this.#options.signal?.aborted) controller.abort();
            const providerId = task.model.connectionId ?? task.model.providerId;
            providerCounts.set(providerId, (providerCounts.get(providerId) ?? 0) + 1);
            if (task.workspaceStrategy === "single-writer")
              workspaceWriters.add(task.workspaceRootId);
            await setState(task, "running");
            const promise = executor(task, controller.signal)
              .then((result) => ({ task, result }))
              .catch((error: unknown) => ({
                task,
                result: {
                  state: controller.signal.aborted ? "canceled" : "failed",
                  error: error instanceof Error ? error.message : String(error),
                } satisfies TaskExecutionResult,
              }));
            active.set(task.id, { task, promise, controller });
          }
        }

        if (active.size === 0) {
          const unfinished = tasks.filter((task) => {
            const state = states.get(task.id);
            return state === "pending" || state === "queued" || state === "running";
          });
          if (unfinished.length === 0) break;
          throw new MaestroError(
            "SCHEDULER_DEADLOCK",
            `Scheduler sem progresso: ${unfinished.map((task) => task.id).join(", ")}`,
          );
        }

        const settled = await Promise.race([...active.values()].map((item) => item.promise));
        const activeTask = active.get(settled.task.id);
        if (!activeTask) continue;
        active.delete(settled.task.id);
        const providerId = settled.task.model.connectionId ?? settled.task.model.providerId;
        providerCounts.set(providerId, Math.max(0, (providerCounts.get(providerId) ?? 1) - 1));
        if (settled.task.workspaceStrategy === "single-writer") {
          workspaceWriters.delete(settled.task.workspaceRootId);
        }
        await setState(settled.task, settled.result.state, settled.result.error);
      }
    } finally {
      this.#options.signal?.removeEventListener("abort", abortListener);
    }

    return {
      states,
      failed: tasks.filter((task) => states.get(task.id) === "failed").map((task) => task.id),
      canceled: tasks.filter((task) => states.get(task.id) === "canceled").map((task) => task.id),
      completed: tasks.filter((task) => states.get(task.id) === "completed").map((task) => task.id),
    };
  }
}
