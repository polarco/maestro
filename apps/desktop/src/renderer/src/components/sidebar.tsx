import {
  Activity,
  ChevronsUpDown,
  Clock3,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { BootstrapPayload, Conversation, Project, RunMode } from "@maestro/contracts";
import { MaestroMark } from "./logo";
import { cn, relativeTime } from "@renderer/lib/utils";
import { useAppStore, type AppView } from "@renderer/store/app-store";

const modeDot: Record<RunMode, string> = {
  maestro: "bg-primary",
  agent: "bg-info",
  chat: "bg-success",
};

interface SidebarProps {
  bootstrap: BootstrapPayload;
  activeProject: Project;
  collapsed: boolean;
  onCollapse: () => void;
  onOpenCommand: () => void;
  onProjectChange: (projectId: string) => void;
  onNewConversation: () => void;
}

function NavButton({
  view,
  icon,
  label,
  badge,
  collapsed,
}: {
  view: AppView;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  collapsed: boolean;
}) {
  const current = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const active = current.type === view.type;
  return (
    <button
      className={cn(
        "sidebar-nav",
        collapsed && "justify-center px-0",
        active && "sidebar-nav-active",
      )}
      onClick={() => setView(view)}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <span className="relative shrink-0">
        {icon}
        {collapsed && badge !== undefined && badge > 0 ? (
          <span className="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full border-2 border-sidebar bg-primary text-[8px] font-bold text-primary-foreground">
            {Math.min(badge, 9)}
          </span>
        ) : null}
      </span>
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {!collapsed && badge !== undefined && badge > 0 ? (
        <span className="ml-auto rounded-full bg-surface-hover px-2 py-0.5 text-[10px] tabular-nums text-text-muted">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const current = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const active = current.type === "conversation" && current.id === conversation.id;
  return (
    <button
      className={cn(
        "group flex min-h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-surface-hover",
        active && "bg-surface-hover text-text",
      )}
      onClick={() => setView({ type: "conversation", id: conversation.id })}
      aria-current={active ? "page" : undefined}
      title={conversation.title}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", modeDot[conversation.mode])} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted group-hover:text-text">
        {conversation.title}
      </span>
      <span className="hidden shrink-0 text-[9px] text-text-faint group-hover:block">
        {relativeTime(conversation.updatedAt)}
      </span>
    </button>
  );
}

export function Sidebar({
  bootstrap,
  activeProject,
  collapsed,
  onCollapse,
  onOpenCommand,
  onProjectChange,
  onNewConversation,
}: SidebarProps) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘ N" : "Ctrl N";
  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-[244px]",
      )}
      aria-label="Barra lateral"
    >
      <div className={cn("flex h-[64px] items-center gap-2.5 px-3", collapsed && "justify-center")}>
        <MaestroMark className="size-8 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold tracking-[-0.025em] text-text">maestro</div>
            <div className="text-[10px] text-text-faint">workspace local</div>
          </div>
        ) : null}
        <button
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[8px] text-text-faint hover:bg-surface-hover hover:text-text",
            collapsed && "absolute -right-4 top-4 z-10 border border-border bg-sidebar shadow-lg",
          )}
          onClick={onCollapse}
          aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          title={collapsed ? "Expandir barra lateral (Ctrl+B)" : "Recolher barra lateral (Ctrl+B)"}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      <div className="px-3 pb-3">
        {collapsed ? (
          <button
            className="grid h-10 w-full place-items-center rounded-[10px] border border-border bg-bg-elevated text-[12px] font-semibold text-primary-soft hover:border-border-strong hover:bg-surface-hover"
            onClick={onCollapse}
            title={`${activeProject.name} · clique para trocar de projeto`}
            aria-label={`Projeto ativo: ${activeProject.name}`}
          >
            {activeProject.name.slice(0, 1).toUpperCase()}
          </button>
        ) : (
          <div className="relative">
            <select
              aria-label="Projeto ativo"
              className="h-10 w-full appearance-none rounded-[10px] border border-border bg-bg-elevated px-3 pr-8 text-[12px] font-semibold text-text outline-none transition-colors hover:border-border-strong focus:border-primary/60"
              value={activeProject.id}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              {bootstrap.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              className="pointer-events-none absolute right-2.5 top-3 text-text-faint"
              size={14}
            />
          </div>
        )}
      </div>

      <nav className="space-y-1 px-3" aria-label="Navegação principal">
        <button
          className={cn("sidebar-nav", collapsed && "justify-center px-0")}
          onClick={onOpenCommand}
          aria-label={collapsed ? "Buscar ou navegar" : undefined}
          title={collapsed ? "Buscar ou navegar (Ctrl+K)" : undefined}
        >
          <Search size={16} />
          {!collapsed ? (
            <>
              <span>Buscar</span>
              <kbd className="ml-auto text-[9px] text-text-faint">Ctrl K</kbd>
            </>
          ) : null}
        </button>
        <NavButton
          view={{ type: "dashboard" }}
          icon={<LayoutDashboard size={16} />}
          label="Visão geral"
          badge={bootstrap.activeRuns.length}
          collapsed={collapsed}
        />
        <button
          className={cn("sidebar-nav", collapsed && "justify-center px-0")}
          onClick={onNewConversation}
          aria-label={collapsed ? "Nova conversa" : undefined}
          title={collapsed ? `Nova conversa (${shortcut})` : undefined}
        >
          <Plus size={16} />
          {!collapsed ? (
            <>
              <span>Nova conversa</span>
              <kbd className="ml-auto text-[9px] text-text-faint">{shortcut}</kbd>
            </>
          ) : null}
        </button>
      </nav>

      {!collapsed ? (
        <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
          <div className="mb-1 flex items-center px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-faint">
            Recentes
            <Clock3 className="ml-auto" size={12} />
          </div>
          <div className="space-y-0.5 overflow-y-auto py-1">
            {bootstrap.recentConversations.length > 0 ? (
              bootstrap.recentConversations
                .slice(0, 7)
                .map((conversation) => (
                  <ConversationRow key={conversation.id} conversation={conversation} />
                ))
            ) : (
              <div className="rounded-[10px] border border-dashed border-border px-3 py-5 text-center text-[11px] leading-4 text-text-faint">
                Suas conversas recentes aparecerão aqui.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-t border-border p-3">
        <nav className="space-y-1" aria-label="Ferramentas">
          <NavButton
            view={{ type: "terminal" }}
            icon={<SquareTerminal size={16} />}
            label="Terminal"
            collapsed={collapsed}
          />
          <NavButton
            view={{ type: "history" }}
            icon={<MessageSquare size={16} />}
            label="Histórico"
            collapsed={collapsed}
          />
          <NavButton
            view={{ type: "settings" }}
            icon={<Settings size={16} />}
            label="Configurações"
            collapsed={collapsed}
          />
        </nav>
        {!collapsed ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-border/80 bg-bg-elevated px-3 py-2.5">
            <Activity size={14} className="text-success" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-text">Local e protegido</div>
              <div className="truncate text-[9px] text-text-faint">Dados neste dispositivo</div>
            </div>
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_8px_rgb(105_201_167/0.5)]" />
          </div>
        ) : (
          <div className="mt-3 flex justify-center" title="Dados neste dispositivo">
            <span className="size-2 rounded-full bg-success shadow-[0_0_9px_rgb(105_201_167/0.6)]" />
          </div>
        )}
      </div>
    </aside>
  );
}
