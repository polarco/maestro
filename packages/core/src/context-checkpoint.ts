import { createHash, randomUUID } from "node:crypto";
import type { ContextCheckpoint, ToolCall, ToolResult } from "@maestro/contracts";

export interface CheckpointUpdate {
  objective?: string;
  decisions?: readonly string[];
  progress?: readonly string[];
  pending?: readonly string[];
  entities?: Readonly<Record<string, string>>;
  files?: ContextCheckpoint["files"];
  toolState?: Readonly<Record<string, unknown>>;
  safeToResume?: boolean;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeFiles(
  previous: ContextCheckpoint["files"],
  next: ContextCheckpoint["files"],
): ContextCheckpoint["files"] {
  const values = new Map(previous.map((file) => [file.path, file]));
  for (const file of next) values.set(file.path, file);
  return [...values.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function createContextCheckpoint(input: {
  conversationId: string;
  runId?: string | null;
  turnId: string;
  previous?: ContextCheckpoint | null;
  update?: CheckpointUpdate;
  id?: string;
  createdAt?: string;
}): ContextCheckpoint {
  const previous = input.previous;
  const update = input.update ?? {};
  return {
    id: input.id ?? randomUUID(),
    conversationId: input.conversationId,
    runId: input.runId ?? previous?.runId ?? null,
    turnId: input.turnId,
    version: (previous?.version ?? 0) + 1,
    objective: update.objective ?? previous?.objective ?? "",
    decisions: unique([...(previous?.decisions ?? []), ...(update.decisions ?? [])]),
    progress: unique([...(previous?.progress ?? []), ...(update.progress ?? [])]),
    pending:
      update.pending !== undefined ? unique(update.pending) : unique(previous?.pending ?? []),
    entities: { ...(previous?.entities ?? {}), ...(update.entities ?? {}) },
    files: mergeFiles(previous?.files ?? [], update.files ?? []),
    toolState: { ...(previous?.toolState ?? {}), ...(update.toolState ?? {}) },
    safeToResume: update.safeToResume ?? previous?.safeToResume ?? true,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function checkpointAfterTool(
  checkpoint: ContextCheckpoint,
  call: ToolCall,
  result: ToolResult,
): ContextCheckpoint {
  const mutating = call.mutability !== "read";
  const effectKnown =
    call.status === "completed" || call.status === "failed" || call.status === "denied";
  return createContextCheckpoint({
    conversationId: checkpoint.conversationId,
    runId: checkpoint.runId,
    turnId: checkpoint.turnId,
    previous: checkpoint,
    update: {
      toolState: {
        [call.id]: {
          name: call.toolName,
          status: call.status,
          isError: result.isError,
          artifactRef: result.artifactRef,
          idempotencyKey: call.idempotencyKey,
        },
      },
      safeToResume: mutating ? effectKnown : checkpoint.safeToResume,
    },
  });
}

export function checkpointDigest(checkpoint: ContextCheckpoint): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        objective: checkpoint.objective,
        decisions: checkpoint.decisions,
        progress: checkpoint.progress,
        pending: checkpoint.pending,
        entities: checkpoint.entities,
        files: checkpoint.files,
        toolState: checkpoint.toolState,
        safeToResume: checkpoint.safeToResume,
      }),
    )
    .digest("hex");
}

export function checkpointHandoff(checkpoint: ContextCheckpoint): string {
  return [
    '<maestro_checkpoint version="1">',
    JSON.stringify({
      objective: checkpoint.objective,
      decisions: checkpoint.decisions,
      progress: checkpoint.progress,
      pending: checkpoint.pending,
      entities: checkpoint.entities,
      files: checkpoint.files,
      toolState: checkpoint.toolState,
      safeToResume: checkpoint.safeToResume,
      digest: checkpointDigest(checkpoint),
    }),
    "</maestro_checkpoint>",
  ].join("\n");
}
