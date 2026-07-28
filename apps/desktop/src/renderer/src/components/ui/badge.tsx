import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

const tones = {
  neutral: "border-border bg-surface-hover text-text-muted",
  info: "border-info/20 bg-info/10 text-info",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  danger: "border-danger/20 bg-danger/10 text-danger",
  primary: "border-primary/20 bg-primary/10 text-primary-soft",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-semibold leading-none",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
