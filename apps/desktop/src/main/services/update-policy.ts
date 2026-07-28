import type { AppSettings } from "@maestro/contracts";

export const UPDATE_REPOSITORY = Object.freeze({
  provider: "github",
  owner: "polarco",
  repo: "maestro",
  url: "https://github.com/polarco/maestro/releases",
} as const);

export const UPDATE_CHANNELS = Object.freeze({
  stable: Object.freeze({
    updaterChannel: "latest",
    allowPrerelease: false,
    label: "Estável",
  }),
  beta: Object.freeze({
    updaterChannel: "beta",
    allowPrerelease: true,
    label: "Beta",
  }),
} as const satisfies Record<
  AppSettings["updateChannel"],
  { updaterChannel: string; allowPrerelease: boolean; label: string }
>);

export function resolveUpdateChannel(channel: AppSettings["updateChannel"]) {
  return UPDATE_CHANNELS[channel];
}
