export const UPDATE_DOWNLOAD_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 8_000] as const);

const TRANSIENT_UPDATE_ERROR_MARKERS = [
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NETWORK_IO_SUSPENDED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_ABORTED",
  "ERR_TIMED_OUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "SOCKET HANG UP",
  "NETWORK REQUEST FAILED",
  "FETCH FAILED",
] as const;

function errorDetails(error: unknown, depth = 0): string[] {
  if (depth > 2 || error === null || error === undefined) return [];
  if (typeof error === "string" || typeof error === "number") return [String(error)];
  if (typeof error !== "object") return [];

  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return [value.name, value.code, value.message]
    .flatMap((part) => (typeof part === "string" || typeof part === "number" ? [String(part)] : []))
    .concat(errorDetails(value.cause, depth + 1));
}

export function isTransientUpdateError(error: unknown): boolean {
  const details = errorDetails(error).join(" ").toUpperCase();
  return TRANSIENT_UPDATE_ERROR_MARKERS.some((marker) => details.includes(marker));
}

export interface UpdateRetryEvent {
  retryNumber: number;
  maxRetries: number;
  delayMs: number;
  error: unknown;
}

interface UpdateRetryOptions {
  delaysMs?: readonly number[];
  onRetry?: (event: UpdateRetryEvent) => void;
  wait?: (delayMs: number) => Promise<void>;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function retryTransientUpdateOperation<T>(
  operation: (attempt: number) => Promise<T>,
  options: UpdateRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? UPDATE_DOWNLOAD_RETRY_DELAYS_MS;
  const waitForRetry = options.wait ?? wait;
  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      const delayMs = delays[attempt];
      if (!isTransientUpdateError(error) || delayMs === undefined) throw error;
      options.onRetry?.({
        retryNumber: attempt + 1,
        maxRetries: delays.length,
        delayMs,
        error,
      });
      await waitForRetry(delayMs);
      attempt += 1;
    }
  }
}
