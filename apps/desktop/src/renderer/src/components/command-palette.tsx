import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Activity,
  Command,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { BootstrapPayload, GlobalSearchResult } from "@maestro/contracts";
import { useAppStore, type AppView } from "@renderer/store/app-store";
import { relativeTime } from "@renderer/lib/utils";
import { api } from "@renderer/lib/api";

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
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const navigate = (view: AppView) => {
    setView(view);
    onClose();
  };

  const items = useMemo<PaletteItem[]>(
    () => [
      {
        id: "mission-control",
        label: "Mission Control",
        detail: "Acompanhe agentes e trabalhos em background",
        icon: Activity,
        keywords: "agentes tarefas jobs background execução",
        action: () => navigate({ type: "mission-control" }),
      },
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
  const globalItems = useMemo<PaletteItem[]>(
    () =>
      globalResults.map((result) => ({
        id: `global-${result.type}-${result.id}`,
        label: result.title,
        detail: `${result.type} · ${result.excerpt.replace(/<\/?mark>/g, "")}`,
        icon: result.type === "conversation" || result.type === "message" ? MessageSquare : Search,
        keywords: `${result.type} ${result.title} ${result.excerpt}`,
        action: () =>
          navigate(
            result.sessionId
              ? { type: "conversation", id: result.sessionId }
              : { type: "dashboard" },
          ),
      })),
    [globalResults],
  );
  const visibleItems = query.trim().length >= 2 ? [...filtered, ...globalItems] : filtered;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    const projectId = bootstrap.activeProjectId;
    const value = query.trim();
    if (!open || !projectId || value.length < 2) {
      setGlobalResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api()
        .globalSearch(projectId, value, 20)
        .then((results) => {
          if (active) setGlobalResults(results);
        })
        .catch(() => {
          if (active) setGlobalResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [bootstrap.activeProjectId, open, query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((value) => (visibleItems.length ? (value + 1) % visibleItems.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((value) =>
          visibleItems.length ? (value - 1 + visibleItems.length) % visibleItems.length : 0,
        );
      } else if (event.key === "Enter" && visibleItems[selected]) {
        event.preventDefault();
        visibleItems[selected].action();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, selected, visibleItems]);

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
          {visibleItems.length ? (
            visibleItems.map((item, index) => {
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
              <p className="mt-1 text-[11px] text-text-faint">
                {searching ? "Buscando no índice local…" : "Tente buscar por outro termo."}
              </p>
            </div>
          )}
        </div>
        <footer className="flex h-10 items-center gap-4 border-t border-border bg-bg-elevated/55 px-4 text-[10px] text-text-faint">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span className="ml-auto">
            {searching ? "Buscando mensagens, artefatos e memórias…" : "Índice local FTS5"}
          </span>
        </footer>
      </section>
    </div>
  );
}
