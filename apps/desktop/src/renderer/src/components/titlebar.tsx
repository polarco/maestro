import { Command, Minus, Search, Square, X } from "lucide-react";
import { api } from "@renderer/lib/api";

export function Titlebar({
  context,
  onOpenCommand,
}: {
  context?: string;
  onOpenCommand?: () => void;
}) {
  const mac = navigator.userAgent.includes("Mac");
  return (
    <header className="titlebar flex h-[42px] shrink-0 items-center border-b border-border/80 bg-bg/95 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1 text-[11px] font-medium text-text-faint">
        <span className="size-2 rounded-full bg-primary shadow-[0_0_14px_rgb(124_131_247/0.6)]" />
        <span className="text-text-muted">Maestro</span>
        <span className="text-border-strong">/</span>
        <span className="truncate">{context ?? "Central de agentes local"}</span>
      </div>
      {onOpenCommand ? (
        <button
          className="no-drag mr-3 hidden h-7 w-52 items-center gap-2 rounded-[8px] border border-border bg-bg-elevated/70 px-2.5 text-left text-[10px] text-text-faint transition-colors hover:border-border-strong hover:bg-surface-hover lg:flex"
          onClick={onOpenCommand}
          aria-label="Abrir busca rápida"
        >
          <Search size={12} />
          <span className="flex-1">Buscar ou navegar</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px]">
            {mac ? <Command size={8} /> : "Ctrl"} K
          </kbd>
        </button>
      ) : null}
      <div className="no-drag flex items-center gap-0.5">
        <button
          className="window-button"
          aria-label="Minimizar"
          onClick={() => void api().minimizeWindow()}
        >
          <Minus size={14} />
        </button>
        <button
          className="window-button"
          aria-label="Maximizar ou restaurar"
          onClick={() => void api().maximizeWindow()}
        >
          <Square size={12} />
        </button>
        <button
          className="window-button hover:!bg-danger/15 hover:!text-danger"
          aria-label="Fechar"
          onClick={() => void api().closeWindow()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
