import type { TaskSpec, TaskState } from "@maestro/contracts";
import { MaestroError } from "./errors.js";

export interface DagValidation {
  valid: boolean;
  errors: string[];
  topologicalOrder: string[];
  levels: string[][];
}

export function validateDag(tasks: readonly TaskSpec[]): DagValidation {
  const errors: string[] = [];
  const byId = new Map<string, TaskSpec>();

  for (const task of tasks) {
    if (byId.has(task.id)) errors.push(`Task id duplicado: ${task.id}`);
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency))
        errors.push(`${task.id} depende de uma task inexistente: ${dependency}`);
      if (dependency === task.id) errors.push(`${task.id} depende de si mesma`);
    }
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.filter((id) => byId.has(id) && id !== task.id).length);
    for (const dependency of task.dependencies) {
      const values = dependents.get(dependency) ?? [];
      values.push(task.id);
      dependents.set(dependency, values);
    }
  }

  let queue = tasks.filter((task) => (inDegree.get(task.id) ?? 0) === 0).map((task) => task.id);
  const topologicalOrder: string[] = [];
  const levels: string[][] = [];

  while (queue.length > 0) {
    const currentLevel = [...queue];
    levels.push(currentLevel);
    queue = [];
    for (const id of currentLevel) {
      topologicalOrder.push(id);
      for (const dependent of dependents.get(id) ?? []) {
        const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, nextDegree);
        if (nextDegree === 0) queue.push(dependent);
      }
    }
  }

  if (topologicalOrder.length !== byId.size) {
    const cyclic = [...byId.keys()].filter((id) => !topologicalOrder.includes(id));
    errors.push(`Ciclo detectado entre: ${cyclic.join(", ")}`);
  }

  return { valid: errors.length === 0, errors, topologicalOrder, levels };
}

export function assertValidDag(tasks: readonly TaskSpec[]): void {
  const validation = validateDag(tasks);
  if (!validation.valid) {
    throw new MaestroError("INVALID_TASK_DAG", validation.errors.join("; "), {
      detail: validation.errors,
    });
  }
}

export function runnableTasks(
  tasks: readonly TaskSpec[],
  states: ReadonlyMap<string, TaskState>,
): TaskSpec[] {
  return tasks.filter((task) => {
    const state = states.get(task.id) ?? "pending";
    return (
      state === "pending" &&
      task.dependencies.every((dependency) => states.get(dependency) === "completed")
    );
  });
}

export function blockedByFailedDependency(
  tasks: readonly TaskSpec[],
  states: ReadonlyMap<string, TaskState>,
): TaskSpec[] {
  return tasks.filter(
    (task) =>
      (states.get(task.id) ?? "pending") === "pending" &&
      task.dependencies.some((dependency) => {
        const state = states.get(dependency);
        return state === "failed" || state === "canceled" || state === "skipped";
      }),
  );
}
