import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CircleUserRound,
  Cpu,
  Download,
  FolderOpen,
  FolderPlus,
  Gauge,
  GripVertical,
  HardDrive,
  KeyRound,
  Languages,
  Link2,
  ListOrdered,
  LockKeyhole,
  Palette,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type {
  AppSettings,
  BootstrapPayload,
  ModelSelection,
  Project,
  ProviderConfigField,
  ProviderConnectionSummary,
  ProviderSummary,
} from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn, compactPath, providerInitials } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input, Select } from "@renderer/components/ui/form";
import { Switch } from "@renderer/components/ui/switch";
import { ThemePicker } from "@renderer/components/ui/theme-switcher";
import { ProviderLoginTerminal } from "@renderer/components/provider-login-terminal";
import { applyTheme } from "@renderer/lib/theme";
import { InfoTooltip, TooltipProvider } from "@renderer/components/ui/tooltip";

type SettingsTab = "connections" | "general" | "project" | "diagnostics";

const healthLabels: Record<ProviderSummary["health"]["status"], string> = {
  ready: "Pronto",
  unavailable: "Indisponível",
  unauthenticated: "Não conectado",
  degraded: "Instável",
  checking: "Verificando",
};

const accountProviderDetails = {
  codex: { company: "OpenAI", product: "Codex", initials: "CX" },
  "claude-code": { company: "Anthropic", product: "Claude Code", initials: "CL" },
} as const;

export function SettingsPage({
  bootstrap,
  project,
  onBootstrap,
}: {
  bootstrap: BootstrapPayload;
  project: Project;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("connections");
  const [loginConnectionId, setLoginConnectionId] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => api().refreshProviders(),
    onSuccess: async () => onBootstrap(await api().bootstrap()),
  });
  const tabs = [
    {
      value: "connections",
      label: "Conexões",
      description: "Contas, APIs e prioridade",
      icon: ServerCog,
    },
    {
      value: "general",
      label: "Geral",
      description: "Aparência e comportamento",
      icon: SlidersHorizontal,
    },
    {
      value: "project",
      label: "Projeto",
      description: "Escopo e permissões",
      icon: FolderPlus,
    },
    {
      value: "diagnostics",
      label: "Diagnósticos",
      description: "Saúde do ambiente",
      icon: Activity,
    },
  ] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectTabWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    setTab(nextTab.value);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  return (
    <TooltipProvider delayDuration={320} skipDelayDuration={100}>
      <div className="settings-canvas settings-page page-enter flex h-full min-w-0 flex-col xl:flex-row">
        <aside className="relative z-10 w-full shrink-0 border-b border-border/80 bg-bg-elevated/55 px-3 py-3 xl:flex xl:w-[252px] xl:flex-col xl:border-b-0 xl:border-r xl:px-4 xl:py-5">
          <div className="mb-3 hidden items-center gap-3 px-2 xl:flex">
            <div className="grid size-10 place-items-center rounded-[13px] border border-primary/20 bg-primary/10 text-primary-soft shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <Settings2 size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary-soft">
                Preferências
              </p>
              <h1 className="mt-0.5 text-[16px] font-semibold tracking-[-0.02em]">Configurações</h1>
            </div>
          </div>
          <nav
            className="settings-nav-scroll flex flex-1 gap-1.5 overflow-x-auto xl:mt-6 xl:block xl:space-y-1.5"
            aria-label="Seções de configurações"
            role="tablist"
          >
            {tabs.map(({ value, label, description, icon: Icon }, index) => (
              <button
                key={value}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`settings-tab-${value}`}
                role="tab"
                type="button"
                aria-label={label}
                aria-controls={`settings-panel-${value}`}
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                className={cn(
                  "settings-nav-item group relative flex h-11 shrink-0 items-center gap-2.5 rounded-[12px] border px-3 text-left transition-all xl:h-auto xl:min-h-[58px] xl:w-full",
                  tab === value
                    ? "border-primary/20 bg-primary/[0.085] text-text shadow-[0_8px_22px_-18px_rgb(251_65_55/0.7)]"
                    : "border-transparent text-text-muted hover:border-border/70 hover:bg-surface-hover/70 hover:text-text",
                )}
                onClick={() => setTab(value)}
                onKeyDown={(event) => selectTabWithKeyboard(event, index)}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-[9px] transition-colors",
                    tab === value
                      ? "bg-primary/14 text-primary-soft"
                      : "bg-surface-raised/75 text-text-faint group-hover:text-text-muted",
                  )}
                >
                  <Icon size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold">{label}</span>
                  <span className="mt-0.5 hidden truncate text-[9.5px] font-normal text-text-faint xl:block">
                    {description}
                  </span>
                </span>
                {tab === value ? (
                  <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary xl:inset-y-2.5" />
                ) : null}
              </button>
            ))}
          </nav>
          <div className="mt-auto hidden px-2 pt-8 xl:block">
            <div className="rounded-[13px] border border-border/75 bg-surface/55 p-3">
              <div className="flex items-center gap-2 text-[10px] font-medium text-text-muted">
                <span className="size-1.5 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_12%,transparent)]" />
                Preferências locais
              </div>
              <p className="mt-1.5 font-mono text-[9px] text-text-faint">
                Maestro {bootstrap.app.version}
              </p>
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <main
            id={`settings-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            tabIndex={0}
            className="mx-auto max-w-[1120px] px-4 py-5 outline-none sm:px-5 md:px-7 md:py-7 xl:px-9 xl:py-9"
          >
            {tab === "connections" ? (
              <>
                <SettingsHeader
                  icon={ServerCog}
                  eyebrow="Contas e provedores"
                  title="Conexões"
                  description="Escolha quem coordena o Maestro e organize, em ordem, as contas usadas pelos agentes."
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate()}
                    >
                      <RefreshCcw className={refresh.isPending ? "animate-spin" : ""} size={12} />
                      Verificar
                    </Button>
                  }
                />
                {bootstrap.vault.backend === "password-vault" && bootstrap.vault.locked ? (
                  <VaultUnlock bootstrap={bootstrap} onBootstrap={onBootstrap} />
                ) : null}
                <MaestroAccount bootstrap={bootstrap} onBootstrap={onBootstrap} />
                <AgentAccounts
                  bootstrap={bootstrap}
                  onBootstrap={onBootstrap}
                  onLogin={setLoginConnectionId}
                />
                <div className="mt-7 flex flex-wrap items-end justify-between gap-3 px-0.5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-border bg-surface/70 text-text-muted">
                      <KeyRound size={14} />
                    </div>
                    <div>
                      <h3 className="text-[13px] font-semibold">Provedores e credenciais</h3>
                      <p className="mt-1 max-w-2xl text-[10px] leading-4 text-text-faint">
                        Ajustes avançados para APIs e executáveis. APIs pagas nunca são usadas nas
                        tarefas do DAG.
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] text-text-faint">
                    {bootstrap.providers.filter((provider) => provider.configured).length} de{" "}
                    {bootstrap.providers.length} configurados
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {bootstrap.providers.map((provider) => (
                    <ProviderCard
                      key={provider.descriptor.id}
                      provider={provider}
                      vaultLocked={bootstrap.vault.locked}
                      bootstrap={bootstrap}
                      onBootstrap={onBootstrap}
                    />
                  ))}
                  {bootstrap.providers.length === 0 ? (
                    <div className="settings-card p-6 text-center text-[10.5px] text-text-faint">
                      Nenhum provedor foi detectado neste ambiente.
                    </div>
                  ) : null}
                </div>
                {loginConnectionId ? (
                  <ProviderLoginTerminal
                    account={bootstrap.providerConnections.find(
                      (item) => item.connection.id === loginConnectionId,
                    )!}
                    onClose={() => setLoginConnectionId(null)}
                    onFinished={() => {
                      void api().bootstrap().then(onBootstrap);
                    }}
                  />
                ) : null}
              </>
            ) : tab === "general" ? (
              <GeneralSettings bootstrap={bootstrap} onBootstrap={onBootstrap} />
            ) : tab === "project" ? (
              <ProjectSettings project={project} onBootstrap={onBootstrap} />
            ) : (
              <Diagnostics
                bootstrap={bootstrap}
                refresh={() => refresh.mutate()}
                refreshing={refresh.isPending}
              />
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

interface MaestroTarget {
  key: string;
  providerId: string;
  connectionId: string | null;
  displayName: string;
  providerName: string;
  kind: "api" | "local" | "account";
  status: ProviderSummary["health"]["status"];
  message: string;
  models: Array<{ id: string; name: string; isDefault?: boolean }>;
}

function MaestroAccount({
  bootstrap,
  onBootstrap,
}: {
  bootstrap: BootstrapPayload;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const targets: MaestroTarget[] = [
    ...bootstrap.providers
      .filter((provider) => provider.descriptor.kind !== "cli")
      .map((provider) => ({
        key: `provider:${provider.descriptor.id}`,
        providerId: provider.descriptor.id,
        connectionId: null,
        displayName: provider.descriptor.name,
        providerName: provider.descriptor.name,
        kind: provider.descriptor.kind as "api" | "local",
        status: provider.health.status,
        message: provider.health.message,
        models: provider.models,
      })),
    ...bootstrap.providerConnections.map((account) => {
      const provider = bootstrap.providers.find(
        (item) => item.descriptor.id === account.connection.providerId,
      );
      const details = accountProviderDetails[account.connection.providerId];
      return {
        key: `connection:${account.connection.id}`,
        providerId: account.connection.providerId,
        connectionId: account.connection.id,
        displayName: account.connection.name,
        providerName: `${details.company} · ${details.product}`,
        kind: "account" as const,
        status: account.health.status,
        message: account.health.message,
        models: account.models.length > 0 ? account.models : (provider?.models ?? []),
      };
    }),
  ];
  const persistedSelection =
    bootstrap.settings.defaultModels.maestro ??
    bootstrap.settings.defaultModels.planner ??
    bootstrap.settings.defaultModels.analyst;
  const [selection, setSelection] = useState<ModelSelection | undefined>(persistedSelection);
  useEffect(() => setSelection(persistedSelection), [persistedSelection]);

  const selectedTarget =
    targets.find(
      (target) =>
        target.providerId === selection?.providerId &&
        target.connectionId === (selection.connectionId ?? null),
    ) ??
    targets.find(
      (target) => target.providerId === selection?.providerId && target.connectionId === null,
    ) ??
    targets.find(
      (target) => target.providerId === selection?.providerId && target.kind === "account",
    ) ??
    targets.find((target) => target.status === "ready") ??
    targets[0];
  const modelOptions = selectedTarget
    ? [
        ...(selection?.providerId === selectedTarget.providerId &&
        selection.modelId &&
        !selectedTarget.models.some((model) => model.id === selection.modelId)
          ? [{ id: selection.modelId, name: `${selection.modelId} (seleção atual)` }]
          : []),
        ...selectedTarget.models,
      ]
    : [];
  const reload = async () => onBootstrap(await api().bootstrap());
  const save = useMutation({
    mutationFn: (next: ModelSelection) =>
      api().updateSettings({
        defaultModels: { ...bootstrap.settings.defaultModels, maestro: next },
      }),
    onSuccess: reload,
    onError: () => setSelection(persistedSelection),
  });
  const persist = (next: ModelSelection) => {
    setSelection(next);
    save.mutate(next);
  };
  const statusTone =
    selectedTarget?.status === "ready"
      ? "success"
      : selectedTarget?.status === "unauthenticated"
        ? "warning"
        : "danger";

  return (
    <section className="settings-card settings-feature-card mt-6 overflow-hidden border-primary/25">
      <div className="grid lg:grid-cols-[minmax(220px,.7fr)_minmax(0,1.5fr)]">
        <div className="relative overflow-hidden border-b border-primary/15 bg-primary/[0.045] p-5 lg:border-r lg:border-b-0 md:p-6">
          <div className="pointer-events-none absolute -right-14 -top-16 size-44 rounded-full border border-primary/10 bg-primary/[0.035]" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div className="grid size-11 place-items-center rounded-[14px] border border-primary/20 bg-primary/10 text-primary-soft shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                <Bot size={20} />
              </div>
              <span className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.14em] text-primary-soft">
                01 · coordenação
              </span>
            </div>
            <div className="mt-5 flex items-start gap-1">
              <h3 className="text-[16px] font-semibold leading-6 tracking-[-0.02em]">
                Conta/API principal do Maestro
              </h3>
              <InfoTooltip
                content="Esta escolha é usada pelo Maestro para analisar pedidos e montar ou revisar planos. As tarefas criadas por ele continuam usando a fila de contas abaixo."
                label="Ajuda sobre a conta principal do Maestro"
              />
            </div>
            <p className="mt-2 max-w-sm text-[10.5px] leading-[1.65] text-text-muted">
              A identidade que interpreta pedidos, planeja e coordena. A execução continua usando a
              fila de contas abaixo.
            </p>
            <div className="mt-5 rounded-[13px] border border-border/80 bg-bg/30 p-3.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-text-faint">
                Seleção atual
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="truncate text-[11.5px] font-semibold text-text">
                  {selectedTarget?.providerName ?? "Nenhum provedor"}
                </span>
                {selectedTarget ? (
                  <Badge tone={statusTone}>{healthLabels[selectedTarget.status]}</Badge>
                ) : null}
              </div>
              {selectedTarget?.kind === "account" ? (
                <p className="mt-1 text-[9.5px] font-medium text-primary-soft">
                  Perfil “{selectedTarget.displayName}”
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="p-5 md:p-6">
          <div className="mb-5">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-primary-soft" />
              <p className="text-[11px] font-semibold text-text">Defina a mente do Maestro</p>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-text-faint">
              A escolha é salva automaticamente e não altera a prioridade dos agentes.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <SettingLabel
                htmlFor="maestro-primary-account"
                help="Define o provedor e, no caso de uma assinatura, o perfil isolado usado nas etapas de análise e planejamento do Maestro."
              >
                Conta ou API
              </SettingLabel>
              <Select
                id="maestro-primary-account"
                className="w-full min-w-0"
                value={selectedTarget?.key ?? ""}
                disabled={targets.length === 0 || save.isPending}
                onChange={(event) => {
                  const target = targets.find((item) => item.key === event.target.value);
                  if (!target) return;
                  const modelId =
                    target.models.find((model) => model.isDefault)?.id ??
                    target.models[0]?.id ??
                    (selection?.providerId === target.providerId ? selection.modelId : "default");
                  persist({
                    providerId: target.providerId,
                    ...(target.connectionId ? { connectionId: target.connectionId } : {}),
                    modelId,
                    effort: selection?.effort ?? "high",
                  });
                }}
              >
                {targets.filter((target) => target.kind !== "account").length > 0 ? (
                  <optgroup label="APIs e provedores locais">
                    {targets
                      .filter((target) => target.kind !== "account")
                      .map((target) => (
                        <option key={target.key} value={target.key}>
                          {target.kind === "local" ? "Local" : "API"} · {target.providerName} ·{" "}
                          {healthLabels[target.status]}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {targets.some((target) => target.kind === "account") ? (
                  <optgroup label="Contas por assinatura">
                    {targets
                      .filter((target) => target.kind === "account")
                      .map((target) => (
                        <option key={target.key} value={target.key}>
                          {target.providerName} · {target.displayName}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </Select>
            </div>
            <div className="min-w-0">
              <SettingLabel
                htmlFor="maestro-primary-model"
                help="Modelo usado pelo Maestro para estruturar a análise e gerar o plano antes da execução pelos agentes."
              >
                Modelo do Maestro
              </SettingLabel>
              <Select
                id="maestro-primary-model"
                className="w-full min-w-0"
                value={selection?.modelId ?? modelOptions[0]?.id ?? ""}
                disabled={!selectedTarget || modelOptions.length === 0 || save.isPending}
                onChange={(event) => {
                  if (!selectedTarget) return;
                  persist({
                    providerId: selectedTarget.providerId,
                    ...(selectedTarget.connectionId
                      ? { connectionId: selectedTarget.connectionId }
                      : {}),
                    modelId: event.target.value,
                    effort: selection?.effort ?? "high",
                  });
                }}
              >
                {modelOptions.length > 0 ? (
                  modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))
                ) : (
                  <option value="">Conecte ou configure o provedor</option>
                )}
              </Select>
            </div>
          </div>
          <div
            className={cn(
              "mt-5 flex items-start gap-3 rounded-[13px] border p-3.5",
              selectedTarget?.status === "ready"
                ? "border-success/18 bg-success/[0.045]"
                : "border-warning/20 bg-warning/[0.04]",
            )}
          >
            <span
              className={cn(
                "mt-1 size-1.5 shrink-0 rounded-full",
                selectedTarget?.status === "ready" ? "bg-success" : "bg-warning",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] leading-4 text-text-muted">
                {selectedTarget?.message ?? "Configure ao menos um provedor para continuar."}
              </p>
              {save.isPending ? (
                <p className="mt-1 text-[9.5px] font-medium text-info">Salvando escolha…</p>
              ) : (
                <p className="mt-1 text-[9px] text-text-faint">
                  Alterações salvas automaticamente.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {save.error ? (
        <p className="border-t border-danger/20 bg-danger/[0.04] px-5 py-2 text-[10px] text-danger">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
    </section>
  );
}

function AgentAccounts({
  bootstrap,
  onBootstrap,
  onLogin,
}: {
  bootstrap: BootstrapPayload;
  onBootstrap: (value: BootstrapPayload) => void;
  onLogin: (connectionId: string) => void;
}) {
  const [providerId, setProviderId] = useState<"codex" | "claude-code">("claude-code");
  const [name, setName] = useState("");
  const [orderedAccounts, setOrderedAccounts] = useState(bootstrap.providerConnections);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  useEffect(
    () => setOrderedAccounts(bootstrap.providerConnections),
    [bootstrap.providerConnections],
  );
  const reload = async () => onBootstrap(await api().bootstrap());
  const create = useMutation({
    mutationFn: () =>
      api().createProviderConnection({
        providerId,
        name: name.trim(),
        concurrencyLimit: 1,
      }),
    onSuccess: async () => {
      setName("");
      await reload();
    },
  });
  const update = useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof api>["updateProviderConnection"]>[0]) =>
      api().updateProviderConnection(input),
    onSuccess: reload,
    onError: reload,
  });
  const remove = useMutation({
    mutationFn: (connectionId: string) => api().deleteProviderConnection(connectionId),
    onSuccess: reload,
  });
  const reorder = useMutation({
    mutationFn: (connectionIds: string[]) => api().reorderProviderConnections(connectionIds),
    onSuccess: reload,
    onError: () => setOrderedAccounts(bootstrap.providerConnections),
  });
  const moveAccount = (connectionId: string, targetIndex: number) => {
    const sourceIndex = orderedAccounts.findIndex(
      (account) => account.connection.id === connectionId,
    );
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...orderedAccounts];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, moved);
    setOrderedAccounts(next);
    reorder.mutate(next.map((account) => account.connection.id));
  };
  const maestroSelection =
    bootstrap.settings.defaultModels.maestro ?? bootstrap.settings.defaultModels.planner;
  const maestroConnectionId =
    maestroSelection?.connectionId ??
    orderedAccounts.find(
      (account) => account.connection.providerId === maestroSelection?.providerId,
    )?.connection.id;
  const busy = update.isPending || remove.isPending || reorder.isPending;

  return (
    <section className="settings-card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/75 px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-border bg-bg-elevated/80 text-primary-soft">
            <ListOrdered size={15} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold">Contas dos agentes</h3>
              <InfoTooltip
                content="Os agentes usam a primeira conta compatível e disponível. Quando ela atinge o limite de sessões, o Maestro tenta a próxima conta do mesmo provedor na ordem."
                label="Ajuda sobre as contas dos agentes"
              />
              <Badge tone="primary">ordem = prioridade</Badge>
            </div>
            <p className="mt-1 text-[10px] text-text-faint">
              Arraste pelo marcador à esquerda. A conta no topo tem prioridade mais alta.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-bg-elevated/65 px-2.5 py-1.5 text-[9px] font-medium text-text-muted">
          <span className="size-1.5 rounded-full bg-success" />
          {orderedAccounts.filter((account) => account.connection.enabled).length} ativas
        </div>
      </div>
      <div className="space-y-2 bg-bg/20 p-3 md:p-4">
        {orderedAccounts.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-[14px] border border-dashed border-border p-6 text-center">
            <div>
              <CircleUserRound className="mx-auto text-text-faint" size={22} />
              <p className="mt-2 text-[11.5px] font-semibold">Nenhuma conta na fila</p>
              <p className="mt-1 text-[10px] text-text-faint">
                Adicione uma conta abaixo para começar a distribuir tarefas.
              </p>
            </div>
          </div>
        ) : null}
        {orderedAccounts.map((account, index) => {
          const connectionId = account.connection.id;
          return (
            <div
              key={connectionId}
              className={cn(
                "rounded-[14px] border bg-surface/75 transition-[border-color,background-color,box-shadow]",
                dragOverId === connectionId && draggingId !== connectionId
                  ? "border-primary/40 bg-primary/[0.055] shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary)_8%,transparent)]"
                  : "border-border/80 hover:border-border-strong hover:bg-surface",
                draggingId === connectionId && "opacity-55",
              )}
              onDragOver={(event) => {
                if (draggingId === connectionId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverId(connectionId);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDragOverId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId =
                  draggingIdRef.current ?? draggingId ?? event.dataTransfer.getData("text/plain");
                draggingIdRef.current = null;
                setDraggingId(null);
                setDragOverId(null);
                if (sourceId) moveAccount(sourceId, index);
              }}
            >
              <AgentAccountRow
                account={account}
                rank={index + 1}
                total={orderedAccounts.length}
                isMaestro={maestroConnectionId === connectionId}
                busy={busy}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", connectionId);
                  draggingIdRef.current = connectionId;
                  setDraggingId(connectionId);
                }}
                onDragEnd={() => {
                  draggingIdRef.current = null;
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                onMove={(offset) => moveAccount(connectionId, index + offset)}
                onLogin={() => onLogin(connectionId)}
                onUpdate={(values) => update.mutate({ connectionId, ...values })}
                onDelete={() => remove.mutate(connectionId)}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-2.5 border-t border-warning/18 bg-warning/[0.028] px-4 py-3 text-[9.5px] leading-4 text-warning md:px-5">
        <ShieldCheck className="mt-0.5 shrink-0" size={12} />
        <p>
          Para garantia total, desative “usage credits/extra usage” em cada conta no próprio
          Claude/ChatGPT. O Maestro remove chaves e gateways, nunca compra créditos nem faz fallback
          pago, mas não pode alterar esse controle do servidor.
        </p>
      </div>
      <div className="border-t border-border bg-bg-elevated/25 p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Plus size={12} className="text-primary-soft" />
          <p className="text-[11px] font-semibold">Adicionar à fila</p>
          <InfoTooltip
            content="Cria um perfil isolado dentro do Maestro. Depois, conecte a conta do provedor e arraste o perfil para definir sua prioridade."
            label="Ajuda para adicionar uma conta"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(170px,.7fr)_minmax(220px,1.3fr)_auto] sm:items-end">
          <div>
            <label className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.1em] text-text-faint">
              Provedor
            </label>
            <Select
              className="w-full"
              aria-label="Provedor da nova conta"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value as "codex" | "claude-code")}
            >
              <option value="claude-code">Anthropic · Claude Code</option>
              <option value="codex">OpenAI · Codex</option>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.1em] text-text-faint">
              Nome dentro do Maestro
            </label>
            <Input
              aria-label="Nome da nova conta"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Claude pessoal, Codex trabalho"
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) create.mutate();
              }}
            />
          </div>
          <Button
            className="w-full sm:w-auto"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={13} /> {create.isPending ? "Adicionando…" : "Adicionar conta"}
          </Button>
        </div>
      </div>
      {create.error || update.error || remove.error || reorder.error ? (
        <p className="border-t border-danger/20 bg-danger/[0.04] px-4 py-2 text-[10px] text-danger">
          {String(create.error ?? update.error ?? remove.error ?? reorder.error)}
        </p>
      ) : null}
    </section>
  );
}

function AgentAccountRow({
  account,
  rank,
  total,
  isMaestro,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
  onLogin,
  onUpdate,
  onDelete,
}: {
  account: ProviderConnectionSummary;
  rank: number;
  total: number;
  isMaestro: boolean;
  busy: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMove: (offset: -1 | 1) => void;
  onLogin: () => void;
  onUpdate: (values: { name?: string; enabled?: boolean; concurrencyLimit?: number }) => void;
  onDelete: () => void;
}) {
  const { connection, health } = account;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [accountName, setAccountName] = useState(connection.name);
  useEffect(() => setAccountName(connection.name), [connection.name]);
  const details = accountProviderDetails[connection.providerId];
  const tone =
    health.status === "ready"
      ? "success"
      : health.status === "unauthenticated"
        ? "warning"
        : "danger";
  const healthLabel = healthLabels[health.status];
  const saveName = () => {
    const value = accountName.trim();
    if (!value) setAccountName(connection.name);
    else if (value !== connection.name) onUpdate({ name: value });
  };
  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" && rank > 1) {
      event.preventDefault();
      onMove(-1);
    }
    if (event.key === "ArrowDown" && rank < total) {
      event.preventDefault();
      onMove(1);
    }
  };
  return (
    <div className={cn("p-2.5 md:p-3", !connection.enabled && "opacity-55")}>
      <div className="flex items-start gap-2 md:gap-3">
        <button
          type="button"
          draggable={!busy}
          disabled={busy}
          className="mt-1 grid size-8 shrink-0 cursor-grab place-items-center rounded-[9px] border border-transparent text-text-faint transition-colors hover:border-border hover:bg-bg-elevated hover:text-text active:cursor-grabbing disabled:cursor-default"
          title="Arraste para reordenar. Com foco, use as setas para cima e para baixo."
          aria-label={`Reordenar ${connection.name}, prioridade ${rank} de ${total}`}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={handleReorderKey}
        >
          <GripVertical size={15} />
        </button>
        <div className="mt-0.5 w-7 shrink-0 text-center">
          <span className="block text-[11px] font-bold tabular-nums text-primary-soft">
            {String(rank).padStart(2, "0")}
          </span>
          <span className="mt-0.5 block text-[6.5px] font-bold uppercase tracking-[0.08em] text-text-faint">
            prioridade
          </span>
        </div>
        <div className="hidden size-10 shrink-0 place-items-center self-start rounded-[12px] border border-border bg-bg-elevated text-[10px] font-bold tracking-[0.04em] text-primary-soft sm:grid">
          {details.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text">{details.company}</span>
            <span className="text-[9px] text-text-faint">·</span>
            <span className="text-[10px] font-medium text-text-muted">{details.product}</span>
            <Badge tone={tone}>{healthLabel}</Badge>
            {connection.isDefault ? <Badge tone="neutral">perfil atual</Badge> : null}
            {isMaestro ? <Badge tone="primary">Maestro</Badge> : null}
          </div>
          <div className="mt-2.5 grid gap-3 lg:grid-cols-[minmax(210px,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <div className="max-w-md">
                <label
                  htmlFor={`account-name-${connection.id}`}
                  className="mb-1 flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.08em] text-text-faint"
                >
                  <Pencil size={9} /> Nome dentro do Maestro · editável
                </label>
                <Input
                  id={`account-name-${connection.id}`}
                  className="h-8.5 bg-bg-elevated/65 text-[11.5px] font-semibold"
                  value={accountName}
                  aria-label="Nome da conta no Maestro"
                  disabled={busy}
                  onChange={(event) => setAccountName(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setAccountName(connection.name);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
              <p
                className="mt-1.5 truncate text-[9px] leading-4 text-text-faint"
                title={connection.stateDirectory ?? undefined}
              >
                {health.message} ·{" "}
                {connection.stateDirectory
                  ? compactPath(connection.stateDirectory, 72)
                  : "diretório padrão do CLI"}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-1.5 lg:justify-end">
              <div>
                <div className="flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                  <label htmlFor={`account-sessions-${connection.id}`}>sessões</label>
                  <InfoTooltip
                    className="size-4"
                    content="Máximo de sessões simultâneas permitidas para esta conta. Ao atingir o limite, o Maestro escolhe outra conta disponível ou aguarda."
                    label="Ajuda sobre sessões simultâneas"
                  />
                </div>
                <Input
                  id={`account-sessions-${connection.id}`}
                  className="mt-1 h-8 w-14 bg-bg-elevated/65"
                  type="number"
                  min={1}
                  max={16}
                  defaultValue={connection.concurrencyLimit}
                  disabled={busy}
                  onBlur={(event) =>
                    onUpdate({
                      concurrencyLimit: Math.max(1, Math.min(16, event.target.valueAsNumber || 1)),
                    })
                  }
                />
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={onLogin}>
                <Link2 size={11} /> {health.status === "ready" ? "Reconectar" : "Conectar"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title={connection.enabled ? "Desativar" : "Ativar"}
                aria-label={connection.enabled ? "Desativar conta" : "Ativar conta"}
                disabled={busy}
                onClick={() => onUpdate({ enabled: !connection.enabled })}
              >
                <Power size={13} />
              </Button>
              {!connection.isDefault ? (
                <Button
                  size={confirmDelete ? "sm" : "icon"}
                  variant={confirmDelete ? "danger" : "ghost"}
                  title={confirmDelete ? "Clique novamente para confirmar" : "Remover perfil"}
                  aria-label={confirmDelete ? "Confirmar remoção da conta" : "Remover conta"}
                  disabled={busy || account.activeSessions > 0}
                  onBlur={() => setConfirmDelete(false)}
                  onClick={() => {
                    if (confirmDelete) onDelete();
                    else setConfirmDelete(true);
                  }}
                >
                  <Trash2 size={13} /> {confirmDelete ? "Confirmar" : null}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/65 pb-5 md:pb-6">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-border bg-surface-raised/80 text-primary-soft shadow-[0_10px_26px_-20px_rgb(0_0_0/0.8)]">
          <Icon size={19} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary-soft">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-[25px] font-semibold tracking-[-0.035em] md:text-[28px]">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-text-muted md:text-[12.5px]">
            {description}
          </p>
        </div>
      </div>
      {action}
    </header>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  action,
  children,
  footer,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("settings-card overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/75 px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-border bg-bg-elevated/80 text-primary-soft">
            <Icon size={15} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h3>
            <p className="mt-1 max-w-2xl text-[10.5px] leading-4 text-text-faint">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="p-4 md:p-5">{children}</div>
      {footer ? (
        <div className="border-t border-border/75 bg-bg-elevated/25 px-4 py-3 md:px-5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function SettingToggleRow({
  icon: Icon,
  title,
  description,
  help,
  checked,
  onCheckedChange,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  help: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="group flex items-center gap-3.5 rounded-[13px] border border-border/80 bg-bg-elevated/55 p-3.5 transition-[border-color,background-color] hover:border-border-strong hover:bg-bg-elevated/80">
      <div className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-raised text-text-muted transition-colors group-hover:text-primary-soft">
        <Icon size={14} />
      </div>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[11.5px] font-semibold text-text">
          {title}
          <InfoTooltip content={help} label={`Ajuda sobre ${title.toLocaleLowerCase()}`} />
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-text-faint">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </div>
  );
}

function SettingLabel({
  children,
  help,
  htmlFor,
}: {
  children: React.ReactNode;
  help: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-semibold text-text-muted">
        {children}
      </label>
      <InfoTooltip content={help} label="Mais informações sobre esta configuração" />
    </div>
  );
}

function VaultUnlock({
  bootstrap,
  onBootstrap,
}: {
  bootstrap: BootstrapPayload;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => api().unlockVault(password),
    onSuccess: (vault) => {
      setPassword("");
      onBootstrap({ ...bootstrap, vault });
    },
  });
  return (
    <section className="mt-5 rounded-[14px] border border-warning/25 bg-warning/[0.04] p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-9 place-items-center rounded-[9px] bg-warning/10 text-warning">
          <KeyRound size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">Cofre protegido por senha</h3>
          <p className="mt-1 text-[11px] leading-5 text-text-muted">
            {bootstrap.vault.message}{" "}
            {bootstrap.vault.hasPassword
              ? "Digite a senha existente."
              : "Crie uma senha com pelo menos 8 caracteres."}
          </p>
          <div className="mt-3 flex max-w-md gap-2">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Senha do cofre"
              onKeyDown={(event) => {
                if (event.key === "Enter" && password.length >= 8) mutation.mutate();
              }}
            />
            <Button
              size="sm"
              disabled={password.length < 8 || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Desbloquear
            </Button>
          </div>
          {mutation.error ? (
            <p className="mt-2 text-[10px] text-danger">
              {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function fieldInitial(
  field: ProviderConfigField,
  provider: ProviderSummary,
): string | number | boolean {
  const value = provider.configValues[field.key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (field.defaultValue !== undefined) return field.defaultValue;
  return field.type === "boolean" ? false : "";
}

function ProviderCard({
  provider,
  vaultLocked,
  bootstrap,
  onBootstrap,
}: {
  provider: ProviderSummary;
  vaultLocked: boolean;
  bootstrap: BootstrapPayload;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [expanded, setExpanded] = useState(!provider.configured);
  const contentId = useId();
  useEffect(() => {
    setValues(
      Object.fromEntries(
        provider.configSchema.fields.map((field) => [field.key, fieldInitial(field, provider)]),
      ),
    );
  }, [provider]);
  const save = useMutation({
    mutationFn: () => {
      const submitted: Record<string, string | number | boolean | null> = {};
      for (const field of provider.configSchema.fields) {
        const value = values[field.key];
        if (field.type === "secret" && value === "") continue;
        if (value !== undefined) submitted[field.key] = value;
      }
      return api().configureProvider({ providerId: provider.descriptor.id, values: submitted });
    },
    onSuccess: (providers) => onBootstrap({ ...bootstrap, providers }),
  });
  const healthTone =
    provider.health.status === "ready"
      ? "success"
      : provider.health.status === "unauthenticated"
        ? "warning"
        : provider.health.status === "checking"
          ? "info"
          : "danger";
  return (
    <section className="settings-card overflow-hidden">
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-4 md:px-5",
          expanded && "border-b border-border/75",
        )}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-border bg-bg-elevated text-[10px] font-bold tracking-[0.04em] text-primary-soft">
          {providerInitials(provider.descriptor.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em]">
              {provider.descriptor.name}
            </h3>
            <Badge tone={healthTone}>{healthLabels[provider.health.status]}</Badge>
            <Badge tone="neutral">{provider.descriptor.kind.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[10.5px] leading-4 text-text-muted">
            {provider.descriptor.description}
          </p>
          <p className="mt-1 text-[9.5px] text-text-faint">
            {provider.health.message}
            {provider.health.version ? ` · ${provider.health.version}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {provider.configured ? (
            <span className="hidden items-center gap-1.5 text-[9.5px] font-medium text-success sm:flex">
              <Check size={11} />
              Configurado
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${expanded ? "Ocultar configuração de" : "Configurar"} ${provider.descriptor.name}`}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Ocultar" : "Configurar"}
            <ChevronDown
              className={cn("transition-transform", expanded && "rotate-180")}
              size={12}
            />
          </Button>
        </div>
      </div>
      {expanded ? (
        <div id={contentId}>
          <div className="grid gap-4 p-4 lg:grid-cols-2 md:p-5">
            {provider.configSchema.fields.map((field) => (
              <ProviderField
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                configured={provider.configured}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/75 bg-bg-elevated/25 px-4 py-3 md:px-5">
            <div className="flex items-center gap-2 text-[9.5px] text-text-faint">
              {provider.descriptor.kind === "cli" ? (
                <>
                  <ShieldCheck size={11} />O Maestro não lê nem copia tokens do CLI.
                </>
              ) : (
                <>
                  <LockKeyhole size={11} />
                  Segredos criptografados; nunca retornam à interface.
                </>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={vaultLocked || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Salvando…" : "Salvar e verificar"}
            </Button>
          </div>
        </div>
      ) : null}
      {save.error ? (
        <p className="border-t border-danger/20 bg-danger/[0.04] px-4 py-2 text-[10px] text-danger">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
    </section>
  );
}

function ProviderField({
  field,
  value,
  onChange,
  configured,
}: {
  field: ProviderConfigField;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  configured: boolean;
}) {
  const inputId = useId();
  if (field.type === "boolean")
    return (
      <div className="flex items-center gap-3 rounded-[9px] border border-border bg-bg-elevated p-3 transition-colors hover:border-border-strong">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-medium text-text">
            {field.label}
            {field.description ? (
              <InfoTooltip content={field.description} label={`Ajuda sobre ${field.label}`} />
            ) : null}
          </span>
          {field.description ? (
            <span className="mt-1 block text-[10px] leading-4 text-text-faint">
              {field.description}
            </span>
          ) : null}
        </span>
        <Switch
          id={inputId}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          aria-label={field.label}
        />
      </div>
    );
  return (
    <div>
      <SettingLabel htmlFor={inputId} help={field.description ?? `Configura ${field.label}.`}>
        {field.label}
        {field.required ? " *" : ""}
      </SettingLabel>
      {field.type === "select" ? (
        <Select
          id={inputId}
          className="w-full"
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={inputId}
          type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
          value={value as string | number}
          placeholder={
            field.type === "secret" && configured ? "•••••••• (mantida)" : field.placeholder
          }
          onChange={(event) =>
            onChange(field.type === "number" ? event.target.valueAsNumber : event.target.value)
          }
        />
      )}
      {field.description ? (
        <p className="mt-1.5 text-[10px] text-text-faint">{field.description}</p>
      ) : null}
    </div>
  );
}

function GeneralSettings({
  bootstrap,
  onBootstrap,
}: {
  bootstrap: BootstrapPayload;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>(bootstrap.settings);
  const settingsRef = useRef(bootstrap.settings);
  const persistedSettingsRef = useRef(bootstrap.settings);
  const saveRevisionRef = useRef(0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const preview = () => applyTheme(settings.theme);
    preview();
    media.addEventListener("change", preview);
    return () => {
      media.removeEventListener("change", preview);
      applyTheme(bootstrap.settings.theme);
    };
  }, [settings.theme, bootstrap.settings.theme]);
  const save = useMutation({
    mutationFn: ({ patch }: { patch: Partial<AppSettings>; revision: number }) =>
      api().updateSettings(patch),
    scope: { id: "general-settings-autosave" },
    onSuccess: async (saved, request) => {
      persistedSettingsRef.current = saved;
      if (request.revision !== saveRevisionRef.current) return;
      const refreshed = await api().bootstrap();
      if (request.revision !== saveRevisionRef.current) return;
      persistedSettingsRef.current = refreshed.settings;
      settingsRef.current = refreshed.settings;
      setSettings(refreshed.settings);
      onBootstrap(refreshed);
    },
    onError: async (_error, request) => {
      if (request.revision !== saveRevisionRef.current) return;
      const refreshed = await api()
        .bootstrap()
        .catch(() => null);
      if (request.revision !== saveRevisionRef.current) return;
      const restored = refreshed?.settings ?? persistedSettingsRef.current;
      persistedSettingsRef.current = restored;
      settingsRef.current = restored;
      setSettings(restored);
      if (refreshed) onBootstrap(refreshed);
    },
  });
  useEffect(() => {
    persistedSettingsRef.current = bootstrap.settings;
    if (save.isPending) return;
    settingsRef.current = bootstrap.settings;
    setSettings(bootstrap.settings);
  }, [bootstrap.settings, save.isPending]);
  const updateSetting = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    const revision = ++saveRevisionRef.current;
    save.mutate({ patch: { [key]: value }, revision });
  };
  const checkUpdate = useMutation({
    mutationFn: () => api().checkForUpdates(),
    onSuccess: async () => onBootstrap(await api().bootstrap()),
  });
  const dirty = JSON.stringify(settings) !== JSON.stringify(bootstrap.settings);
  return (
    <>
      <SettingsHeader
        icon={SlidersHorizontal}
        eyebrow="Experiência e execução"
        title="Geral"
        description="Ajuste a aparência, o comportamento padrão e como o aplicativo recebe atualizações."
      />
      <div className="mt-6 space-y-4">
        <SettingsSection
          icon={Palette}
          title="Aparência e idioma"
          description="Personalize a interface sem afetar conversas, agentes ou respostas dos modelos."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <SettingLabel help="Muda apenas o visual da interface. A opção Sistema acompanha automaticamente o tema claro ou escuro do dispositivo.">
                Tema da interface
              </SettingLabel>
              <ThemePicker
                value={settings.theme}
                onValueChange={(theme) => updateSetting("theme", theme)}
              />
              <p className="mt-2 text-[9.5px] text-text-faint">
                A prévia é instantânea e a escolha é salva automaticamente.
              </p>
            </div>
            <div className="rounded-[14px] border border-border/80 bg-bg-elevated/45 p-4">
              <div className="mb-3 flex items-center gap-2 text-text-muted">
                <Languages size={14} />
                <span className="text-[10.5px] font-semibold text-text">Idioma da interface</span>
              </div>
              <SettingLabel
                htmlFor="settings-locale"
                help="Define o idioma preferido da interface e dos textos padrão do aplicativo. Não força o idioma das respostas dos modelos."
              >
                Idioma
              </SettingLabel>
              <Select
                id="settings-locale"
                className="w-full"
                value={settings.locale}
                onChange={(event) =>
                  updateSetting("locale", event.target.value as AppSettings["locale"])
                }
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
              </Select>
              <p className="mt-2 text-[9.5px] leading-4 text-text-faint">
                Respostas dos modelos continuam seguindo o contexto de cada conversa.
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Cpu}
          title="Comportamento e capacidade"
          description="Escolha como novas conversas começam e limite o trabalho simultâneo no dispositivo."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <SettingLabel
                htmlFor="settings-default-mode"
                help="É o modo pré-selecionado ao criar uma conversa. Maestro planeja e coordena tarefas; Agente direto trabalha com um único agente; Chat simples apenas conversa."
              >
                Modo padrão de conversa
              </SettingLabel>
              <Select
                id="settings-default-mode"
                className="w-full"
                value={settings.defaultMode}
                onChange={(event) =>
                  updateSetting("defaultMode", event.target.value as AppSettings["defaultMode"])
                }
              >
                <option value="maestro">Maestro</option>
                <option value="agent">Agente direto</option>
                <option value="chat">Chat simples</option>
              </Select>
            </div>
            <div>
              <SettingLabel
                htmlFor="settings-global-concurrency"
                help="Limita quantas tarefas do Maestro podem executar ao mesmo tempo. Valores maiores podem acelerar planos paralelos, mas consomem mais CPU, memória e sessões de assinatura."
              >
                Concorrência global (1–16)
              </SettingLabel>
              <div className="relative">
                <Gauge
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
                  size={13}
                />
                <Input
                  id="settings-global-concurrency"
                  className="pl-9"
                  type="number"
                  min={1}
                  max={16}
                  value={settings.globalConcurrency}
                  onChange={(event) => {
                    if (Number.isNaN(event.target.valueAsNumber)) return;
                    updateSetting("globalConcurrency", event.target.valueAsNumber);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-[13px] border border-primary/18 bg-primary/[0.035] p-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary/10 text-primary-soft">
              <ListOrdered size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-text">
                Prioridade das contas dos agentes
                <InfoTooltip
                  content="O Maestro tenta primeiro a conta compatível que estiver mais acima e avança quando ela estiver indisponível ou sem capacidade."
                  label="Ajuda sobre a prioridade das contas"
                />
              </div>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">
                Definida visualmente na aba <strong className="text-text">Conexões</strong>. Arraste
                as contas para alterar a ordem de preferência.
              </p>
            </div>
            <Badge tone="primary">ordem visual</Badge>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Download}
          title="Atualizações e privacidade"
          description="Controle o canal de versões, as verificações automáticas e as métricas mantidas neste dispositivo."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <SettingLabel
                htmlFor="settings-update-channel"
                help="Estável recebe somente versões finais. Beta recebe somente novas prévias beta, que podem trazer recursos antes, mas têm maior chance de instabilidade."
              >
                Canal de atualização
              </SettingLabel>
              <Select
                id="settings-update-channel"
                className="w-full"
                value={settings.updateChannel}
                onChange={(event) =>
                  updateSetting("updateChannel", event.target.value as AppSettings["updateChannel"])
                }
              >
                <option value="stable">Estável</option>
                <option value="beta">Beta</option>
              </Select>
              <p className="mt-1.5 text-[9.5px] leading-4 text-text-faint">
                {settings.updateChannel === "stable"
                  ? "Somente versões finais recomendadas serão oferecidas."
                  : "Somente betas realmente mais novas serão oferecidas; versões estáveis e betas anteriores são ignoradas."}
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-[13px] border border-success/20 bg-success/[0.045] p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-success/10 text-success">
                <ShieldCheck size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] font-semibold text-text">
                  Origem oficial de atualizações
                </span>
                <span className="mt-0.5 block truncate text-[9.5px] text-text-faint">
                  GitHub Releases · polarco/maestro
                </span>
              </span>
              <Badge tone="success">Verificada</Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5">
            <SettingToggleRow
              icon={HardDrive}
              title="Telemetria local"
              description="Calcula métricas no dispositivo; nenhum dado é enviado pelo Maestro."
              help="Calcula contagens e métricas de uso somente neste dispositivo. Ativar não envia dados para servidores do Maestro."
              checked={settings.telemetryEnabled}
              onCheckedChange={(telemetryEnabled) =>
                updateSetting("telemetryEnabled", telemetryEnabled)
              }
            />
            <SettingToggleRow
              icon={RefreshCcw}
              title="Verificar atualizações automaticamente"
              description="Consulta ao iniciar e a cada seis horas; você decide quando instalar."
              help="Faz uma consulta ao iniciar e depois a cada seis horas. O Maestro avisa antes de baixar ou instalar qualquer versão."
              checked={settings.autoUpdateEnabled}
              onCheckedChange={(autoUpdateEnabled) =>
                updateSetting("autoUpdateEnabled", autoUpdateEnabled)
              }
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[13px] border border-border/80 bg-bg-elevated/45 p-3.5">
            <RefreshCcw
              size={13}
              className={checkUpdate.isPending ? "animate-spin text-info" : "text-text-faint"}
            />
            <span className="min-w-0 flex-1 text-[10.5px] leading-4 text-text-muted">
              {bootstrap.update.message}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={checkUpdate.isPending || bootstrap.app.development}
              onClick={() => checkUpdate.mutate()}
            >
              Verificar agora
            </Button>
          </div>
        </SettingsSection>

        <div
          className={cn(
            "settings-savebar flex flex-wrap items-center gap-3 rounded-[16px] border px-3.5 py-3 shadow-[0_18px_48px_-24px_rgb(0_0_0/0.78)] md:px-4",
            save.error
              ? "border-danger/25 bg-danger/[0.045]"
              : dirty || save.isPending
                ? "border-info/25 bg-surface-raised/95"
                : "border-success/18 bg-surface/95",
          )}
          aria-live="polite"
          role="status"
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-[10px]",
              save.error
                ? "bg-danger/10 text-danger"
                : dirty || save.isPending
                  ? "bg-info/10 text-info"
                  : "bg-success/10 text-success",
            )}
          >
            {save.error ? (
              <CircleAlert size={14} />
            ) : dirty || save.isPending ? (
              <RefreshCcw className="animate-spin" size={14} />
            ) : (
              <Check size={14} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold text-text">
              {save.error
                ? "Não foi possível salvar a última alteração"
                : dirty || save.isPending
                  ? "Salvando automaticamente…"
                  : "Preferências salvas automaticamente"}
            </span>
            <span className="mt-0.5 block text-[9px] text-text-faint">
              {save.error
                ? "A preferência anterior foi restaurada. Tente alterar o campo novamente."
                : dirty || save.isPending
                  ? "As mudanças são gravadas em ordem para evitar conflitos."
                  : "Você pode trocar de aba ou fechar esta tela sem perder alterações."}
            </span>
          </span>
          <Badge tone={save.error ? "danger" : dirty || save.isPending ? "info" : "success"}>
            {save.error ? "falhou" : dirty || save.isPending ? "salvando" : "salvo"}
          </Badge>
        </div>
        {save.error ? (
          <p className="rounded-[12px] border border-danger/20 bg-danger/[0.04] px-4 py-3 text-[10px] text-danger">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        ) : null}
      </div>
    </>
  );
}

function ProjectSettings({
  project,
  onBootstrap,
}: {
  project: Project;
  onBootstrap: (value: BootstrapPayload) => void;
}) {
  const add = useMutation({
    mutationFn: async () => {
      const directory = await api().selectDirectory();
      if (!directory) return null;
      return api().addProjectRoot(project.id, directory);
    },
    onSuccess: async (value) => {
      if (!value) return;
      onBootstrap(await api().bootstrap());
    },
  });
  return (
    <>
      <SettingsHeader
        icon={FolderOpen}
        eyebrow="Workspace atual"
        title="Projeto"
        description="Veja o escopo que os agentes podem acessar e amplie as permissões de forma explícita."
        action={
          <Button disabled={add.isPending} onClick={() => add.mutate()}>
            <FolderPlus size={13} />
            {add.isPending ? "Selecionando…" : "Adicionar pasta"}
          </Button>
        }
      />
      <section className="settings-card mt-6 overflow-hidden">
        <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(260px,.85fr)]">
          <div className="relative overflow-hidden border-b border-primary/15 bg-primary/[0.04] p-5 md:border-r md:border-b-0 md:p-6">
            <div className="pointer-events-none absolute -right-10 -bottom-16 size-40 rounded-full border border-primary/10 bg-primary/[0.025]" />
            <div className="relative flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-primary/20 bg-primary/10 text-primary-soft">
                <FolderOpen size={19} />
              </div>
              <div className="min-w-0">
                <p className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-primary-soft">
                  Projeto ativo
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <h3 className="truncate text-[17px] font-semibold tracking-[-0.025em]">
                    {project.name}
                  </h3>
                  <InfoTooltip
                    content="O projeto agrupa conversas, execuções e pastas autorizadas. Renomear ou gerenciar projetos pode ser feito pelo menu de três pontos na barra lateral."
                    label="Ajuda sobre o projeto"
                  />
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-text-muted">
                  Conversas, execuções e permissões permanecem organizadas neste workspace.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 md:p-5">
            <div className="rounded-[13px] border border-border/80 bg-bg-elevated/50 p-3.5">
              <div className="flex items-center gap-2 text-text-faint">
                <FolderPlus size={13} />
                <span className="text-[8px] font-bold uppercase tracking-[0.12em]">Escopo</span>
              </div>
              <p className="mt-2 text-[20px] font-semibold tracking-[-0.04em]">
                {project.roots.length}
              </p>
              <p className="mt-0.5 text-[9px] text-text-faint">
                pasta{project.roots.length === 1 ? "" : "s"} autorizada
                {project.roots.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-[13px] border border-success/18 bg-success/[0.035] p-3.5">
              <div className="flex items-center gap-2 text-success">
                <ShieldCheck size={13} />
                <span className="text-[8px] font-bold uppercase tracking-[0.12em]">Proteção</span>
              </div>
              <p className="mt-2 text-[12px] font-semibold">Escopo local</p>
              <p className="mt-1 text-[9px] leading-4 text-text-faint">Escrita só após aprovação</p>
            </div>
          </div>
        </div>
      </section>

      <SettingsSection
        className="mt-4"
        icon={ShieldCheck}
        title="Pastas autorizadas"
        description="Somente os caminhos abaixo podem ser consultados ou alterados pelos agentes deste projeto."
        action={<Badge tone="success">acesso explícito</Badge>}
      >
        <div className="space-y-2.5">
          {project.roots.length === 0 ? (
            <div className="grid min-h-36 place-items-center rounded-[14px] border border-dashed border-border p-6 text-center">
              <div>
                <FolderOpen className="mx-auto text-text-faint" size={22} />
                <p className="mt-2 text-[11.5px] font-semibold">Nenhuma pasta autorizada</p>
                <p className="mt-1 max-w-sm text-[10px] leading-4 text-text-faint">
                  Adicione uma pasta para permitir que os agentes leiam e trabalhem no projeto.
                </p>
              </div>
            </div>
          ) : null}
          {project.roots.map((root, index) => (
            <div
              key={root.id}
              className="group flex flex-wrap items-center gap-3 rounded-[14px] border border-border/80 bg-bg-elevated/45 p-3.5 transition-colors hover:border-border-strong hover:bg-bg-elevated/70"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-success/15 bg-success/[0.07] text-success">
                <FolderOpen size={15} />
              </div>
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-bold tabular-nums text-text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="truncate text-[11.5px] font-semibold">{root.displayName}</div>
                </div>
                <div
                  className="mt-1 truncate font-mono text-[9px] text-text-faint"
                  title={root.canonicalPath}
                >
                  {compactPath(root.canonicalPath, 100)}
                </div>
              </div>
              <span className="flex items-center gap-1">
                <Badge tone={root.writable ? "warning" : "neutral"}>
                  {root.writable ? "escrita após aprovação" : "somente leitura"}
                </Badge>
                <InfoTooltip
                  content={
                    root.writable
                      ? "Agentes só podem gravar nesta pasta depois de uma aprovação explícita do plano. Leitura e execução continuam limitadas ao escopo autorizado."
                      : "Agentes podem consultar esta pasta, mas nunca gravar alterações nela."
                  }
                  label={`Ajuda sobre permissões de ${root.displayName}`}
                />
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2.5 rounded-[13px] border border-info/16 bg-info/[0.035] p-3.5">
          <ShieldCheck className="mt-0.5 shrink-0 text-info" size={13} />
          <p className="text-[9.5px] leading-4 text-text-muted">
            Autorizar uma pasta amplia o escopo de leitura. Qualquer escrita ainda depende da
            aprovação explícita do plano antes da execução.
          </p>
        </div>
      </SettingsSection>
      {add.error ? (
        <p className="mt-3 rounded-[12px] border border-danger/20 bg-danger/[0.04] px-4 py-3 text-[10px] text-danger">
          {add.error instanceof Error ? add.error.message : String(add.error)}
        </p>
      ) : null}
    </>
  );
}

function Diagnostics({
  bootstrap,
  refresh,
  refreshing,
}: {
  bootstrap: BootstrapPayload;
  refresh: () => void;
  refreshing: boolean;
}) {
  const readyProviders = bootstrap.providers.filter(
    (provider) => provider.health.status === "ready",
  ).length;
  const needsAttention = bootstrap.providers.length - readyProviders;
  const vaultReady = !bootstrap.vault.locked;
  return (
    <>
      <SettingsHeader
        icon={Activity}
        eyebrow="Estado do sistema"
        title="Diagnósticos"
        description="Uma visão clara do aplicativo, do cofre local e dos provedores detectados."
        action={
          <Button size="sm" variant="secondary" disabled={refreshing} onClick={refresh}>
            <RefreshCcw className={refreshing ? "animate-spin" : ""} size={12} />
            {refreshing ? "Verificando…" : "Atualizar estado"}
          </Button>
        }
      />
      <div
        className={cn(
          "settings-card mt-6 flex flex-wrap items-center gap-4 overflow-hidden p-4 md:p-5",
          needsAttention === 0 && vaultReady ? "border-success/20" : "border-warning/20",
        )}
      >
        <div
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-[14px]",
            needsAttention === 0 && vaultReady
              ? "bg-success/10 text-success"
              : "bg-warning/10 text-warning",
          )}
        >
          <Activity size={19} />
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold">
              {needsAttention === 0 && vaultReady
                ? "Ambiente operacional"
                : "Alguns itens precisam de atenção"}
            </h3>
            <Badge tone={needsAttention === 0 && vaultReady ? "success" : "warning"}>
              {readyProviders}/{bootstrap.providers.length} provedores prontos
            </Badge>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-text-muted">
            {needsAttention === 0 && vaultReady
              ? "O runtime local, o cofre e todas as integrações detectadas estão disponíveis."
              : `${needsAttention} provedor${needsAttention === 1 ? "" : "es"} fora do estado pronto${vaultReady ? "." : " e o cofre está bloqueado."}`}
          </p>
        </div>
        <span className="font-mono text-[9px] text-text-faint">verificação local</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Diagnostic
          icon={Sparkles}
          label="Versão"
          value={`${bootstrap.app.name} ${bootstrap.app.version}`}
        />
        <Diagnostic icon={Cpu} label="Plataforma" value={bootstrap.app.platform} />
        <Diagnostic
          icon={LockKeyhole}
          label="Cofre"
          value={`${bootstrap.vault.backend} · ${bootstrap.vault.locked ? "bloqueado" : "desbloqueado"}`}
          tone={bootstrap.vault.locked ? "warning" : "success"}
        />
        <Diagnostic
          icon={HardDrive}
          label="Telemetria"
          value={bootstrap.settings.telemetryEnabled ? "local ativada" : "desativada"}
        />
      </div>

      <SettingsSection
        className="mt-4"
        icon={ServerCog}
        title="Saúde dos provedores"
        description="Disponibilidade, mensagem do runtime e versão encontrada em cada integração."
        action={
          <span className="text-[9px] text-text-faint">
            {readyProviders} pronto{readyProviders === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="space-y-2">
          {bootstrap.providers.map((provider) => (
            <div
              key={provider.descriptor.id}
              className="flex flex-wrap items-center gap-3 rounded-[13px] border border-border/80 bg-bg-elevated/45 p-3.5 transition-colors hover:border-border-strong"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full shadow-[0_0_0_4px_color-mix(in_srgb,currentColor_10%,transparent)]",
                  provider.health.status === "ready"
                    ? "bg-success text-success"
                    : provider.health.status === "checking"
                      ? "bg-info text-info"
                      : provider.health.status === "unauthenticated"
                        ? "bg-warning text-warning"
                        : "bg-danger text-danger",
                )}
              />
              <div className="min-w-[150px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-text">
                    {provider.descriptor.name}
                  </span>
                  <Badge
                    tone={
                      provider.health.status === "ready"
                        ? "success"
                        : provider.health.status === "checking"
                          ? "info"
                          : provider.health.status === "unauthenticated"
                            ? "warning"
                            : "danger"
                    }
                  >
                    {healthLabels[provider.health.status]}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-[9.5px] text-text-faint">
                  {provider.health.message}
                </p>
              </div>
              <span className="font-mono text-[9px] text-text-faint">
                {provider.health.version ?? "versão não informada"}
              </span>
            </div>
          ))}
          {bootstrap.providers.length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-border p-6 text-center text-[10px] text-text-faint">
              Nenhum provedor foi detectado.
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}

function Diagnostic({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <div className="settings-card flex min-w-0 items-start gap-3 p-3.5">
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[10px]",
          tone === "success"
            ? "bg-success/10 text-success"
            : tone === "warning"
              ? "bg-warning/10 text-warning"
              : "bg-bg-elevated text-text-muted",
        )}
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-faint">
          {label}
        </div>
        <div className="mt-1 truncate font-mono text-[10px] text-text-muted" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}
