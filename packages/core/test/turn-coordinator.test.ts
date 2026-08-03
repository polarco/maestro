import { describe, expect, it } from "vitest";
import {
  classifyTurnIntent,
  executionPolicyHash,
  policyForIntent,
} from "../src/turn-coordinator.js";

describe("adaptive turn coordinator", () => {
  it("answers simple questions, researches workspace facts and plans mutations", () => {
    expect(classifyTurnIntent("O que é uma promise?", { hasWorkspace: true }).path).toBe("answer");
    expect(classifyTurnIntent("Revise o código em src/main.ts", { hasWorkspace: true }).path).toBe(
      "research",
    );
    expect(classifyTurnIntent("Corrija o bug em src/main.ts", { hasWorkspace: true }).path).toBe(
      "plan",
    );
    expect(classifyTurnIntent("Execute o fluxo Maestro E2E", { hasWorkspace: true }).path).toBe(
      "plan",
    );
  });

  it("only classifies explicit approval as execution when a plan is pending", () => {
    expect(
      classifyTurnIntent("Pode executar o plano", {
        hasWorkspace: true,
        awaitingApproval: true,
        approvedPlanVersion: 2,
      }).path,
    ).toBe("execute");
    expect(classifyTurnIntent("Pode executar o plano", { hasWorkspace: true }).path).not.toBe(
      "execute",
    );
  });

  it("exposes no tools for direct answers and keeps scope hashes stable across approval", () => {
    const intent = classifyTurnIntent("Qual é a capital do Brasil?", { hasWorkspace: true });
    const policy = policyForIntent(intent, ["/workspace"]);
    expect(policy.allowedTools).toEqual([]);
    expect(policy.readableRoots).toEqual([]);
    expect(executionPolicyHash({ ...policy, writeApproved: true })).toBe(policy.scopeHash);
    expect(executionPolicyHash({ ...policy, approvalId: "approval-1" })).toBe(policy.scopeHash);
  });
});
