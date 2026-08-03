import type { MessageRole, TokenOptimizationMode } from "@maestro/contracts";

/**
 * Context compaction adapted from OmniRoute's layered context manager and
 * context handoff (MIT, diegosouzapw, reviewed at commit 84b1e5e). Maestro
 * keeps the persisted transcript immutable and only transforms provider input.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const MAX_RESERVE_TOKENS = 16_000;

export interface ContextHistoryMessage {
  id: string;
  role: MessageRole | "developer";
  content: string;
  hasContext?: boolean;
  contextLabels?: readonly string[];
  estimatedContextTokens?: number;
  /** Provider-reported token count for this item, when available. */
  tokenCount?: number;
  contentKind?: "text" | "image" | "tool-call" | "tool-result";
  toolCallId?: string;
  toolResultFor?: string;
  artifactRef?: string;
  /** Decisions, code, diffs, JSON and other content that must remain verbatim. */
  protected?: boolean;
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
  stage: "lite" | "progressive" | "handoff" | "emergency";
  fidelityPassed: boolean;
  providerTokenCountUsed: boolean;
}

export interface ContextOptimizationResult {
  messages: OptimizedContextMessage[];
  handoff: string | null;
  stats: ContextOptimizationStats;
  fidelity: ContextFidelityResult;
}

export interface ContextFidelityResult {
  passed: boolean;
  missingMessageIds: string[];
  orphanedToolCallIds: string[];
  reasons: string[];
}

export interface ContextOptimizationOptions {
  mode: TokenOptimizationMode;
  contextWindow: number | null;
  providerId?: string;
  modelId?: string;
  currentInputTokens?: number;
  /** Exact provider count for the history, preferred over local estimation. */
  providerInputTokens?: number;
  recentTokenBudget?: number;
  storeToolResult?: (message: ContextHistoryMessage) => string;
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

/** Conservative fallback used only when a provider exposes no context limit. */
export function resolveModelContextWindow(
  providerId: string,
  modelId: string,
  explicit: number | null | undefined,
): number {
  void providerId;
  void modelId;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0)
    return Math.floor(explicit);
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
  return (
    6 +
    Math.max(0, Math.floor(message.tokenCount ?? estimateTokens(message.content))) +
    (includeContext ? contextTokens(message) : 0)
  );
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

function recentTurnIds(messages: readonly ContextHistoryMessage[]): Set<string> {
  const userIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  const start = userIndexes.at(-2) ?? Math.max(0, messages.length - 2);
  return new Set(messages.slice(start).map((message) => message.id));
}

function isProtectedPayload(message: ContextHistoryMessage): boolean {
  if (message.protected || message.role === "system" || message.role === "developer") return true;
  return /(?:```|^diff --git|\b(?:error|erro|failed|falhou|approved|aprovad[oa]|não altere|do not)\b|(?:^|\s)(?:[./][\w.-]+\/|[\w.-]+\.(?:ts|tsx|js|jsx|py|json|sql|md))|\{\s*"[^"\n]+"\s*:|\b\d+(?:\.\d+){1,3}\b)/im.test(
    message.content,
  );
}

function toolPairIds(messages: readonly ContextHistoryMessage[]): Map<string, string[]> {
  const pairs = new Map<string, string[]>();
  for (const message of messages) {
    const id = message.toolCallId ?? message.toolResultFor;
    if (!id) continue;
    pairs.set(id, [...(pairs.get(id) ?? []), message.id]);
  }
  return pairs;
}

export function validateContextFidelity(
  source: readonly ContextHistoryMessage[],
  optimized: readonly OptimizedContextMessage[],
  _handoff: string | null = null,
): ContextFidelityResult {
  const byId = new Map(optimized.map((message) => [message.id, message]));
  const required = recentTurnIds(source);
  for (const message of source) if (isProtectedPayload(message)) required.add(message.id);
  const missingMessageIds = [...required].filter((id) => {
    const original = source.find((message) => message.id === id);
    const current = byId.get(id);
    if (!original || !current) return true;
    if (original.contentKind === "tool-result" && current.artifactRef) return false;
    return current.content !== original.content || !current.includeContext;
  });
  const orphanedToolCallIds: string[] = [];
  for (const [toolCallId, ids] of toolPairIds(source)) {
    if (ids.length < 2) continue;
    const present = ids.filter((id) => byId.has(id)).length;
    if (present > 0 && present < ids.length) orphanedToolCallIds.push(toolCallId);
  }
  const reasons = [
    ...(missingMessageIds.length > 0 ? ["protected-or-recent-content-missing"] : []),
    ...(orphanedToolCallIds.length > 0 ? ["orphaned-tool-pair"] : []),
  ];
  return {
    passed: reasons.length === 0,
    missingMessageIds,
    orphanedToolCallIds,
    reasons,
  };
}

function validateContextBudget(
  fidelity: ContextFidelityResult,
  optimized: readonly OptimizedContextMessage[],
  handoff: string | null,
  targetTokens: number,
): ContextFidelityResult {
  if (totalTokens(optimized, handoff) <= targetTokens) return fidelity;
  return {
    ...fidelity,
    passed: false,
    reasons: [...new Set([...fidelity.reasons, "context-budget-exceeded"])],
  };
}

function stats(
  original: readonly ContextHistoryMessage[],
  optimized: readonly OptimizedContextMessage[],
  handoff: string | null,
  targetTokens: number,
  techniques: string[],
  stage: ContextOptimizationStats["stage"],
  fidelity: ContextFidelityResult,
  providerInputTokens?: number,
): ContextOptimizationStats {
  const originalTokens =
    providerInputTokens ?? original.reduce((total, message) => total + messageTokens(message), 0);
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
    stage,
    fidelityPassed: fidelity.passed,
    providerTokenCountUsed: providerInputTokens !== undefined,
  };
}

function externalizeLargeToolResults(
  messages: readonly ContextHistoryMessage[],
  thresholdTokens: number,
  recentIds: ReadonlySet<string>,
  store?: (message: ContextHistoryMessage) => string,
): { messages: ContextHistoryMessage[]; changed: boolean } {
  let changed = false;
  const output = messages.map((message) => {
    if (
      message.contentKind !== "tool-result" ||
      recentIds.has(message.id) ||
      messageTokens(message) <= thresholdTokens
    )
      return message;
    changed = true;
    const artifactRef =
      store?.(message) ??
      `tool-result://sha256/${Array.from(message.content)
        .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 2166136261)
        .toString(16)}`;
    const errors = message.content
      .split("\n")
      .filter((line) => /(?:error|erro|failed|exception|exit code|status)/i.test(line))
      .slice(0, 20)
      .join("\n");
    const head = message.content.slice(0, 2_400);
    const tail = message.content.slice(-1_600);
    const messageWithoutTokenCount = { ...message };
    delete messageWithoutTokenCount.tokenCount;
    return {
      ...messageWithoutTokenCount,
      content: [
        `[tool-result-reference call=${message.toolResultFor ?? "unknown"} ref=${artifactRef}]`,
        head,
        errors ? `\n[errors]\n${errors}` : "",
        tail && tail !== head ? `\n[tail]\n${tail}` : "",
      ].join("\n"),
      artifactRef,
    };
  });
  return { messages: output, changed };
}

function closeToolPairs(
  source: readonly ContextHistoryMessage[],
  selected: Map<string, OptimizedContextMessage>,
  required: ReadonlySet<string>,
  remaining: number,
): number {
  for (const ids of toolPairIds(source).values()) {
    if (ids.length < 2) continue;
    const present = ids.filter((id) => selected.has(id));
    if (present.length === 0 || present.length === ids.length) continue;
    const missing = ids
      .filter((id) => !selected.has(id))
      .map((id) => source.find((message) => message.id === id))
      .filter((message): message is ContextHistoryMessage => Boolean(message));
    const needed = missing.reduce((total, message) => total + messageTokens(message), 0);
    if (needed <= remaining || ids.some((id) => required.has(id))) {
      for (const message of missing) selected.set(message.id, cloneMessage(message));
      remaining -= needed;
    } else {
      for (const id of ids) selected.delete(id);
    }
  }
  return remaining;
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
    0,
    contextWindow - reserveTokens - Math.max(0, Math.floor(options.currentInputTokens ?? 0)),
  );
  const original = input.map((message) => ({ ...message }));
  const providerTokens =
    typeof options.providerInputTokens === "number" && options.providerInputTokens >= 0
      ? Math.floor(options.providerInputTokens)
      : undefined;

  if (options.mode === "off") {
    const messages = original.map((message) => cloneMessage(message));
    const handoff = options.transition
      ? buildContextHandoff(original, {
          transition: options.transition,
          reason: "model-switch",
          maxTokens: 220,
        })
      : null;
    const fidelity = validateContextBudget(
      validateContextFidelity(original, messages, handoff),
      messages,
      handoff,
      targetTokens,
    );
    return {
      messages,
      handoff,
      fidelity,
      stats: stats(original, messages, handoff, targetTokens, [], "lite", fidelity, providerTokens),
    };
  }

  const techniques: string[] = [];
  let whitespaceChanged = false;
  const normalized = original.map((message) => {
    const preserveVerbatim = isProtectedPayload(message);
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
      !previous.toolCallId &&
      !previous.toolResultFor &&
      !message.toolCallId &&
      !message.toolResultFor &&
      !previous.hasContext &&
      !message.hasContext &&
      contextTokens(previous) === 0 &&
      contextTokens(message) === 0;
    if (!canDeduplicate) deduplicated.push(message);
  }
  if (deduplicated.length !== normalized.length) techniques.push("duplicate-removal");

  const localNormalizedTokens = deduplicated.reduce(
    (total, message) => total + messageTokens(message),
    0,
  );
  const normalizedTokens = providerTokens ?? localNormalizedTokens;
  const loadRatio =
    (normalizedTokens + Math.max(0, Math.floor(options.currentInputTokens ?? 0))) / contextWindow;
  const stage: ContextOptimizationStats["stage"] =
    loadRatio >= 0.95
      ? "emergency"
      : loadRatio >= 0.85
        ? "handoff"
        : loadRatio >= 0.7
          ? "progressive"
          : "lite";
  if (stage === "lite" && localNormalizedTokens <= targetTokens) {
    const messages = deduplicated.map((message) => cloneMessage(message));
    const handoff = options.transition
      ? buildContextHandoff(deduplicated, {
          transition: options.transition,
          reason: "model-switch",
          maxTokens: 220,
        })
      : null;
    if (handoff) techniques.push("model-handoff");
    const fidelity = validateContextBudget(
      validateContextFidelity(deduplicated, messages, handoff),
      messages,
      handoff,
      targetTokens,
    );
    return {
      messages,
      handoff,
      fidelity,
      stats: stats(
        original,
        messages,
        handoff,
        targetTokens,
        techniques,
        stage,
        fidelity,
        providerTokens,
      ),
    };
  }

  techniques.push("progressive-history");
  if (stage === "handoff") techniques.push("handoff-threshold");
  if (stage === "emergency") techniques.push("emergency-compaction");
  const handoffBudget = Math.min(
    options.mode === "aggressive" ? 600 : 1_000,
    Math.max(160, Math.floor(targetTokens * 0.12)),
  );
  const messageBudget = Math.max(256, targetTokens - handoffBudget);
  const initialRecentIds = recentTurnIds(deduplicated);
  const externalized = externalizeLargeToolResults(
    deduplicated,
    Math.max(512, Math.floor(targetTokens * 0.12)),
    initialRecentIds,
    options.storeToolResult,
  );
  if (externalized.changed) techniques.push("tool-result-reference");
  const working = externalized.messages;
  const system = working.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
  const nonSystem = working.filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );
  const recentBudget = Math.max(
    2_000,
    Math.min(8_000, Math.floor(options.recentTokenBudget ?? targetTokens * 0.4)),
  );
  let recentStart = nonSystem.length;
  let recentTokens = 0;
  let recentUsers = 0;
  while (recentStart > 0 && (recentTokens < recentBudget || recentUsers < 2)) {
    recentStart -= 1;
    const message = nonSystem[recentStart]!;
    recentTokens += messageTokens(message);
    if (message.role === "user") recentUsers += 1;
  }
  const recent = nonSystem.slice(recentStart);
  const older = nonSystem.slice(0, Math.max(0, nonSystem.length - recent.length));
  const required = new Set<string>(recent.map((message) => message.id));
  for (const message of working) if (isProtectedPayload(message)) required.add(message.id);
  const selected = new Map<string, OptimizedContextMessage>();
  let remaining = messageBudget;

  for (const message of system) {
    const exact = cloneMessage(message);
    selected.set(message.id, exact);
    remaining -= messageTokens(exact, exact.includeContext);
  }

  for (const message of recent) {
    const exact = cloneMessage(message);
    selected.set(message.id, exact);
    remaining -= messageTokens(exact, exact.includeContext);
  }

  for (const message of older.filter(isProtectedPayload)) {
    if (selected.has(message.id)) continue;
    const exact = cloneMessage(message);
    selected.set(message.id, exact);
    remaining -= messageTokens(exact, exact.includeContext);
  }

  for (let index = older.length - 1; index >= 0 && remaining >= 24; index -= 1) {
    const message = older[index]!;
    if (selected.has(message.id) || message.contentKind === "image") continue;
    let fitted = messageTokens(message, true) <= remaining ? cloneMessage(message) : null;
    if (!fitted && contextTokens(message) > 0 && messageTokens(message, false) <= remaining)
      fitted = cloneMessage(message, { includeContext: false, compacted: true });
    if (!fitted) continue;
    selected.set(message.id, fitted);
    remaining -= messageTokens(fitted, fitted.includeContext);
  }

  if (older.some((message) => message.contentKind === "image" && !selected.has(message.id)))
    techniques.push("image-pruning");
  remaining = closeToolPairs(working, selected, required, remaining);

  let messages = working
    .map((message) => selected.get(message.id))
    .filter((message): message is OptimizedContextMessage => Boolean(message));
  const dropped = working.filter((message) => !selected.has(message.id));
  const omittedLabels = messages
    .filter((message) => !message.includeContext)
    .flatMap((message) => message.contextLabels ?? []);
  const handoffSource = dropped.length > 0 ? dropped : working;
  const handoff = buildContextHandoff(handoffSource, {
    ...(options.transition ? { transition: options.transition } : {}),
    reason: options.transition ? "model-switch" : "token-budget",
    maxTokens: handoffBudget,
    omittedContextLabels: omittedLabels,
  });
  if (handoff) techniques.push(options.transition ? "model-handoff" : "extractive-handoff");
  if (messages.some((message) => message.compacted)) techniques.push("message-compaction");
  if (dropped.length > 0) techniques.push("history-pruning");
  let fidelity = validateContextBudget(
    validateContextFidelity(working, messages, handoff),
    messages,
    handoff,
    targetTokens,
  );
  if (!fidelity.passed) {
    // A compressed candidate that loses protected values or tool structure is
    // discarded. Rebuild from exact required messages and complete pairs.
    techniques.push("fidelity-fallback");
    const fallback = new Map<string, OptimizedContextMessage>();
    for (const message of working)
      if (required.has(message.id)) fallback.set(message.id, cloneMessage(message));
    closeToolPairs(working, fallback, required, Number.POSITIVE_INFINITY);
    messages = working
      .map((message) => fallback.get(message.id))
      .filter((message): message is OptimizedContextMessage => Boolean(message));
    fidelity = validateContextBudget(
      validateContextFidelity(working, messages, handoff),
      messages,
      handoff,
      targetTokens,
    );
  }

  return {
    messages,
    handoff,
    fidelity,
    stats: stats(
      original,
      messages,
      handoff,
      targetTokens,
      techniques,
      stage,
      fidelity,
      providerTokens,
    ),
  };
}
