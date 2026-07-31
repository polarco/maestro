import type {
  AnalysisResult,
  MaestroBrief,
  MaestroDiscovery,
  MaestroQuestion,
  MaestroResearchFinding,
  ModelSelection,
  PlanSpec,
  RunState,
  TaskState,
} from "./domain.js";

export type RunEventType =
  | "run.created"
  | "run.state"
  | "discovery.started"
  | "workspace.inspected"
  | "discovery.completed"
  | "clarification.requested"
  | "clarification.answered"
  | "research.started"
  | "research.finding"
  | "brief.created"
  | "analysis.completed"
  | "route.selected"
  | "plan.created"
  | "plan.approved"
  | "plan.revision_requested"
  | "agents.dispatched"
  | "execution.summary"
  | "message.delta"
  | "message.completed"
  | "agent.started"
  | "agent.stopped"
  | "task.state"
  | "command.started"
  | "command.output"
  | "command.completed"
  | "tool.started"
  | "tool.completed"
  | "file.diff"
  | "approval.required"
  | "approval.resolved"
  | "metric"
  | "log"
  | "error";

export interface EventDataMap {
  "run.created": { mode: string; promptPreview: string };
  "run.state": { from: RunState | null; to: RunState; reason?: string };
  "discovery.started": { round: number; message: string };
  "workspace.inspected": {
    files: number;
    directories: number;
    sources: string[];
    observations: string[];
    truncated: boolean;
  };
  "discovery.completed": { round: number; discovery: MaestroDiscovery };
  "clarification.requested": { round: number; questions: MaestroQuestion[] };
  "clarification.answered": { round: number; answer: string; contextAssetIds: string[] };
  "research.started": { topics: string[]; scope: "workspace-and-context" };
  "research.finding": { finding: MaestroResearchFinding };
  "brief.created": { brief: MaestroBrief };
  "analysis.completed": { analysis: AnalysisResult };
  "route.selected": { role: string; selection: ModelSelection; rationale: string };
  "plan.created": { plan: PlanSpec; markdown: string };
  "plan.approved": { version: number; approvedBy: "user" };
  "plan.revision_requested": { version: number; comment: string };
  "agents.dispatched": {
    planVersion: number;
    agents: Array<{
      taskId: string;
      title: string;
      role: string;
      providerId: string;
      modelId: string;
    }>;
  };
  "execution.summary": {
    outcome: "completed" | "failed" | "canceled";
    summary: string;
    completedTasks: number;
    totalTasks: number;
    changedFiles: string[];
  };
  "message.delta": { messageId: string; taskId?: string; role: "assistant"; delta: string };
  "message.completed": {
    messageId: string;
    taskId?: string;
    role: "assistant";
    content: string;
  };
  "agent.started": {
    agentId: string;
    taskId?: string;
    providerId: string;
    modelId: string;
    label: string;
  };
  "agent.stopped": {
    agentId: string;
    taskId?: string;
    outcome: "completed" | "failed" | "canceled";
  };
  "task.state": { taskId: string; from: TaskState | null; to: TaskState; detail?: string };
  "command.started": {
    taskId?: string;
    commandId: string;
    executable: string;
    args: string[];
    cwd: string;
  };
  "command.output": {
    taskId?: string;
    commandId: string;
    stream: "stdout" | "stderr";
    chunk: string;
  };
  "command.completed": {
    taskId?: string;
    commandId: string;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
  };
  "tool.started": { taskId?: string; toolCallId: string; name: string; input: unknown };
  "tool.completed": {
    taskId?: string;
    toolCallId: string;
    name: string;
    output: unknown;
    isError: boolean;
  };
  "file.diff": {
    taskId?: string;
    path: string;
    patch: string;
    additions?: number;
    deletions?: number;
  };
  "approval.required": {
    approvalId: string;
    kind: "command" | "file" | "tool";
    summary: string;
    detail: unknown;
  };
  "approval.resolved": {
    approvalId: string;
    decision: "approved" | "denied";
    source: "policy" | "user";
  };
  metric: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
    durationMs?: number;
  };
  log: { level: "debug" | "info" | "warn"; message: string; context?: Record<string, unknown> };
  error: { code: string; message: string; recoverable: boolean; detail?: unknown };
}

export type RunEvent<K extends RunEventType = RunEventType> = K extends RunEventType
  ? {
      id: string;
      runId: string;
      sequence: number;
      type: K;
      data: EventDataMap[K];
      occurredAt: string;
    }
  : never;

export type NewRunEvent<K extends RunEventType = RunEventType> = K extends RunEventType
  ? {
      runId: string;
      type: K;
      data: EventDataMap[K];
      occurredAt?: string;
    }
  : never;

export interface EventPage {
  events: RunEvent[];
  nextSequence: number | null;
}
