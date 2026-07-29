import { describe, expect, it } from "vitest";
import { appSettingsSchema } from "@maestro/contracts";
import {
  configureUpdaterPolicy,
  isUpdateVersionAllowed,
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

  it("only accepts strictly newer versions from the selected channel", () => {
    expect(isUpdateVersionAllowed("0.4.0", "0.4.1", "stable")).toBe(true);
    expect(isUpdateVersionAllowed("0.4.0", "0.4.0", "stable")).toBe(false);
    expect(isUpdateVersionAllowed("0.4.0", "0.3.9", "stable")).toBe(false);
    expect(isUpdateVersionAllowed("0.4.0", "0.5.0-beta.1", "stable")).toBe(false);

    expect(isUpdateVersionAllowed("0.5.0-beta.1", "0.5.0-beta.2", "beta")).toBe(true);
    expect(isUpdateVersionAllowed("0.5.0-beta.2", "0.5.0-beta.1", "beta")).toBe(false);
    expect(isUpdateVersionAllowed("0.5.0-beta.2", "0.5.0-beta.2", "beta")).toBe(false);
    expect(isUpdateVersionAllowed("0.5.0-beta.1", "0.5.0", "beta")).toBe(false);
    expect(isUpdateVersionAllowed("0.5.0-beta.2", "0.6.0-beta.1", "beta")).toBe(true);
    expect(isUpdateVersionAllowed("0.5.0-beta.2", "0.5.0-beta.10", "beta")).toBe(true);
    expect(isUpdateVersionAllowed("invalid", "0.6.0-beta.1", "beta")).toBe(false);
  });

  it("re-disables downgrades after electron-updater changes the channel", async () => {
    class FakeUpdater {
      allowPrerelease = false;
      allowDowngrade = false;
      isUpdateSupported: (info: { version: string }) => boolean | Promise<boolean> = () => true;
      #channel: string | null = null;

      get channel(): string | null {
        return this.#channel;
      }

      set channel(value: string | null) {
        this.#channel = value;
        this.allowDowngrade = true;
      }
    }

    const updater = new FakeUpdater();
    configureUpdaterPolicy(updater, "0.5.0-beta.2", "beta");
    expect(updater.channel).toBe("beta");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(await updater.isUpdateSupported({ version: "0.5.0-beta.3" })).toBe(true);
    expect(await updater.isUpdateSupported({ version: "0.5.0-beta.1" })).toBe(false);
    expect(await updater.isUpdateSupported({ version: "0.5.0" })).toBe(false);
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
