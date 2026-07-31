import type { RunState } from "@maestro/contracts";
import { MaestroError } from "./errors.js";

const TERMINAL_STATES = new Set<RunState>(["completed", "failed", "canceled"]);

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  discovering: ["awaiting_clarification", "researching", "failed", "canceled"],
  awaiting_clarification: ["discovering", "failed", "canceled"],
  researching: ["planning", "awaiting_clarification", "failed", "canceled"],
  analyzing: ["planning", "researching", "failed", "canceled"],
  planning: ["awaiting_approval", "failed", "canceled"],
  awaiting_approval: ["planning", "queued", "failed", "canceled"],
  queued: ["running", "failed", "canceled"],
  running: ["validating", "integrating", "completed", "failed", "canceled"],
  validating: ["running", "integrating", "failed", "canceled"],
  integrating: ["completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!canTransitionRun(from, to)) {
    throw new MaestroError("INVALID_RUN_TRANSITION", `Transição inválida: ${from} → ${to}`, {
      detail: { from, to },
    });
  }
}
