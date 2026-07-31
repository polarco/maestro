import { describe, expect, it } from "vitest";
import { appSettingsSchema, appSettingsUpdateSchema, maestroDiscoverySchema } from "./domain.js";

describe("appSettingsUpdateSchema", () => {
  it("preserva apenas as preferências enviadas em uma atualização parcial", () => {
    expect(appSettingsUpdateSchema.parse({ updateChannel: "beta" })).toEqual({
      updateChannel: "beta",
    });
    expect(appSettingsUpdateSchema.parse({ telemetryEnabled: true })).toEqual({
      telemetryEnabled: true,
    });
    expect(appSettingsUpdateSchema.parse({ tokenOptimizationMode: "aggressive" })).toEqual({
      tokenOptimizationMode: "aggressive",
    });
  });

  it("ativa a estratégia balanceada para configurações antigas", () => {
    expect(appSettingsSchema.parse({}).tokenOptimizationMode).toBe("balanced");
  });
});

describe("maestroDiscoverySchema", () => {
  it("aceita quantas perguntas materiais a descoberta precisar, sem teto artificial", () => {
    const questions = Array.from({ length: 12 }, (_, index) => ({
      id: `question-${index + 1}`,
      question: `Decisão material ${index + 1}?`,
      reason: "A resposta muda a solução.",
      options: [],
    }));

    expect(
      maestroDiscoverySchema.parse({
        understanding: "Entendimento inicial",
        desiredOutcome: "Resultado funcional",
        deliverable: "Mudança no produto",
        audience: "Usuários",
        constraints: [],
        assumptions: [],
        requiredCapabilities: [],
        researchTopics: [],
        questions,
      }).questions,
    ).toHaveLength(12);
  });
});
