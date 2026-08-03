import type {
  BudgetSpec,
  ContextCheckpoint,
  Effort,
  ModelSelection,
  PermissionSpec,
  RoutingProfile,
  RunMode,
} from "./domain.js";
import type { NewRunEvent } from "./events.js";

export interface ModelCapability {
  chat: boolean;
  coding: boolean;
  tools: boolean;
  vision: boolean;
  reasoningEffort: Effort[];
  structuredOutput: boolean;
  contextWindow: number | null;
}

export interface ProviderModel {
  id: string;
  name: string;
  description?: string;
  capabilities: ModelCapability;
  isDefault?: boolean;
  quality?: Partial<Record<"answer" | "research" | "planning" | "coding" | "review", number>>;
  pricing?: {
    inputUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
    cachedInputUsdPerMillion?: number | null;
  };
  cache?: { supported: boolean; sessionAffinity?: boolean };
}

export interface ProviderAdapterCapabilities {
  nativeLoop: boolean;
  tools: boolean;
  mcp: boolean;
  tokenization: "native" | "estimated" | "none";
  promptCache: boolean;
  pricing: boolean;
  safeRetry: boolean;
  checkpointResume: boolean;
  steering: boolean;
}

export type ProviderKind = "cli" | "api" | "local";

export interface ProviderDescriptor {
  id: string;
  name: string;
  kind: ProviderKind;
  description: string;
  supportsStructuredSessions: boolean;
  supportsPty: boolean;
  homepage?: string;
}

export interface ProviderHealth {
  providerId: string;
  connectionId?: string;
  status: "ready" | "unavailable" | "unauthenticated" | "degraded" | "checking";
  installed: boolean;
  authenticated: boolean | null;
  version: string | null;
  message: string;
  checkedAt: string;
  usage?: {
    label: string;
    used?: number;
    limit?: number;
    unit?: string;
    resetsAt?: string;
  }[];
}

export interface ProviderConfigField {
  key: string;
  label: string;
  description?: string;
  type: "text" | "secret" | "number" | "boolean" | "select";
  required: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: { label: string; value: string }[];
}

export interface ProviderConfigSchema {
  providerId: string;
  fields: ProviderConfigField[];
}

export interface ProviderSummary {
  descriptor: ProviderDescriptor;
  health: ProviderHealth;
  models: ProviderModel[];
  configSchema: ProviderConfigSchema;
  configValues: Record<string, string | number | boolean | null>;
  configured: boolean;
}

/** A CLI authentication profile. Maestro stores only the isolated directory,
 * never OAuth tokens or cookies owned by the provider CLI. */
export interface ProviderConnection {
  id: string;
  providerId: "codex" | "claude-code";
  name: string;
  billingMode: "subscription";
  enabled: boolean;
  isDefault: boolean;
  stateDirectory: string | null;
  priority: number;
  concurrencyLimit: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface ProviderConnectionSummary {
  connection: ProviderConnection;
  health: ProviderHealth;
  models: ProviderModel[];
  activeSessions: number;
}

export interface ProviderSessionSpec {
  runId: string;
  connectionId?: string;
  taskId?: string;
  mode: RunMode;
  cwd: string | null;
  workspaceRoots: string[];
  model: string;
  effort: Effort;
  permissions: PermissionSpec;
  budget: BudgetSpec;
  tools: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
}

export interface ProviderSession {
  id: string;
  providerId: string;
  connectionId?: string;
  nativeSessionId: string | null;
  state: "starting" | "active" | "idle" | "completed" | "failed" | "canceled";
}

export type ProviderInputPart =
  { type: "text"; text: string } | { type: "localImage"; path: string; mimeType?: string };

export type ProviderInput = string | ProviderInputPart[];

export interface ProviderChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ProviderInput;
  name?: string;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderChatRequest {
  selection: ModelSelection;
  messages: ProviderChatMessage[];
  effort?: Effort;
  maxTokens?: number;
  outputSchema?: Record<string, unknown>;
  tools?: ProviderToolDefinition[];
  toolChoice?: "auto" | "none" | { name: string };
  checkpoint?: ContextCheckpoint;
  signal?: AbortSignal;
}

export interface ProviderChatResult {
  content: string;
  model: string;
  providerMessageId: string | null;
  toolCalls?: ProviderToolCall[];
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | "unknown";
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
  };
}

export interface RoutingCandidate {
  selection: ModelSelection;
  capability: ModelCapability;
  eligible: boolean;
  excludedReasons: string[];
  quality: number;
  marginalCostUsd: number | null;
  sessionAffinity: number;
  reliability: number;
  headroom: number;
  latencyMs: number | null;
  cacheAffinity: number;
  circuitState: "closed" | "open" | "half_open";
}

export interface RoutingDecision {
  id: string;
  turnId: string | null;
  role: string;
  profile: RoutingProfile;
  selected: RoutingCandidate;
  candidates: RoutingCandidate[];
  pinned: boolean;
  fallbackAllowed: boolean;
  rationale: string;
  createdAt: string;
}

export interface RecoveryAttempt {
  id: string;
  turnId: string;
  runId: string | null;
  kind: "retry" | "failover" | "repair" | "replan" | "restart_resume" | "model_switch";
  attempt: number;
  from: ModelSelection | null;
  to: ModelSelection | null;
  checkpointId: string | null;
  reason: string;
  outcome: "pending" | "succeeded" | "failed" | "skipped_unknown_effect";
  createdAt: string;
  finishedAt: string | null;
}

export interface ModelTelemetry {
  providerId: string;
  connectionId: string | null;
  modelId: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  latencyEwmaMs: number | null;
  successRate: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  activeSessions: number;
  concurrencyLimit: number | null;
  cooldownUntil: string | null;
  circuitState: "closed" | "open" | "half_open";
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  updatedAt: string;
}

export type ProviderEventSink = (event: NewRunEvent) => void | Promise<void>;

export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  readonly configSchema: ProviderConfigSchema;
  readonly capabilities?: ProviderAdapterCapabilities;
  detect(signal?: AbortSignal): Promise<ProviderHealth>;
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
  createSession(spec: ProviderSessionSpec, onEvent: ProviderEventSink): Promise<ProviderSession>;
  resumeSession(spec: ProviderSessionSpec, onEvent: ProviderEventSink): Promise<ProviderSession>;
  send(sessionId: string, input: ProviderInput): Promise<ProviderSession>;
  steer(sessionId: string, input: ProviderInput): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  chat?(
    request: ProviderChatRequest,
    onDelta?: (delta: string) => void,
  ): Promise<ProviderChatResult>;
  countTokens?(messages: ProviderChatMessage[]): Promise<number>;
  resumeFromCheckpoint?(
    spec: ProviderSessionSpec,
    checkpoint: ContextCheckpoint,
    onEvent: ProviderEventSink,
  ): Promise<ProviderSession>;
  dispose(): Promise<void>;
}
