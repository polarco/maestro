import { describe, expect, it } from "vitest";
import { appSettingsSchema } from "@maestro/contracts";
import {
  resolveUpdateChannel,
  resolveUpdateInstallStrategy,
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

  it("opens deb updates with the system installer instead of invoking pkexec directly", () => {
    expect(resolveUpdateInstallStrategy("linux", "/tmp/Maestro-0.4.0-linux-amd64.deb")).toBe(
      "system-installer",
    );
    expect(resolveUpdateInstallStrategy("linux", "/tmp/Maestro.AppImage")).toBe("automatic");
    expect(resolveUpdateInstallStrategy("win32", "C:\\Temp\\Maestro.deb")).toBe("automatic");
    expect(resolveUpdateInstallStrategy("linux", null)).toBe("automatic");
  });
});
