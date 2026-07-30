import type { BudgetSpec, Effort, ModelSelection, PermissionSpec, RunMode } from "./domain.js";
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
  role: "system" | "user" | "assistant";
  content: ProviderInput;
}

export interface ProviderChatRequest {
  selection: ModelSelection;
  messages: ProviderChatMessage[];
  effort?: Effort;
  maxTokens?: number;
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ProviderChatResult {
  content: string;
  model: string;
  providerMessageId: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
  };
}

export type ProviderEventSink = (event: NewRunEvent) => void | Promise<void>;

export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  readonly configSchema: ProviderConfigSchema;
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
  dispose(): Promise<void>;
}
