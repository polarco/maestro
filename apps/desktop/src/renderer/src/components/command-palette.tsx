import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Command,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { BootstrapPayload } from "@maestro/contracts";
import { useAppStore, type AppView } from "@renderer/store/app-store";
import { relativeTime } from "@renderer/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  bootstrap: BootstrapPayload;
  onClose: () => void;
  onNewConversation: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  detail: string;
  icon: typeof Search;
  keywords: string;
  action: () => void;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function CommandPalette({
  open,
  bootstrap,
  onClose,
  onNewConversation,
}: CommandPaletteProps) {
  const setView = useAppStore((state) => state.setView);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const navigate = (view: AppView) => {
    setView(view);
    onClose();
  };

  const items = useMemo<PaletteItem[]>(
    () => [
      {
        id: "new",
        label: "Nova conversa",
        detail: "Comece uma tarefa no projeto ativo",
        icon: Plus,
        keywords: "novo criar tarefa conversa",
        action: () => {
          onClose();
          onNewConversation();
        },
      },
      {
        id: "dashboard",
        label: "Visão geral",
        detail: "Acompanhe execuções e provedores",
        icon: LayoutDashboard,
        keywords: "inicio dashboard visão geral",
        action: () => navigate({ type: "dashboard" }),
      },
      {
        id: "history",
        label: "Histórico",
        detail: "Encontre conversas anteriores",
        icon: Clock3,
        keywords: "historico conversas recentes",
        action: () => navigate({ type: "history" }),
      },
      {
        id: "terminal",
        label: "Terminal",
        detail: "Abra uma sessão na raiz autorizada",
        icon: SquareTerminal,
        keywords: "terminal shell pty comando",
        action: () => navigate({ type: "terminal" }),
      },
      {
        id: "settings",
        label: "Configurações",
        detail: "Provedores, projeto e preferências",
        icon: Settings,
        keywords: "configuracoes ajustes provedores projeto",
        action: () => navigate({ type: "settings" }),
      },
      ...bootstrap.recentConversations.slice(0, 10).map((conversation) => ({
        id: `conversation-${conversation.id}`,
        label: conversation.title,
        detail: `${conversation.mode} · ${relativeTime(conversation.updatedAt)}`,
        icon: MessageSquare,
        keywords: `conversa ${conversation.mode} ${conversation.title}`,
        action: () => navigate({ type: "conversation", id: conversation.id }),
      })),
    ],
    [bootstrap.recentConversations, onNewConversation],
  );

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return items;
    return items.filter((item) => normalize(`${item.label} ${item.keywords}`).includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((value) => (filtered.length ? (value + 1) % filtered.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((value) =>
          filtered.length ? (value - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (event.key === "Enter" && filtered[selected]) {
        event.preventDefault();
        filtered[selected].action();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, onClose, open, selected]);

  if (!open) return null;

  return (
    <div
      className="command-backdrop fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        className="glass-popover page-enter w-full max-w-[640px] overflow-hidden rounded-[18px]"
      >
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Search size={18} className="shrink-0 text-text-faint" />
          <input
            ref={inputRef}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-text outline-none placeholder:text-text-faint focus-visible:outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ir para uma tela ou encontrar uma conversa…"
            aria-label="Buscar ações e conversas"
          />
          <kbd className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] text-text-faint">
            Esc
          </kbd>
        </div>
        <div className="max-h-[430px] overflow-y-auto p-2">
          {filtered.length ? (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const recent = item.id.startsWith("conversation-");
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition-colors ${
                    selected === index
                      ? "bg-primary/12 text-text"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                  onMouseMove={() => setSelected(index)}
                  onClick={item.action}
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-[10px] border ${
                      item.id === "new"
                        ? "border-primary/25 bg-primary/12 text-primary-soft"
                        : "border-border bg-bg-elevated text-text-muted"
                    }`}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-faint">
                      {item.detail}
                    </span>
                  </span>
                  {recent ? (
                    <span className="rounded-full border border-border px-2 py-1 text-[9px] uppercase tracking-wide text-text-faint">
                      conversa
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center text-center">
              <div className="grid size-11 place-items-center rounded-[12px] bg-surface-hover text-text-faint">
                <Command size={19} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-text">Nada encontrado</p>
              <p className="mt-1 text-[11px] text-text-faint">Tente buscar por outro termo.</p>
            </div>
          )}
        </div>
        <footer className="flex h-10 items-center gap-4 border-t border-border bg-bg-elevated/55 px-4 text-[10px] text-text-faint">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span className="ml-auto">Busca rápida do Maestro</span>
        </footer>
      </section>
    </div>
  );
}
