import type { ReactElement, ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip } from "radix-ui";
import { cn } from "@renderer/lib/utils";

export const TooltipProvider = Tooltip.Provider;

export function TooltipHint({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="tooltip-content"
          side={side}
          sideOffset={7}
          collisionPadding={10}
        >
          {content}
          <Tooltip.Arrow className="fill-border-strong" width={9} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function InfoTooltip({
  content,
  label = "Mais informações",
  className,
}: {
  content: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <TooltipHint content={content}>
      <button
        type="button"
        className={cn(
          "inline-grid size-5 shrink-0 place-items-center rounded-full text-text-faint transition-colors hover:bg-surface-hover hover:text-text focus-visible:text-text",
          className,
        )}
        aria-label={label}
      >
        <CircleHelp size={13} />
      </button>
    </TooltipHint>
  );
}
