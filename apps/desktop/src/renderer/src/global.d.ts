import type { MaestroDesktopApi } from "@maestro/contracts";

declare global {
  interface Window {
    maestro: MaestroDesktopApi;
  }
}

export {};
