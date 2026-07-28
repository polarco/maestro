import { describe, expect, it } from "vitest";
import { assertProviderUseAllowed } from "../src/main/providers/registry.js";

describe("provider billing policy", () => {
  it("allows paid APIs only for orchestrator analysis/planning", () => {
    expect(() => assertProviderUseAllowed("anthropic", "orchestrator")).not.toThrow();
    expect(() => assertProviderUseAllowed("openai-compatible", "orchestrator")).not.toThrow();
    for (const use of ["chat", "direct", "subscription-worker"] as const) {
      expect(() => assertProviderUseAllowed("anthropic", use)).toThrowError(
        expect.objectContaining({ code: "PAID_API_BLOCKED" }),
      );
    }
  });

  it("allows official subscription CLIs for every local role", () => {
    for (const provider of ["codex", "claude-code"]) {
      for (const use of ["orchestrator", "chat", "direct", "subscription-worker"] as const) {
        expect(() => assertProviderUseAllowed(provider, use)).not.toThrow();
      }
    }
  });
});
