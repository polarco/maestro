import { Check, LoaderCircle, Minus, X } from "lucide-react";
import type { RunState, TaskState } from "@maestro/contracts";
import { cn } from "@renderer/lib/utils";

export function StatusDot({
  state,
  size = "md",
}: {
  state: RunState | TaskState;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "size-5" : "size-6";
  if (state === "completed") {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-success/12 text-success",
          dimension,
        )}
      >
        <Check size={size === "sm" ? 11 : 13} strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "failed" || state === "canceled") {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-danger/12 text-danger",
          dimension,
        )}
      >
        <X size={size === "sm" ? 11 : 13} strokeWidth={2.5} />
      </span>
    );
  }
  if (["analyzing", "planning", "queued", "running", "validating", "integrating"].includes(state)) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-info/12 text-info",
          dimension,
        )}
      >
        <LoaderCircle className="animate-spin" size={size === "sm" ? 11 : 13} />
      </span>
    );
  }
  if (state === "awaiting_approval" || state === "blocked") {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full border border-warning/30 bg-warning/8 text-warning",
          dimension,
        )}
      >
        <Minus size={size === "sm" ? 10 : 12} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full border border-border bg-bg-elevated text-text-faint",
        dimension,
      )}
    >
      <span className="size-1 rounded-full bg-current" />
    </span>
  );
}
