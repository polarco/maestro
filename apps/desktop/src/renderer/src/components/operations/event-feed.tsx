import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileCode2,
  GitBranch,
  MessageSquareText,
  Route,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { RunEvent } from "@maestro/contracts";
import { cn, durationLabel, relativeTime } from "@renderer/lib/utils";

function EventIcon({ event }: { event: RunEvent }) {
  const props = { size: 13 };
  if (event.type === "error") return <AlertTriangle {...props} className="text-danger" />;
  if (event.type.startsWith("command.")) return <TerminalSquare {...props} className="text-info" />;
  if (event.type.startsWith("tool.")) return <Wrench {...props} className="text-primary-soft" />;
  if (event.type === "file.diff") return <FileCode2 {...props} className="text-warning" />;
  if (event.type === "route.selected") return <Route {...props} className="text-primary-soft" />;
  if (event.type.startsWith("agent.")) return <Bot {...props} className="text-info" />;
  if (event.type === "message.completed")
    return <MessageSquareText {...props} className="text-text-muted" />;
  if (event.type === "plan.approved") return <CheckCircle2 {...props} className="text-success" />;
  if (event.type === "run.state" || event.type === "task.state")
    return <GitBranch {...props} className="text-info" />;
  return <CircleDot {...props} className="text-text-faint" />;
}

function summary(event: RunEvent): string {
  switch (event.type) {
    case "run.state":
      return event.data.reason ?? `${event.data.from ?? "início"} → ${event.data.to}`;
    case "task.state":
      return `${event.data.taskId}: ${event.data.to}`;
    case "route.selected":
      return `${event.data.role} → ${event.data.selection.providerId}/${event.data.selection.modelId}`;
    case "plan.created":
      return `Plano v${event.data.plan.version} criado`;
    case "plan.approved":
      return `Plano v${event.data.version} aprovado`;
    case "agent.started":
      return `${event.data.label} iniciou`;
    case "agent.stopped":
      return `Agente ${event.data.outcome === "completed" ? "concluiu" : event.data.outcome}`;
    case "command.started":
      return `${event.data.executable} ${event.data.args.join(" ")}`;
    case "command.completed":
      return `Comando encerrou com ${event.data.exitCode ?? event.data.signal ?? "erro"} em ${durationLabel(event.data.durationMs)}`;
    case "command.output":
      return `${event.data.stream}: ${event.data.chunk.trim().split("\n")[0] ?? ""}`;
    case "tool.started":
      return `${event.data.name} em execução`;
    case "tool.completed":
      return `${event.data.name} ${event.data.isError ? "falhou" : "concluiu"}`;
    case "file.diff":
      return `Alterou ${event.data.path}`;
    case "message.completed":
      return event.data.content.slice(0, 120) || "Resposta concluída";
    case "message.delta":
      return event.data.delta.slice(0, 120);
    case "analysis.completed":
      return `Análise: ${event.data.analysis.objective}`;
    case "approval.required":
      return `Aprovação solicitada: ${event.data.summary}`;
    case "approval.resolved":
      return `Aprovação ${event.data.decision === "approved" ? "concedida" : "negada"} pela política`;
    case "metric":
      return `Métricas${event.data.outputTokens ? ` · ${event.data.outputTokens} tokens de saída` : ""}`;
    case "log":
      return event.data.message;
    case "error":
      return event.data.message;
    case "run.created":
      return `Execução ${event.data.mode} criada`;
    case "plan.revision_requested":
      return `Revisão solicitada para o plano v${event.data.version}`;
  }
}

function details(event: RunEvent): unknown {
  if (event.type === "command.output") return event.data.chunk;
  if (event.type === "file.diff") return event.data.patch;
  if (event.type === "tool.started") return event.data.input;
  if (event.type === "tool.completed") return event.data.output;
  if (event.type === "error") return event.data.detail;
  return null;
}

function EventRow({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const detail = details(event);
  return (
    <div
      className={cn(
        "border-b border-border/60 last:border-b-0",
        event.type === "error" && "bg-danger/[0.025]",
      )}
    >
      <button
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover/40"
        onClick={() => detail !== null && setOpen((value) => !value)}
        disabled={detail === null}
      >
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] border border-border bg-bg-elevated">
          <EventIcon event={event} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[12px] leading-5 text-text-muted",
              event.type === "error" && "text-danger",
            )}
          >
            {summary(event)}
          </span>
          <span className="mt-0.5 block text-[10px] text-text-faint">
            {relativeTime(event.occurredAt)}
          </span>
        </span>
        {detail !== null ? (
          <ChevronDown
            size={12}
            className={cn("mt-1 text-text-faint transition-transform", open && "rotate-180")}
          />
        ) : null}
      </button>
      {open && detail !== null ? (
        <pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-[9px] border border-border bg-bg p-3 font-mono text-[11px] leading-5 text-text-muted">
          {typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function EventFeed({
  events,
  empty = "Nenhum evento ainda.",
}: {
  events: RunEvent[];
  empty?: string;
}) {
  const visible = events.filter((event) => event.type !== "message.delta");
  if (visible.length === 0)
    return <div className="p-8 text-center text-[12px] text-text-faint">{empty}</div>;
  return (
    <div>
      {visible.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </div>
  );
}
