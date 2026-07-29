import { describe, expect, it } from "vitest";
import { appSettingsUpdateSchema } from "./domain.js";

describe("appSettingsUpdateSchema", () => {
  it("preserva apenas as preferências enviadas em uma atualização parcial", () => {
    expect(appSettingsUpdateSchema.parse({ updateChannel: "beta" })).toEqual({
      updateChannel: "beta",
    });
    expect(appSettingsUpdateSchema.parse({ telemetryEnabled: true })).toEqual({
      telemetryEnabled: true,
    });
  });
});
