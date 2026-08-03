import { describe, expect, it, vi } from "vitest";
import {
  isTransientProviderError,
  ModelCircuitBreaker,
  withTransientRetry,
} from "../src/recovery.js";

const selection = { providerId: "api", modelId: "model" };

describe("provider recovery", () => {
  it("retries transient failures no more than twice", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("503 temporarily unavailable"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue("ok");
    await expect(withTransientRetry(operation, { baseDelayMs: 1, jitter: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(isTransientProviderError(new Error("invalid schema"))).toBe(false);
  });

  it("opens, cools down and probes a model circuit exactly once", () => {
    let now = 1_000;
    const breaker = new ModelCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 500,
      now: () => now,
    });
    breaker.failure(selection);
    expect(breaker.state(selection)).toBe("closed");
    breaker.failure(selection);
    expect(breaker.state(selection)).toBe("open");
    expect(breaker.canAttempt(selection)).toBe(false);
    now += 501;
    expect(breaker.state(selection)).toBe("half_open");
    expect(breaker.canAttempt(selection)).toBe(true);
    expect(breaker.canAttempt(selection)).toBe(false);
    breaker.success(selection);
    expect(breaker.state(selection)).toBe("closed");
  });
});
