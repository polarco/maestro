import { Waypoints } from "lucide-react";
import { cn } from "@renderer/lib/utils";

export function MaestroMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative grid size-8 place-items-center rounded-[11px] border border-primary bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_10px_24px_-14px_rgb(251_65_55/0.8)]",
        className,
      )}
      aria-hidden="true"
    >
      <Waypoints size={16} strokeWidth={2.35} />
      <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-sidebar bg-success" />
    </div>
  );
}
