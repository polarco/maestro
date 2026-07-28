import { describe, expect, it } from "vitest";
import { appSettingsSchema } from "@maestro/contracts";
import {
  resolveUpdateChannel,
  UPDATE_CHANNELS,
  UPDATE_REPOSITORY,
} from "../src/main/services/update-policy.js";

describe("update channel policy", () => {
  it("uses the official public GitHub repository", () => {
    expect(UPDATE_REPOSITORY).toEqual({
      provider: "github",
      owner: "polarco",
      repo: "maestro",
      url: "https://github.com/polarco/maestro/releases",
    });
  });

  it("maps stable and beta to immutable updater channels", () => {
    expect(Object.keys(UPDATE_CHANNELS)).toEqual(["stable", "beta"]);
    expect(resolveUpdateChannel("stable")).toEqual({
      updaterChannel: "latest",
      allowPrerelease: false,
      label: "Estável",
    });
    expect(resolveUpdateChannel("beta")).toEqual({
      updaterChannel: "beta",
      allowPrerelease: true,
      label: "Beta",
    });
  });

  it("drops the legacy custom feed instead of persisting arbitrary origins", () => {
    const parsed = appSettingsSchema.parse({
      updateChannel: "stable",
      updateFeedUrl: "https://untrusted.example.com/releases",
    });
    expect(parsed).not.toHaveProperty("updateFeedUrl");
  });
});
