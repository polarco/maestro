import type { MaestroDesktopApi } from "@maestro/contracts";

export function api(): MaestroDesktopApi {
  if (!window.maestro) throw new Error("A API segura do Maestro não está disponível.");
  return window.maestro;
}
