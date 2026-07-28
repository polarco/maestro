import { describe, expect, it } from "vitest";
import { assertRunTransition, canTransitionRun, isTerminalRunState } from "../src/state-machine.js";

describe("run state machine", () => {
  it("follows the approval lifecycle", () => {
    expect(canTransitionRun("analyzing", "planning")).toBe(true);
    expect(canTransitionRun("planning", "awaiting_approval")).toBe(true);
    expect(canTransitionRun("awaiting_approval", "queued")).toBe(true);
    expect(canTransitionRun("queued", "running")).toBe(true);
    expect(canTransitionRun("running", "integrating")).toBe(true);
    expect(canTransitionRun("integrating", "completed")).toBe(true);
  });

  it("blocks writes lifecycle jumps and terminal transitions", () => {
    expect(() => assertRunTransition("planning", "running")).toThrow("Transição inválida");
    expect(canTransitionRun("completed", "running")).toBe(false);
    expect(isTerminalRunState("canceled")).toBe(true);
  });
});
