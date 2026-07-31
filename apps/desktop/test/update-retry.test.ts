import { describe, expect, it, vi } from "vitest";
import {
  isTransientUpdateError,
  retryTransientUpdateOperation,
} from "../src/main/services/update-retry.js";

describe("update download retry", () => {
  it("recognizes temporary Electron and operating-system network failures", () => {
    expect(isTransientUpdateError(new Error("net::ERR_NETWORK_CHANGED"))).toBe(true);
    expect(
      isTransientUpdateError(Object.assign(new Error("socket closed"), { code: "ECONNRESET" })),
    ).toBe(true);
    expect(
      isTransientUpdateError(new Error("download failed", { cause: new Error("EAI_AGAIN") })),
    ).toBe(true);
    expect(isTransientUpdateError(new Error("HTTP 404: Not Found"))).toBe(false);
    expect(isTransientUpdateError(new Error("sha512 checksum mismatch"))).toBe(false);
  });

  it("retries transient failures with bounded backoff and then succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("net::ERR_NETWORK_CHANGED"))
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockResolvedValue("downloaded");
    const retries: Array<{ retryNumber: number; delayMs: number }> = [];
    const waits: number[] = [];

    await expect(
      retryTransientUpdateOperation(operation, {
        delaysMs: [10, 25, 50],
        onRetry: ({ retryNumber, delayMs }) => retries.push({ retryNumber, delayMs }),
        wait: (delayMs) => {
          waits.push(delayMs);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("downloaded");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(retries).toEqual([
      { retryNumber: 1, delayMs: 10 },
      { retryNumber: 2, delayMs: 25 },
    ]);
    expect(waits).toEqual([10, 25]);
  });

  it("does not retry permanent failures or exceed the retry budget", async () => {
    const permanent = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("HTTP 403"));
    await expect(
      retryTransientUpdateOperation(permanent, {
        delaysMs: [0, 0],
        wait: () => Promise.resolve(),
      }),
    ).rejects.toThrow("HTTP 403");
    expect(permanent).toHaveBeenCalledTimes(1);

    const unstable = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("net::ERR_NETWORK_CHANGED"));
    await expect(
      retryTransientUpdateOperation(unstable, {
        delaysMs: [0, 0],
        wait: () => Promise.resolve(),
      }),
    ).rejects.toThrow("ERR_NETWORK_CHANGED");
    expect(unstable).toHaveBeenCalledTimes(3);
  });
});
