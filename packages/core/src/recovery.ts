import type { ModelSelection, ModelTelemetry } from "@maestro/contracts";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (input: { attempt: number; delayMs: number; error: unknown }) => void | Promise<void>;
}

export function isTransientProviderError(error: unknown): boolean {
  const value = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(?:timeout|timed out|temporar|overload|rate.?limit|429|50[0234]|connection|network|econnreset|disconnected|retry)/i.test(
    value,
  );
}

function abortError(): Error {
  return new DOMException("Operação cancelada.", "AbortError");
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal)
      void Promise.resolve().then(() => {
        if (!signal.aborted) return;
        clearTimeout(timer);
        reject(abortError());
      });
  });
}

/** Runs the initial attempt plus at most two transient retries by default. */
export async function withTransientRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = Math.max(0, options.maxRetries ?? 2);
  const base = Math.max(1, options.baseDelayMs ?? 250);
  const maximum = Math.max(base, options.maxDelayMs ?? 5_000);
  const jitter = Math.max(0, Math.min(1, options.jitter ?? 0.25));
  const retryable = options.shouldRetry ?? isTransientProviderError;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw abortError();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !retryable(error)) throw error;
      const raw = Math.min(maximum, base * 2 ** attempt);
      const variation = raw * jitter * (Math.random() * 2 - 1);
      const delayMs = Math.max(0, Math.round(raw + variation));
      await options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await delay(delayMs, options.signal);
    }
  }
  throw lastError;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

interface CircuitRecord {
  consecutiveFailures: number;
  openedAt: number | null;
  probeInFlight: boolean;
}

export class ModelCircuitBreaker {
  readonly #records = new Map<string, CircuitRecord>();
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.#cooldownMs = Math.max(1, options.cooldownMs ?? 60_000);
    this.#now = options.now ?? Date.now;
  }

  key(selection: ModelSelection): string {
    return `${selection.providerId}:${selection.connectionId ?? "default"}:${selection.modelId}`;
  }

  state(selection: ModelSelection): "closed" | "open" | "half_open" {
    const record = this.#records.get(this.key(selection));
    if (!record?.openedAt) return "closed";
    if (this.#now() - record.openedAt < this.#cooldownMs) return "open";
    return "half_open";
  }

  canAttempt(selection: ModelSelection): boolean {
    const key = this.key(selection);
    const record = this.#records.get(key);
    const state = this.state(selection);
    if (state === "closed") return true;
    if (state === "open" || record?.probeInFlight) return false;
    this.#records.set(key, { ...record!, probeInFlight: true });
    return true;
  }

  success(selection: ModelSelection): void {
    this.#records.set(this.key(selection), {
      consecutiveFailures: 0,
      openedAt: null,
      probeInFlight: false,
    });
  }

  failure(selection: ModelSelection): void {
    const key = this.key(selection);
    const current = this.#records.get(key) ?? {
      consecutiveFailures: 0,
      openedAt: null,
      probeInFlight: false,
    };
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.#records.set(key, {
      consecutiveFailures,
      openedAt:
        consecutiveFailures >= this.#failureThreshold || current.openedAt !== null
          ? this.#now()
          : null,
      probeInFlight: false,
    });
  }

  reset(selection?: ModelSelection): void {
    if (selection) this.#records.delete(this.key(selection));
    else this.#records.clear();
  }
}

export function telemetryHeadroom(telemetry: ModelTelemetry | undefined): number {
  if (!telemetry) return 0.5;
  const concurrency =
    telemetry.concurrencyLimit && telemetry.concurrencyLimit > 0
      ? Math.max(0, 1 - telemetry.activeSessions / telemetry.concurrencyLimit)
      : 0.5;
  const quota =
    telemetry.quotaLimit && telemetry.quotaRemaining !== null
      ? Math.max(0, Math.min(1, telemetry.quotaRemaining / telemetry.quotaLimit))
      : 0.5;
  return (concurrency + quota) / 2;
}
