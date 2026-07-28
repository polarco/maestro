import { Bot, ChevronRight, GitBranch, Timer } from "lucide-react";
import type { TaskRun } from "@maestro/contracts";
import { StatusDot } from "./status-dot";
import { compactPath, relativeTime } from "@renderer/lib/utils";

export function SubagentRow({ task }: { task: TaskRun }) {
  return (
    <div className="group flex items-center gap-3 rounded-[11px] border border-border bg-bg-elevated px-3 py-3 transition-colors hover:border-border-strong">
      <StatusDot state={task.state} size="sm" />
      <div className="grid size-7 place-items-center rounded-[7px] bg-surface-hover text-text-muted">
        <Bot size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-semibold text-text">{task.spec.title}</span>
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[9px] text-text-faint">
            {task.spec.role}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-text-faint">
          <span>{task.spec.model.providerId}</span>
          {task.branch ? (
            <>
              <GitBranch size={9} />
              <span className="truncate" title={task.branch}>
                {compactPath(task.branch, 28)}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {task.startedAt ? (
        <div className="flex items-center gap-1 text-[10px] text-text-faint">
          <Timer size={10} /> {relativeTime(task.startedAt)}
        </div>
      ) : null}
      <ChevronRight
        size={13}
        className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}
