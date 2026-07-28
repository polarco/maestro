import { cn } from "@renderer/lib/utils";

export function MaestroMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative grid size-8 place-items-center rounded-[10px] border border-primary/35 bg-gradient-to-br from-primary/22 to-primary/8 text-primary-soft shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_8px_24px_rgb(91_88_210/0.14)]",
        className,
      )}
      aria-hidden="true"
    >
      <span className="font-mono text-[13px] font-bold tracking-[-0.08em]">M</span>
      <span className="absolute -right-0.5 top-1 size-1.5 rounded-full border border-bg bg-success" />
    </div>
  );
}
