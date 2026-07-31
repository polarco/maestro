import type { EventPage, MaestroDesktopApi, RunEvent } from "@maestro/contracts";

export function api(): MaestroDesktopApi {
  if (!window.maestro) throw new Error("A API segura do Maestro não está disponível.");
  return window.maestro;
}

export async function getAllRunEvents(runId: string): Promise<EventPage> {
  const events: RunEvent[] = [];
  let afterSequence = 0;
  while (true) {
    const page = await api().getRunEvents(runId, afterSequence, 2_000);
    events.push(...page.events);
    if (page.nextSequence === null || page.nextSequence <= afterSequence) break;
    afterSequence = page.nextSequence;
  }
  return { events, nextSequence: null };
}
