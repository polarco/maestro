import type { RunEvent } from "@maestro/contracts";
import { create } from "zustand";

export type AppView =
  | { type: "dashboard" }
  | { type: "conversation"; id: string }
  | { type: "run"; id: string }
  | { type: "terminal" }
  | { type: "history" }
  | { type: "mission-control" }
  | { type: "settings" };

interface AppStore {
  view: AppView;
  recentEvents: RunEvent[];
  setView: (view: AppView) => void;
  pushEvent: (event: RunEvent) => void;
  clearEvents: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  view: { type: "dashboard" },
  recentEvents: [],
  setView: (view) => set({ view }),
  pushEvent: (event) =>
    set((state) => ({
      recentEvents: [event, ...state.recentEvents.filter((item) => item.id !== event.id)].slice(
        0,
        120,
      ),
    })),
  clearEvents: () => set({ recentEvents: [] }),
}));
