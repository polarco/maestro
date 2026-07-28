import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BootstrapPayload, ProviderSummary, RunMode } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { useLiveEvents } from "@renderer/hooks/use-live-events";
import { useAppStore } from "@renderer/store/app-store";
import { Sidebar } from "@renderer/components/sidebar";
import { Titlebar } from "@renderer/components/titlebar";
import { CommandPalette } from "@renderer/components/command-palette";
import { UpdateBanner } from "@renderer/components/update-banner";
import { ActionToast, ErrorPane } from "@renderer/components/ui/feedback";
import { LoadingPane } from "@renderer/components/ui/skeleton";
import { Dashboard } from "@renderer/pages/dashboard";
import { ConversationPage } from "@renderer/pages/conversation";
import { HistoryPage } from "@renderer/pages/history";
import { Onboarding } from "@renderer/pages/onboarding";
import { RunPage } from "@renderer/pages/run";
import { SettingsPage } from "@renderer/pages/settings";
import { TerminalPage } from "@renderer/pages/terminal";

function usable(provider: ProviderSummary, mode: RunMode): boolean {
  if (provider.health.status !== "ready") return false;
  if (mode === "chat" || mode === "agent")
    return provider.descriptor.kind === "cli" && provider.descriptor.supportsStructuredSessions;
  return (
    provider.descriptor.supportsStructuredSessions ||
    provider.models.some((model) => model.capabilities.structuredOutput)
  );
}

function preferredProvider(
  bootstrap: BootstrapPayload,
  mode: RunMode,
): ProviderSummary | undefined {
  const role = mode === "maestro" ? "planner" : mode === "agent" ? "implementer" : "chat";
  const preferred = bootstrap.settings.defaultModels[role];
  return (
    bootstrap.providers.find(
      (provider) => provider.descriptor.id === preferred?.providerId && usable(provider, mode),
    ) ?? bootstrap.providers.find((provider) => usable(provider, mode))
  );
}

export default function App() {
  useLiveEvents();
  const queryClient = useQueryClient();
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const [commandOpen, setCommandOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("maestro.sidebar-collapsed") === "true",
  );
  const query = useQuery({ queryKey: ["bootstrap"], queryFn: () => api().bootstrap() });
  const setBootstrap = useCallback(
    (value: BootstrapPayload) => {
      queryClient.setQueryData(["bootstrap"], value);
    },
    [queryClient],
  );
  const refresh = useCallback(async () => {
    const value = await api().bootstrap();
    setBootstrap(value);
  }, [setBootstrap]);
  const newConversation = useCallback(async () => {
    setActionError(null);
    try {
      const bootstrap = queryClient.getQueryData<BootstrapPayload>(["bootstrap"]);
      if (!bootstrap) throw new Error("Os dados do aplicativo ainda não foram carregados.");
      const project =
        bootstrap.projects.find((item) => item.id === bootstrap.activeProjectId) ??
        bootstrap.projects[0];
      const root = project?.roots[0];
      if (!project || !root)
        throw new Error("Adicione uma pasta autorizada ao projeto antes de iniciar uma conversa.");
      const mode = bootstrap.settings.defaultMode;
      const provider = preferredProvider(bootstrap, mode);
      const requested =
        bootstrap.settings.defaultModels[
          mode === "maestro" ? "planner" : mode === "agent" ? "implementer" : "chat"
        ];
      const model =
        provider?.models.find((item) => item.id === requested?.modelId) ??
        provider?.models.find((item) => item.isDefault) ??
        provider?.models[0];
      const connectionId =
        provider?.descriptor.kind === "cli"
          ? (requested?.connectionId ??
            bootstrap.providerConnections.find(
              (item) =>
                item.connection.providerId === provider.descriptor.id &&
                item.connection.enabled &&
                item.health.status === "ready",
            )?.connection.id)
          : undefined;
      const conversation = await api().createConversation({
        projectId: project.id,
        mode,
        sessionKind: "structured",
        workspaceRootId: root.id,
        ...(provider ? { providerId: provider.descriptor.id } : {}),
        ...(connectionId ? { providerConnectionId: connectionId } : {}),
        ...(model ? { modelId: model.id } : {}),
      });
      setView({ type: "conversation", id: conversation.id });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [queryClient, refresh, setView]);

  useEffect(() => {
    window.localStorage.setItem("maestro.sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    return api().onUpdateState((update) => {
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current ? { ...current, update } : current,
      );
    });
  }, [queryClient]);

  useEffect(() => {
    const bootstrap = query.data;
    if (!bootstrap) return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      root.dataset.theme =
        bootstrap.settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : bootstrap.settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [query.data?.settings.theme]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setCommandOpen(true);
      } else if (key === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
      } else if (key === "n") {
        event.preventDefault();
        void newConversation();
      } else if (event.key === ",") {
        event.preventDefault();
        setView({ type: "settings" });
      } else if (event.key === "1") {
        event.preventDefault();
        setView({ type: "dashboard" });
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [newConversation, setView]);

  if (query.isError)
    return (
      <div className="app-canvas flex h-screen flex-col">
        <Titlebar />
        <ErrorPane error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  if (query.isLoading || !query.data)
    return (
      <div className="app-canvas flex h-screen flex-col">
        <Titlebar />
        <LoadingPane />
      </div>
    );
  const bootstrap = query.data;
  if (bootstrap.projects.length === 0)
    return (
      <div className="app-canvas flex h-screen flex-col">
        <Titlebar />
        <Onboarding onCreated={() => void refresh()} />
      </div>
    );
  const project =
    bootstrap.projects.find((item) => item.id === bootstrap.activeProjectId) ??
    bootstrap.projects[0]!;

  const changeProject = async (projectId: string) => {
    setActionError(null);
    try {
      const value = await api().selectProject(projectId);
      setBootstrap(value);
      setView({ type: "dashboard" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  let content: React.ReactNode;
  switch (view.type) {
    case "conversation":
      content = <ConversationPage id={view.id} bootstrap={bootstrap} project={project} />;
      break;
    case "run":
      content = <RunPage id={view.id} bootstrap={bootstrap} />;
      break;
    case "terminal":
      content = <TerminalPage key={project.id} project={project} />;
      break;
    case "history":
      content = <HistoryPage project={project} />;
      break;
    case "settings":
      content = <SettingsPage bootstrap={bootstrap} project={project} onBootstrap={setBootstrap} />;
      break;
    default:
      content = (
        <Dashboard
          bootstrap={bootstrap}
          project={project}
          onNewConversation={() => void newConversation()}
        />
      );
  }

  return (
    <div className="app-canvas flex h-screen flex-col text-text">
      <Titlebar context={project.name} onOpenCommand={() => setCommandOpen(true)} />
      <UpdateBanner state={bootstrap.update} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          bootstrap={bootstrap}
          activeProject={project}
          collapsed={sidebarCollapsed}
          onCollapse={() => setSidebarCollapsed((value) => !value)}
          onOpenCommand={() => setCommandOpen(true)}
          onProjectChange={(id) => void changeProject(id)}
          onNewConversation={() => void newConversation()}
        />
        <main className="min-w-0 flex-1 bg-bg/40">{content}</main>
      </div>
      <CommandPalette
        open={commandOpen}
        bootstrap={bootstrap}
        onClose={() => setCommandOpen(false)}
        onNewConversation={() => void newConversation()}
      />
      {actionError ? (
        <ActionToast message={actionError} onClose={() => setActionError(null)} />
      ) : null}
    </div>
  );
}
