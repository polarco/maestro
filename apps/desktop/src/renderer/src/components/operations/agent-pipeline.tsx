import { Check, Circle, LockKeyhole } from "lucide-react";
import type { RunState } from "@maestro/contracts";
import { cn } from "@renderer/lib/utils";

const stages: Array<{ states: RunState[]; label: string }> = [
  { states: ["discovering", "analyzing"], label: "Entender" },
  { states: ["awaiting_clarification"], label: "Alinhar" },
  { states: ["researching"], label: "Pesquisar" },
  { states: ["planning", "awaiting_approval"], label: "Plano" },
  { states: ["queued", "running"], label: "Agentes" },
  { states: ["validating"], label: "Validar" },
  { states: ["integrating", "completed"], label: "Integrar" },
];

function stageIndex(state: RunState): number {
  if (state === "failed" || state === "canceled") return -1;
  return stages.findIndex((stage) => stage.states.includes(state));
}

export function AgentPipeline({ state, compact = false }: { state: RunState; compact?: boolean }) {
  const current = stageIndex(state);
  return (
    <div
      className={cn("flex min-w-0 items-start", compact ? "gap-0" : "gap-1")}
      aria-label={`Pipeline: ${state}`}
    >
      {stages.map((stage, index) => {
        const active = index === current;
        const complete = current > index || state === "completed";
        const approval =
          (state === "awaiting_clarification" && stage.states.includes("awaiting_clarification")) ||
          (state === "awaiting_approval" && stage.states.includes("awaiting_approval"));
        return (
          <div key={stage.label} className="flex min-w-0 flex-1 items-start">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-text-faint transition-[color,background-color,border-color,box-shadow]",
                  complete && "border-success/25 bg-success/12 text-success",
                  active &&
                    !approval &&
                    "border-info/30 bg-info/12 text-info shadow-[0_0_14px_rgb(112_183_214/0.16)]",
                  approval &&
                    "border-warning/35 bg-warning/12 text-warning shadow-[0_0_14px_rgb(239_182_93/0.14)]",
                  !active && !complete && "border-border bg-bg-elevated",
                )}
              >
                {complete ? (
                  <Check size={11} strokeWidth={2.6} />
                ) : approval ? (
                  <LockKeyhole size={10} />
                ) : (
                  <Circle size={7} fill="currentColor" />
                )}
              </div>
              {!compact ? (
                <span
                  className={cn(
                    "truncate text-[10px] font-medium text-text-faint",
                    (active || complete) && "text-text-muted",
                  )}
                >
                  {stage.label}
                </span>
              ) : null}
            </div>
            {index < stages.length - 1 ? (
              <span
                className={cn("mt-[13px] h-px w-full bg-border", complete && "bg-success/35")}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
