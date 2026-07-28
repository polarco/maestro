import type { AppSettings } from "@maestro/contracts";

export type ThemePreference = AppSettings["theme"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "maestro.theme";

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function readStoredTheme(): ThemePreference | null {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function storeTheme(theme: ThemePreference): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}
