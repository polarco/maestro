import type { AppSettings } from "@maestro/contracts";

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

interface UpdaterPolicyTarget<T extends { version: string }> {
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  isUpdateSupported: (updateInfo: T) => boolean | Promise<boolean>;
}

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

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const values = match.slice(1, 4).map(Number);
  const beta = match[4] === undefined ? null : Number(match[4]);
  if (values.some((part) => !Number.isSafeInteger(part)) || !Number.isSafeInteger(beta ?? 0))
    return null;
  return { major: values[0]!, minor: values[1]!, patch: values[2]!, beta };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.beta === right.beta) return 0;
  if (left.beta === null) return 1;
  if (right.beta === null) return -1;
  return left.beta > right.beta ? 1 : -1;
}

export function isUpdateVersionAllowed(
  currentVersion: string,
  candidateVersion: string,
  channel: AppSettings["updateChannel"],
): boolean {
  const current = parseVersion(currentVersion);
  const candidate = parseVersion(candidateVersion);
  if (!current || !candidate) return false;
  if (channel === "stable" && candidate.beta !== null) return false;
  if (channel === "beta" && candidate.beta === null) return false;
  return compareVersions(candidate, current) > 0;
}

export function configureUpdaterPolicy<T extends { version: string }>(
  updater: UpdaterPolicyTarget<T>,
  currentVersion: string,
  channel: AppSettings["updateChannel"],
) {
  const resolved = resolveUpdateChannel(channel);
  updater.allowPrerelease = resolved.allowPrerelease;
  updater.channel = resolved.updaterChannel;
  // electron-updater enables downgrades whenever `channel` is assigned.
  // Always override that side effect after setting the channel.
  updater.allowDowngrade = false;
  updater.isUpdateSupported = (info) =>
    isUpdateVersionAllowed(currentVersion, info.version, channel);
  return resolved;
}

export function resolveUpdateInstallStrategy(
  platform: NodeJS.Platform,
  downloadedFile: string | null,
): "automatic" | "system-installer" {
  return platform === "linux" && downloadedFile?.toLowerCase().endsWith(".deb")
    ? "system-installer"
    : "automatic";
}
