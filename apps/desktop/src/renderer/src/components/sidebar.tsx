import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Check,
  Clock3,
  Ellipsis,
  Folder,
  FolderCog,
  FolderMinus,
  FolderPlus,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type {
  BootstrapPayload,
  Conversation,
  ConversationDetail,
  Project,
  RunMode,
  WorkspaceRoot,
} from "@maestro/contracts";
import { MaestroMark } from "./logo";
import { cn, compactPath, relativeTime } from "@renderer/lib/utils";
import { api } from "@renderer/lib/api";
import { useAppStore, type AppView } from "@renderer/store/app-store";
import {
  ActionContextMenu,
  ActionDropdown,
  type ActionMenuItem,
} from "@renderer/components/ui/action-menu";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/form";
import { ConfirmDialog, Modal } from "@renderer/components/ui/modal";

const modeDot: Record<RunMode, string> = {
  maestro: "bg-primary",
  agent: "bg-primary",
  chat: "bg-primary",
};

interface SidebarProps {
  bootstrap: BootstrapPayload;
  activeProject: Project;
  collapsed: boolean;
  onCollapse: () => void;
  onOpenCommand: () => void;
  onProjectChange: (projectId: string) => void;
  onNewConversation: () => void;
  onBootstrap: (value: BootstrapPayload) => void;
  onError: (message: string | null) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function directoryName(directory: string): string {
  return (
    directory
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? directory
  );
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

function ConversationRow({
  conversation,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  onRename: () => void;
  onDelete: () => void;
}) {
  const current = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const active = current.type === "conversation" && current.id === conversation.id;
  const open = () => setView({ type: "conversation", id: conversation.id });
  const items: ActionMenuItem[] = [
    { id: "open", label: "Abrir conversa", icon: ArrowUpRight, onSelect: open },
    { id: "rename", label: "Renomear", icon: Pencil, onSelect: onRename },
    {
      id: "delete",
      label: "Excluir conversa",
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      onSelect: onDelete,
    },
  ];
  return (
    <ActionContextMenu items={items} label={`Ações para ${conversation.title}`}>
      <div
        className={cn(
          "group relative flex min-h-9 w-full items-center rounded-[9px] transition-colors hover:bg-surface-hover",
          active && "bg-surface-hover text-text",
        )}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 pr-8 text-left"
          onClick={open}
          aria-current={active ? "page" : undefined}
          title={conversation.title}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", modeDot[conversation.mode])} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted group-hover:text-text">
            {conversation.title}
          </span>
          <span className="shrink-0 text-[9px] text-text-faint group-hover:hidden">
            {relativeTime(conversation.updatedAt)}
          </span>
        </button>
        <ActionDropdown
          items={items}
          label={`Ações para ${conversation.title}`}
          align="end"
          trigger={
            <button
              type="button"
              className="absolute right-1 grid size-7 place-items-center rounded-[7px] text-text-faint opacity-0 transition-opacity hover:bg-bg-elevated hover:text-text focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:bg-bg-elevated data-[state=open]:opacity-100"
              aria-label={`Mais ações para ${conversation.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Ellipsis size={14} />
            </button>
          }
        />
      </div>
    </ActionContextMenu>
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
  onBootstrap,
  onError,
}: SidebarProps) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘ N" : "Ctrl N";
  const queryClient = useQueryClient();
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [renamedProject, setRenamedProject] = useState(activeProject.name);
  const [rootsOpen, setRootsOpen] = useState(false);
  const [rootToRemove, setRootToRemove] = useState<WorkspaceRoot | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [conversationToRename, setConversationToRename] = useState<Conversation | null>(null);
  const [conversationTitle, setConversationTitle] = useState("");
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);

  const perform = async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    onError(null);
    try {
      return await action();
    } catch (error) {
      onError(errorMessage(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => onBootstrap(await api().bootstrap());
  const openCreate = () => {
    setProjectName("");
    setProjectDirectory("");
    setCreateOpen(true);
  };
  const openRenameProject = () => {
    setRenamedProject(activeProject.name);
    setRenameProjectOpen(true);
  };
  const chooseProjectDirectory = async () => {
    await perform(async () => {
      const directory = await api().selectDirectory();
      if (!directory) return;
      setProjectDirectory(directory);
      setProjectName((current) => current || directoryName(directory));
    });
  };
  const createProject = async () => {
    if (!projectName.trim() || !projectDirectory) return;
    await perform(async () => {
      const project = await api().createProject({
        name: projectName.trim(),
        directory: projectDirectory,
      });
      onBootstrap(await api().selectProject(project.id));
      setView({ type: "dashboard" });
      setCreateOpen(false);
    });
  };
  const renameProject = async () => {
    const name = renamedProject.trim();
    if (!name || name === activeProject.name) {
      setRenameProjectOpen(false);
      return;
    }
    await perform(async () => {
      await api().updateProject({ projectId: activeProject.id, name });
      await reload();
      setRenameProjectOpen(false);
    });
  };
  const addRoot = async () => {
    await perform(async () => {
      const directory = await api().selectDirectory();
      if (!directory) return;
      await api().addProjectRoot(activeProject.id, directory);
      await reload();
    });
  };
  const removeRoot = async () => {
    if (!rootToRemove) return;
    await perform(async () => {
      await api().removeProjectRoot(activeProject.id, rootToRemove.id);
      await reload();
      setRootToRemove(null);
    });
  };
  const deleteProject = async () => {
    await perform(async () => {
      const next = await api().deleteProject(activeProject.id);
      onBootstrap(next);
      setView({ type: "dashboard" });
    });
  };
  const renameConversation = async () => {
    if (!conversationToRename) return;
    const title = conversationTitle.trim();
    if (!title || title === conversationToRename.title) {
      setConversationToRename(null);
      return;
    }
    await perform(async () => {
      const updated = await api().updateConversation({
        conversationId: conversationToRename.id,
        title,
      });
      queryClient.setQueryData<ConversationDetail>(
        ["conversation", conversationToRename.id],
        (current) => (current ? { ...current, conversation: updated } : current),
      );
      await reload();
      setConversationToRename(null);
    });
  };
  const deleteConversation = async () => {
    if (!conversationToDelete) return;
    const id = conversationToDelete.id;
    await perform(async () => {
      await api().deleteConversation(id);
      queryClient.removeQueries({ queryKey: ["conversation", id], exact: true });
      if (view.type === "conversation" && view.id === id) setView({ type: "dashboard" });
      await reload();
      setConversationToDelete(null);
    });
  };

  const switchItems: ActionMenuItem[] = [
    ...bootstrap.projects.map((project) => ({
      id: `project-${project.id}`,
      label: project.name,
      icon: project.id === activeProject.id ? Check : Folder,
      onSelect: () => {
        if (project.id !== activeProject.id) onProjectChange(project.id);
      },
    })),
    {
      id: "new-project",
      label: "Novo projeto…",
      icon: FolderPlus,
      separatorBefore: true,
      onSelect: openCreate,
    },
  ];
  const projectItems: ActionMenuItem[] = [
    { id: "rename-project", label: "Renomear projeto…", icon: Pencil, onSelect: openRenameProject },
    { id: "add-root", label: "Adicionar pasta…", icon: FolderPlus, onSelect: addRoot },
    {
      id: "manage-roots",
      label: "Gerenciar pastas…",
      icon: FolderCog,
      onSelect: () => setRootsOpen(true),
    },
    {
      id: "delete-project",
      label: "Excluir projeto…",
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      onSelect: () => setDeleteProjectOpen(true),
    },
  ];

  const projectSwitcher = collapsed ? (
    <ActionDropdown
      items={switchItems}
      label="Trocar ou criar projeto"
      trigger={
        <button
          className="grid h-10 w-full place-items-center rounded-[10px] border border-border bg-bg-elevated text-[12px] font-semibold text-primary-soft hover:border-border-strong hover:bg-surface-hover"
          title={`${activeProject.name} · clique para trocar de projeto`}
          aria-label={`Projeto ativo: ${activeProject.name}. Trocar projeto`}
        >
          {activeProject.name.slice(0, 1).toUpperCase()}
        </button>
      }
    />
  ) : (
    <div className="flex h-10 items-center rounded-[10px] border border-border bg-bg-elevated transition-colors hover:border-border-strong">
      <ActionDropdown
        items={switchItems}
        label="Trocar ou criar projeto"
        trigger={
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
            aria-label={`Projeto ativo: ${activeProject.name}. Trocar projeto`}
          >
            <Folder size={14} className="shrink-0 text-primary-soft" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text">
              {activeProject.name}
            </span>
          </button>
        }
      />
      <ActionDropdown
        items={projectItems}
        label={`Ações do projeto ${activeProject.name}`}
        align="end"
        trigger={
          <button
            type="button"
            className="mr-1 grid size-7 shrink-0 place-items-center rounded-[7px] text-text-faint hover:bg-surface-hover hover:text-text data-[state=open]:bg-surface-hover data-[state=open]:text-text"
            aria-label={`Mais ações para o projeto ${activeProject.name}`}
          >
            <Ellipsis size={14} />
          </button>
        }
      />
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "relative flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[72px]" : "w-[244px]",
        )}
        aria-label="Barra lateral"
      >
        <div
          className={cn("flex h-[64px] items-center gap-2.5 px-3", collapsed && "justify-center")}
        >
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
            title={
              collapsed ? "Expandir barra lateral (Ctrl+B)" : "Recolher barra lateral (Ctrl+B)"
            }
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        <div className="px-3 pb-3">
          <ActionContextMenu items={projectItems} label={`Ações do projeto ${activeProject.name}`}>
            <div>{projectSwitcher}</div>
          </ActionContextMenu>
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
          <NavButton
            view={{ type: "mission-control" }}
            icon={<Activity size={16} />}
            label="Mission Control"
            badge={bootstrap.activeJobs?.length ?? bootstrap.activeRuns.length}
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
                bootstrap.recentConversations.slice(0, 7).map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    onRename={() => {
                      setConversationTitle(conversation.title);
                      setConversationToRename(conversation);
                    }}
                    onDelete={() => setConversationToDelete(conversation)}
                  />
                ))
              ) : (
                <div className="rounded-[10px] border border-dashed border-border px-3 py-5 text-center text-[11px] leading-4 text-text-faint">
                  Suas conversas recentes aparecerão aqui depois da primeira mensagem.
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

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Novo projeto"
        description="Escolha a pasta principal e dê um nome ao projeto. Nada será movido ou copiado."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              disabled={busy || !projectName.trim() || !projectDirectory}
              onClick={() => void createProject().catch(() => {})}
            >
              <FolderPlus size={13} /> {busy ? "Criando…" : "Criar projeto"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="sidebar-project-name"
              className="mb-2 block text-[12px] font-semibold text-text-muted"
            >
              Nome do projeto
            </label>
            <Input
              id="sidebar-project-name"
              value={projectName}
              maxLength={120}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Meu projeto"
              onKeyDown={(event) => {
                if (event.key === "Enter" && projectName.trim() && projectDirectory)
                  void createProject().catch(() => {});
              }}
            />
          </div>
          <div>
            <span className="mb-2 block text-[12px] font-semibold text-text-muted">
              Pasta principal
            </span>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-3 rounded-[10px] border border-border bg-bg-elevated px-3 text-left hover:border-border-strong hover:bg-surface-hover"
              onClick={() => void chooseProjectDirectory().catch(() => {})}
            >
              <Folder size={15} className="shrink-0 text-primary-soft" />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[11px]",
                  projectDirectory ? "text-text" : "text-text-faint",
                )}
              >
                {projectDirectory || "Selecionar uma pasta…"}
              </span>
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={renameProjectOpen}
        onOpenChange={setRenameProjectOpen}
        title="Renomear projeto"
        description="O nome muda somente no Maestro; a pasta no disco permanece igual."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameProjectOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              disabled={busy || !renamedProject.trim()}
              onClick={() => void renameProject().catch(() => {})}
            >
              {busy ? "Salvando…" : "Salvar nome"}
            </Button>
          </>
        }
      >
        <label
          htmlFor="sidebar-rename-project"
          className="mb-2 block text-[12px] font-semibold text-text-muted"
        >
          Nome do projeto
        </label>
        <Input
          id="sidebar-rename-project"
          value={renamedProject}
          maxLength={120}
          onChange={(event) => setRenamedProject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && renamedProject.trim())
              void renameProject().catch(() => {});
          }}
        />
      </Modal>

      <Modal
        open={rootsOpen}
        onOpenChange={setRootsOpen}
        title="Pastas autorizadas"
        description="O Maestro só lê ou altera pastas explicitamente incluídas neste projeto."
        width="max-w-[620px]"
        footer={
          <Button disabled={busy} onClick={() => void addRoot().catch(() => {})}>
            <FolderPlus size={13} /> {busy ? "Adicionando…" : "Adicionar pasta"}
          </Button>
        }
      >
        <div className="space-y-2">
          {activeProject.roots.map((root) => (
            <div
              key={root.id}
              className="flex items-center gap-3 rounded-[11px] border border-border bg-bg-elevated p-3"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-success/10 text-success">
                <Folder size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-text">
                  {root.displayName}
                </span>
                <span
                  className="mt-0.5 block truncate font-mono text-[9.5px] text-text-faint"
                  title={root.canonicalPath}
                >
                  {compactPath(root.canonicalPath, 86)}
                </span>
              </span>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-[8px] text-text-faint hover:bg-danger/10 hover:text-danger disabled:opacity-35"
                disabled={busy || activeProject.roots.length <= 1}
                onClick={() => setRootToRemove(root)}
                aria-label={`Remover pasta ${root.displayName}`}
                title={
                  activeProject.roots.length <= 1
                    ? "O projeto precisa manter pelo menos uma pasta"
                    : "Remover pasta do projeto"
                }
              >
                <FolderMinus size={14} />
              </button>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(conversationToRename)}
        onOpenChange={(open) => !open && setConversationToRename(null)}
        title="Renomear conversa"
        description="Use um título curto para encontrar esta conversa com facilidade."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConversationToRename(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              disabled={busy || !conversationTitle.trim()}
              onClick={() => void renameConversation().catch(() => {})}
            >
              {busy ? "Salvando…" : "Salvar título"}
            </Button>
          </>
        }
      >
        <label
          htmlFor="sidebar-conversation-title"
          className="mb-2 block text-[12px] font-semibold text-text-muted"
        >
          Título
        </label>
        <Input
          id="sidebar-conversation-title"
          value={conversationTitle}
          maxLength={200}
          onChange={(event) => setConversationTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && conversationTitle.trim())
              void renameConversation().catch(() => {});
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        title={`Excluir “${activeProject.name}”?`}
        description={
          <>
            O histórico, os planos e as configurações deste projeto serão excluídos permanentemente.
            As pastas e os arquivos no seu disco não serão apagados.
          </>
        }
        confirmLabel="Excluir projeto"
        onConfirm={deleteProject}
      />
      <ConfirmDialog
        open={Boolean(rootToRemove)}
        onOpenChange={(open) => !open && setRootToRemove(null)}
        title={`Remover “${rootToRemove?.displayName ?? "pasta"}”?`}
        description="A pasta e seus arquivos continuarão no disco. Ela apenas deixará de fazer parte do escopo autorizado deste projeto."
        confirmLabel="Remover pasta"
        onConfirm={removeRoot}
      />
      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        onOpenChange={(open) => !open && setConversationToDelete(null)}
        title={`Excluir “${conversationToDelete?.title ?? "conversa"}”?`}
        description="As mensagens, os planos e o histórico de execução desta conversa serão excluídos permanentemente."
        confirmLabel="Excluir conversa"
        onConfirm={deleteConversation}
      />
    </>
  );
}
