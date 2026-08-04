import { afterEach, describe, expect, it } from "vitest";
import { ProcessSupervisor } from "../src/main/services/process-supervisor.js";

describe("ProcessSupervisor", () => {
  const supervisors: ProcessSupervisor[] = [];

  afterEach(async () => {
    await Promise.all(supervisors.map((supervisor) => supervisor.killAll()));
    supervisors.length = 0;
  });

  function supervisor(): ProcessSupervisor {
    const value = new ProcessSupervisor();
    supervisors.push(value);
    return value;
  }

  it("passes arguments literally without a shell", async () => {
    const marker = "$(printf should-not-run) ; echo injected";
    const result = await supervisor().capture({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", marker],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(marker);
    expect(result.stderr).toBe("");
  });

  it("cancels a running process tree with an AbortSignal", async () => {
    const controller = new AbortController();
    const pending = supervisor().capture(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        label: "long-running fixture",
      },
      { signal: controller.signal, timeoutMs: 10_000 },
    );

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "PROCESS_CANCELED" });
  });

  it("enforces output limits", async () => {
    const result = await supervisor().capture(
      {
        executable: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(5000))"],
      },
      { maxOutputBytes: 128 },
    );

    expect(Buffer.byteLength(result.stdout)).toBe(128);
  });

  it("tracks and closes transport-owned resources", async () => {
    const value = supervisor();
    let closed = false;
    value.trackResource({
      label: "MCP fixture",
      pid: 123,
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    });

    expect(value.list()).toEqual([expect.objectContaining({ label: "MCP fixture", pid: 123 })]);
    await value.killAll();
    expect(closed).toBe(true);
    expect(value.list()).toEqual([]);
  });

  it("waits for direct child stdout to close before resolving", async () => {
    const payloadSize = 2 * 1024 * 1024;
    const marker = "complete-output";
    const writer = [
      `process.stdout.write("x".repeat(${payloadSize}))`,
      `process.stdout.write(${JSON.stringify(marker)})`,
    ].join(";");

    const result = await supervisor().capture(
      {
        executable: process.execPath,
        args: ["-e", writer],
      },
      { maxOutputBytes: payloadSize + Buffer.byteLength(marker) },
    );

    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBe(payloadSize + Buffer.byteLength(marker));
    expect(result.stdout.endsWith(marker)).toBe(true);
  });

  it("rejects after a timeout even when process exit races cleanup", async () => {
    const pending = supervisor().capture(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        label: "timeout fixture",
      },
      { timeoutMs: 25 },
    );

    await expect(pending).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });
});
