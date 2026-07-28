import { cn } from "@renderer/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[12px] bg-gradient-to-r from-surface-hover via-surface-raised to-surface-hover",
        className,
      )}
    />
  );
}

export function LoadingPane() {
  return (
    <div
      className="mx-auto flex h-full w-full max-w-[1240px] flex-col gap-4 p-6 lg:p-8"
      aria-label="Carregando"
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="hidden h-40 xl:block" />
      </div>
    </div>
  );
}
