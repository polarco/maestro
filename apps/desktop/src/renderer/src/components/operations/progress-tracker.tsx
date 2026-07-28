import { Clock3 } from "lucide-react";
import type { TaskRun } from "@maestro/contracts";
import { Badge } from "../ui/badge";
import { StatusDot } from "./status-dot";
import { TASK_LABELS, relativeTime, stateTone } from "@renderer/lib/utils";

export function ProgressTracker({ tasks }: { tasks: TaskRun[] }) {
  if (tasks.length === 0) {
    return (
      <div className="p-5 text-center text-[12px] text-text-faint">
        As tarefas aparecerão após a aprovação.
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/70">
      {tasks.map((task, index) => (
        <div key={task.id} className="relative flex gap-3.5 px-4 py-4">
          <div className="relative">
            <StatusDot state={task.state} />
            {index < tasks.length - 1 ? (
              <span className="absolute left-1/2 top-7 h-[calc(100%+8px)] w-px -translate-x-1/2 bg-border" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-text">
                {task.spec.title}
              </span>
              <Badge tone={stateTone(task.state)} className="ml-auto shrink-0">
                {TASK_LABELS[task.state]}
              </Badge>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-text-faint">
              {task.spec.description}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-text-faint">
              <span>{task.spec.role}</span>
              <span>·</span>
              <span>
                {task.spec.model.providerId}/{task.spec.model.modelId}
              </span>
              {task.startedAt ? (
                <>
                  <Clock3 className="ml-auto" size={10} />
                  <span>{relativeTime(task.startedAt)}</span>
                </>
              ) : null}
            </div>
            {task.error ? (
              <p className="mt-2 rounded-md bg-danger/8 px-2.5 py-2 text-[11px] text-danger">
                {task.error}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
