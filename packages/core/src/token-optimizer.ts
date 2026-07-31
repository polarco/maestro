import type { MessageRole, TokenOptimizationMode } from "@maestro/contracts";

/**
 * Context compaction adapted from OmniRoute's layered context manager and
 * context handoff (MIT, diegosouzapw, reviewed at commit ed2551e). Maestro
 * keeps the persisted transcript immutable and only transforms provider input.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const MAX_RESERVE_TOKENS = 16_000;

// Small offline snapshot of context limits used by OmniRoute's MODEL_SPECS.
// Provider-reported values always win; these entries only improve unknown APIs.
const KNOWN_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "gpt-5.5": 1_050_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "gemini-3-flash": 1_048_576,
  "gemini-3-1-pro": 1_048_576,
  "gemini-3-5-flash": 1_048_576,
  "kimi-k2-5": 262_144,
  "kimi-k2-6": 262_144,
  "qwen3-max": 1_000_000,
  "qwen3-6-plus": 1_000_000,
  "qwen3-5-plus": 1_000_000,
};

export interface ContextHistoryMessage {
  id: string;
  role: MessageRole | "developer";
  content: string;
  hasContext?: boolean;
  contextLabels?: readonly string[];
  estimatedContextTokens?: number;
}

export interface ModelTransitionEndpoint {
  providerId: string;
  modelId: string;
}

export interface ModelTransition {
  from: ModelTransitionEndpoint;
  to: ModelTransitionEndpoint;
  reason?: "model-switch" | "account-switch";
}

export interface OptimizedContextMessage extends ContextHistoryMessage {
  includeContext: boolean;
  compacted: boolean;
}

export interface ContextOptimizationStats {
  originalTokens: number;
  optimizedTokens: number;
  targetTokens: number;
  savedTokens: number;
  savingsPercent: number;
  messagesBefore: number;
  messagesAfter: number;
  droppedMessages: number;
  compactedMessages: number;
  omittedContextItems: number;
  techniques: string[];
}

export interface ContextOptimizationResult {
  messages: OptimizedContextMessage[];
  handoff: string | null;
  stats: ContextOptimizationStats;
}

export interface ContextOptimizationOptions {
  mode: TokenOptimizationMode;
  contextWindow: number | null;
  providerId?: string;
  modelId?: string;
  currentInputTokens?: number;
  transition?: ModelTransition;
}

export interface ContextHandoffOptions {
  transition?: ModelTransition;
  reason?: "model-switch" | "token-budget";
  maxTokens?: number;
  omittedContextLabels?: readonly string[];
}

export function estimateTokens(value: string | object | null | undefined): number {
  if (!value) return 0;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(serialized.length / CHARS_PER_TOKEN);
}

/** OmniRoute-compatible fallbacks, used only when a provider exposes no limit. */
export function resolveModelContextWindow(
  providerId: string,
  modelId: string,
  explicit: number | null | undefined,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0)
    return Math.floor(explicit);
  const provider = providerId.toLowerCase();
  const model = modelId.toLowerCase();
  const normalizedModel = model
    .split("/")
    .at(-1)!
    .replaceAll(".", "-")
    .replace(/-\d{8}$/, "");
  const known = KNOWN_MODEL_CONTEXT_WINDOWS[normalizedModel];
  if (known) return known;
  if (provider.includes("gemini") || model.includes("gemini")) return 1_000_000;
  if (provider.includes("claude") || provider.includes("anthropic") || model.includes("claude"))
    return 200_000;
  if (
    provider === "codex" ||
    model.includes("codex") ||
    model.includes("gpt") ||
    /(^|[-_/])o[134]($|[-_/])/.test(model)
  )
    return 400_000;
  return DEFAULT_CONTEXT_WINDOW;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateToTokens(value: string, maxTokens: number): string {
  const maxChars = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (value.length <= maxChars) return value;
  if (maxChars <= 32) return value.slice(0, maxChars);
  const marker = "\n… [trecho compactado] …\n";
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.62);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - (available - head))}`;
}

function contextTokens(message: ContextHistoryMessage): number {
  return Math.max(0, Math.floor(message.estimatedContextTokens ?? 0));
}

function messageTokens(message: ContextHistoryMessage, includeContext = true): number {
  return 6 + estimateTokens(message.content) + (includeContext ? contextTokens(message) : 0);
}

function totalTokens(messages: readonly OptimizedContextMessage[], handoff: string | null): number {
  return (
    messages.reduce((total, message) => total + messageTokens(message, message.includeContext), 0) +
    estimateTokens(handoff)
  );
}

function cloneMessage(
  message: ContextHistoryMessage,
  values: { content?: string; includeContext?: boolean; compacted?: boolean } = {},
): OptimizedContextMessage {
  return {
    ...message,
    content: values.content ?? message.content,
    includeContext: values.includeContext ?? true,
    compacted: values.compacted ?? false,
  };
}

function fitMessage(
  message: ContextHistoryMessage,
  allocation: number,
): OptimizedContextMessage | null {
  if (allocation < 12) return null;
  if (messageTokens(message, true) <= allocation) return cloneMessage(message);
  const withoutContext = messageTokens(message, false);
  if (withoutContext <= allocation)
    return cloneMessage(message, {
      includeContext: contextTokens(message) === 0,
      compacted: contextTokens(message) > 0,
    });
  const textBudget = allocation - 6;
  if (textBudget < 8) return null;
  return cloneMessage(message, {
    content: truncateToTokens(message.content, textBudget),
    includeContext: false,
    compacted: true,
  });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function concise(value: string, maxTokens: number): string {
  return truncateToTokens(normalizeWhitespace(value).replace(/\s+/g, " "), maxTokens);
}

function activeEntities(messages: readonly ContextHistoryMessage[]): string[] {
  const values = new Set<string>();
  const patterns = [
    /`([^`\n]{2,100})`/g,
    /(?:^|\s)((?:[A-Za-z]:)?[./][\w@+.,()\- /\\]{2,120})/g,
    /\b[\w-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|json|ya?ml|md|sql|html|css|toml)\b/g,
  ];
  for (const message of messages) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of message.content.matchAll(pattern)) {
        const candidate = (match[1] ?? match[0]).trim();
        if (candidate) values.add(candidate.slice(0, 120));
        if (values.size >= 10) return [...values];
      }
    }
  }
  return [...values];
}

function handoffXml(payload: Record<string, unknown>, reason: string): string {
  return [
    `<context_handoff version="1" reason="${xmlEscape(reason)}">`,
    xmlEscape(JSON.stringify(payload)),
    "</context_handoff>",
  ].join("\n");
}

export function buildContextHandoff(
  messages: readonly ContextHistoryMessage[],
  options: ContextHandoffOptions = {},
): string | null {
  const meaningful = messages.filter((message) => message.content.trim() || message.hasContext);
  const omittedLabels = [...new Set(options.omittedContextLabels ?? [])].slice(0, 20);
  if (meaningful.length === 0 && !options.transition && omittedLabels.length === 0) return null;

  const firstUser = meaningful.find((message) => message.role === "user");
  const latestUser = [...meaningful].reverse().find((message) => message.role === "user");
  const latestAssistant = [...meaningful].reverse().find((message) => message.role === "assistant");
  const directives = meaningful
    .filter((message) => message.role === "user" && message.content.trim())
    .slice(-6)
    .map((message) => concise(message.content, 60));
  const labels = [
    ...new Set([...meaningful.flatMap((message) => message.contextLabels ?? []), ...omittedLabels]),
  ].slice(0, 20);
  const transition = options.transition
    ? {
        previousModel: `${options.transition.from.providerId}/${options.transition.from.modelId}`,
        currentModel: `${options.transition.to.providerId}/${options.transition.to.modelId}`,
        transferReason: options.transition.reason ?? "model-switch",
      }
    : null;
  const summaryParts = [
    `${meaningful.length} mensagem${meaningful.length === 1 ? "" : "s"} anterior${meaningful.length === 1 ? "" : "es"} representada${meaningful.length === 1 ? "" : "s"} neste handoff.`,
    firstUser?.content ? `Pedido inicial: ${concise(firstUser.content, 90)}` : "",
    latestUser && latestUser.id !== firstUser?.id
      ? `Direção mais recente: ${concise(latestUser.content, 90)}`
      : "",
  ].filter(Boolean);
  const payload: {
    transition: typeof transition;
    summary: string;
    userDirectives: string[];
    taskProgress: string;
    activeEntities: string[];
    historicalContextItems: string[];
  } = {
    transition,
    summary: summaryParts.join(" "),
    userDirectives: directives,
    taskProgress: latestAssistant?.content ? concise(latestAssistant.content, 140) : "",
    activeEntities: activeEntities(meaningful),
    historicalContextItems: labels,
  };
  const reason = options.reason ?? (options.transition ? "model-switch" : "token-budget");
  const maxTokens = Math.max(120, options.maxTokens ?? 900);
  let xml = handoffXml(payload, reason);
  while (estimateTokens(xml) > maxTokens) {
    if (payload.userDirectives.length > 2) payload.userDirectives.shift();
    else if (payload.activeEntities.length > 4) payload.activeEntities.pop();
    else if (payload.historicalContextItems.length > 4) payload.historicalContextItems.pop();
    else if (estimateTokens(payload.taskProgress) > 50)
      payload.taskProgress = truncateToTokens(payload.taskProgress, 50);
    else if (estimateTokens(payload.summary) > 90)
      payload.summary = truncateToTokens(payload.summary, 90);
    else break;
    xml = handoffXml(payload, reason);
  }
  return xml;
}

function stats(
  original: readonly ContextHistoryMessage[],
  optimized: readonly OptimizedContextMessage[],
  handoff: string | null,
  targetTokens: number,
  techniques: string[],
): ContextOptimizationStats {
  const originalTokens = original.reduce((total, message) => total + messageTokens(message), 0);
  const optimizedTokens = totalTokens(optimized, handoff);
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  return {
    originalTokens,
    optimizedTokens,
    targetTokens,
    savedTokens,
    savingsPercent:
      originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 1_000) / 10 : 0,
    messagesBefore: original.length,
    messagesAfter: optimized.length,
    droppedMessages: Math.max(0, original.length - optimized.length),
    compactedMessages: optimized.filter((message) => message.compacted).length,
    omittedContextItems: optimized
      .filter((message) => !message.includeContext)
      .reduce((total, message) => total + (message.contextLabels?.length ?? 0), 0),
    techniques,
  };
}

export function optimizeConversationContext(
  input: readonly ContextHistoryMessage[],
  options: ContextOptimizationOptions,
): ContextOptimizationResult {
  const contextWindow = resolveModelContextWindow(
    options.providerId ?? options.transition?.to.providerId ?? "default",
    options.modelId ?? options.transition?.to.modelId ?? "default",
    options.contextWindow,
  );
  const reserveTokens = Math.min(
    MAX_RESERVE_TOKENS,
    Math.max(256, Math.floor(contextWindow * 0.15)),
  );
  const targetTokens = Math.max(
    512,
    contextWindow - reserveTokens - Math.max(0, Math.floor(options.currentInputTokens ?? 0)),
  );
  const original = input.map((message) => ({ ...message }));

  if (options.mode === "off") {
    const messages = original.map((message) => cloneMessage(message));
    const handoff = options.transition
      ? buildContextHandoff(original, {
          transition: options.transition,
          reason: "model-switch",
          maxTokens: 220,
        })
      : null;
    return { messages, handoff, stats: stats(original, messages, handoff, targetTokens, []) };
  }

  const techniques: string[] = [];
  let whitespaceChanged = false;
  const normalized = original.map((message) => {
    const preserveVerbatim = message.role === "system" || message.role === "developer";
    const content = preserveVerbatim ? message.content : normalizeWhitespace(message.content);
    if (content !== message.content) whitespaceChanged = true;
    return { ...message, content };
  });
  if (whitespaceChanged) techniques.push("whitespace");

  const deduplicated: ContextHistoryMessage[] = [];
  for (const message of normalized) {
    const previous = deduplicated.at(-1);
    const canDeduplicate =
      previous &&
      previous.role === message.role &&
      previous.content === message.content &&
      message.role !== "system" &&
      message.role !== "developer" &&
      !previous.hasContext &&
      !message.hasContext &&
      contextTokens(previous) === 0 &&
      contextTokens(message) === 0;
    if (!canDeduplicate) deduplicated.push(message);
  }
  if (deduplicated.length !== normalized.length) techniques.push("duplicate-removal");

  const normalizedTokens = deduplicated.reduce(
    (total, message) => total + messageTokens(message),
    0,
  );
  const triggerRatio = options.mode === "aggressive" ? 0.7 : 0.85;
  if (normalizedTokens <= Math.floor(targetTokens * triggerRatio)) {
    const messages = deduplicated.map((message) => cloneMessage(message));
    const handoff = options.transition
      ? buildContextHandoff(deduplicated, {
          transition: options.transition,
          reason: "model-switch",
          maxTokens: 220,
        })
      : null;
    if (handoff) techniques.push("model-handoff");
    return {
      messages,
      handoff,
      stats: stats(original, messages, handoff, targetTokens, techniques),
    };
  }

  techniques.push("progressive-history");
  const handoffBudget = Math.min(
    options.mode === "aggressive" ? 600 : 1_000,
    Math.max(160, Math.floor(targetTokens * 0.12)),
  );
  const messageBudget = Math.max(256, targetTokens - handoffBudget);
  const system = deduplicated.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
  const nonSystem = deduplicated.filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );
  const recentCount = options.mode === "aggressive" ? 4 : 8;
  const recent = nonSystem.slice(-recentCount);
  const older = nonSystem.slice(0, Math.max(0, nonSystem.length - recent.length));
  const selected = new Map<string, OptimizedContextMessage>();
  let remaining = messageBudget;

  for (let index = 0; index < system.length; index += 1) {
    const message = system[index]!;
    const allocation = Math.max(32, Math.floor(remaining / Math.max(1, system.length - index)));
    const fitted = fitMessage(message, allocation);
    if (!fitted) continue;
    selected.set(message.id, fitted);
    remaining -= messageTokens(fitted, fitted.includeContext);
  }

  for (let index = 0; index < recent.length; index += 1) {
    const message = recent[index]!;
    const countLeft = recent.length - index;
    const allocation = Math.max(24, Math.floor(remaining / Math.max(1, countLeft)));
    const fitted = fitMessage(message, allocation);
    if (!fitted) continue;
    selected.set(message.id, fitted);
    remaining -= messageTokens(fitted, fitted.includeContext);
  }

  for (let index = older.length - 1; index >= 0 && remaining >= 24; index -= 1) {
    const message = older[index]!;
    let fitted = messageTokens(message, true) <= remaining ? cloneMessage(message) : null;
    if (!fitted && contextTokens(message) > 0 && messageTokens(message, false) <= remaining)
      fitted = cloneMessage(message, { includeContext: false, compacted: true });
    if (!fitted) continue;
    selected.set(message.id, fitted);
    remaining -= messageTokens(fitted, fitted.includeContext);
  }

  const messages = deduplicated
    .map((message) => selected.get(message.id))
    .filter((message): message is OptimizedContextMessage => Boolean(message));
  const dropped = deduplicated.filter((message) => !selected.has(message.id));
  const omittedLabels = messages
    .filter((message) => !message.includeContext)
    .flatMap((message) => message.contextLabels ?? []);
  const handoffSource = dropped.length > 0 ? dropped : deduplicated;
  const handoff = buildContextHandoff(handoffSource, {
    ...(options.transition ? { transition: options.transition } : {}),
    reason: options.transition ? "model-switch" : "token-budget",
    maxTokens: handoffBudget,
    omittedContextLabels: omittedLabels,
  });
  if (handoff) techniques.push(options.transition ? "model-handoff" : "extractive-handoff");
  if (messages.some((message) => message.compacted)) techniques.push("message-compaction");
  if (dropped.length > 0) techniques.push("history-pruning");

  return { messages, handoff, stats: stats(original, messages, handoff, targetTokens, techniques) };
}
