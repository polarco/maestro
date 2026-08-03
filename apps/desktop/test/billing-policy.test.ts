import { describe, expect, it } from "vitest";
import { assertProviderUseAllowed } from "../src/main/providers/registry.js";

describe("provider billing policy", () => {
  it("allows configured API providers through the Maestro-owned tool loop", () => {
    for (const provider of ["anthropic", "openai-compatible"]) {
      for (const use of ["orchestrator", "chat", "direct", "subscription-worker"] as const) {
        expect(() => assertProviderUseAllowed(provider, use)).not.toThrow();
      }
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
