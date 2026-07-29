import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Bot,
  Check,
  FolderPlus,
  GripVertical,
  KeyRound,
  Link2,
  ListOrdered,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
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
import { compactPath, providerInitials } from "@renderer/lib/utils";
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
    ["connections", "Conexões", ServerCog],
    ["general", "Geral", SlidersHorizontal],
    ["project", "Projeto", FolderPlus],
    ["diagnostics", "Diagnósticos", Settings2],
  ] as const;

  return (
    <TooltipProvider delayDuration={320} skipDelayDuration={100}>
      <div className="settings-page page-enter flex h-full min-w-0 flex-col bg-bg/45 xl:flex-row">
        <aside className="w-full shrink-0 border-b border-border bg-bg-elevated/35 p-3 md:flex md:items-center md:gap-3 xl:block xl:w-52 xl:border-b-0 xl:border-r xl:p-4">
          <div className="mb-3 shrink-0 px-2 md:mb-0 xl:mb-5">
            <h1 className="text-[17px] font-semibold">Configurações</h1>
            <p className="mt-1 text-[11px] text-text-faint">Aplicativo e projeto</p>
          </div>
          <nav
            className="flex flex-1 gap-1 overflow-x-auto xl:block xl:space-y-1"
            aria-label="Seções de configurações"
          >
            {tabs.map(([value, label, Icon]) => (
              <button
                key={value}
                className={`flex h-10 shrink-0 items-center gap-2.5 rounded-[9px] px-3 text-[12px] font-medium xl:w-full ${tab === value ? "bg-primary/12 text-primary-soft" : "text-text-muted hover:bg-surface-hover hover:text-text"}`}
                onClick={() => setTab(value)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1020px] p-5 md:p-6 xl:p-8">
            {tab === "connections" ? (
              <>
                <SettingsHeader
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
                <div className="mt-7">
                  <h3 className="text-[13px] font-semibold">Provedores e credenciais</h3>
                  <p className="mt-1 text-[10px] text-text-faint">
                    Configure as APIs disponíveis para o Maestro e os executáveis das contas dos
                    agentes. APIs pagas nunca são usadas nas tarefas do DAG.
                  </p>
                </div>
                <div className="mt-5 space-y-4">
                  {bootstrap.providers.map((provider) => (
                    <ProviderCard
                      key={provider.descriptor.id}
                      provider={provider}
                      vaultLocked={bootstrap.vault.locked}
                      bootstrap={bootstrap}
                      onBootstrap={onBootstrap}
                    />
                  ))}
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
          </div>
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
    <section className="panel mt-6 overflow-hidden border-primary/25">
      <div className="flex flex-wrap items-start gap-4 border-b border-primary/15 bg-primary/[0.045] p-5 md:p-6">
        <div className="grid size-11 shrink-0 place-items-center rounded-[13px] border border-primary/20 bg-primary/10 text-primary-soft">
          <Bot size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">Conta/API principal do Maestro</h3>
            <Badge tone="primary">coordenação</Badge>
            <InfoTooltip
              content="Esta escolha é usada pelo Maestro para analisar pedidos e montar ou revisar planos. As tarefas criadas por ele continuam usando a fila de contas abaixo."
              label="Ajuda sobre a conta principal do Maestro"
            />
          </div>
          <p className="mt-1.5 max-w-2xl text-[11px] leading-5 text-text-muted">
            É a identidade que pensa e coordena. Pode ser uma API configurada ou uma das contas de
            assinatura conectadas.
          </p>
        </div>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.25fr)_minmax(180px,.75fr)] md:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SettingLabel
              htmlFor="maestro-primary-account"
              help="Define o provedor e, no caso de uma assinatura, o perfil isolado usado nas etapas de análise e planejamento do Maestro."
            >
              Conta ou API
            </SettingLabel>
            <Select
              id="maestro-primary-account"
              className="w-full"
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
          <div>
            <SettingLabel
              htmlFor="maestro-primary-model"
              help="Modelo usado pelo Maestro para estruturar a análise e gerar o plano antes da execução pelos agentes."
            >
              Modelo do Maestro
            </SettingLabel>
            <Select
              id="maestro-primary-model"
              className="w-full"
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
        <div className="rounded-[13px] border border-border bg-bg-elevated/65 p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
            Em uso pelo Maestro
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-text">
              {selectedTarget?.providerName ?? "Nenhum provedor"}
            </span>
            {selectedTarget ? (
              <Badge tone={statusTone}>{healthLabels[selectedTarget.status]}</Badge>
            ) : null}
          </div>
          {selectedTarget?.kind === "account" ? (
            <p className="mt-1 text-[10px] font-medium text-primary-soft">
              Perfil “{selectedTarget.displayName}”
            </p>
          ) : null}
          <p className="mt-2 text-[10px] leading-4 text-text-faint">
            {selectedTarget?.message ?? "Configure ao menos um provedor para continuar."}
          </p>
          {save.isPending ? <p className="mt-2 text-[10px] text-info">Salvando escolha…</p> : null}
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
    <section className="panel mt-6 overflow-hidden">
      <div className="panel-header">
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
        <div className="hidden items-center gap-2 text-[10px] text-primary-soft sm:flex">
          <ListOrdered size={12} /> fila de execução
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {orderedAccounts.map((account, index) => {
          const connectionId = account.connection.id;
          return (
            <div
              key={connectionId}
              className={`transition-colors ${dragOverId === connectionId && draggingId !== connectionId ? "bg-primary/[0.055]" : ""}`}
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
                const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
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
                  setDraggingId(connectionId);
                }}
                onDragEnd={() => {
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
      <div className="border-t border-warning/20 bg-warning/[0.035] px-4 py-3 text-[10px] leading-4 text-warning">
        Para garantia total, desative “usage credits/extra usage” em cada conta no próprio
        Claude/ChatGPT. O Maestro remove chaves e gateways, nunca compra créditos nem faz fallback
        pago, mas não pode alterar esse controle do servidor.
      </div>
      <div className="grid gap-2 border-t border-border bg-bg-elevated/30 p-3 sm:grid-cols-[150px_1fr_auto]">
        <Select
          aria-label="Provedor da nova conta"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value as "codex" | "claude-code")}
        >
          <option value="claude-code">Anthropic · Claude Code</option>
          <option value="codex">OpenAI · Codex</option>
        </Select>
        <Input
          aria-label="Nome da nova conta"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome da conta, ex.: Claude pessoal 2"
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) create.mutate();
          }}
        />
        <Button
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus size={12} /> Adicionar conta
        </Button>
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
    <div className={`px-3 py-4 md:px-4 ${connection.enabled ? "" : "opacity-55"}`}>
      <div className="flex items-start gap-2 md:gap-3">
        <button
          type="button"
          draggable={!busy}
          disabled={busy}
          className="mt-1 grid size-8 shrink-0 cursor-grab place-items-center rounded-[9px] text-text-faint transition-colors hover:bg-surface-hover hover:text-text active:cursor-grabbing disabled:cursor-default"
          title="Arraste para reordenar. Com foco, use as setas para cima e para baixo."
          aria-label={`Reordenar ${connection.name}, prioridade ${rank} de ${total}`}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={handleReorderKey}
        >
          <GripVertical size={16} />
        </button>
        <div className="mt-0.5 w-8 shrink-0 text-center">
          <span className="block text-[13px] font-bold tabular-nums text-primary-soft">
            #{rank}
          </span>
          <span className="mt-0.5 block text-[7px] font-semibold uppercase tracking-wide text-text-faint">
            prioridade
          </span>
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-border bg-bg-elevated text-[10px] font-semibold text-primary-soft">
          {details.initials}
        </div>
        <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-end lg:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{details.company}</Badge>
              <span className="text-[11px] font-semibold text-text-muted">{details.product}</span>
              <Badge tone={tone}>{healthLabel}</Badge>
              {connection.isDefault ? <Badge tone="neutral">perfil atual</Badge> : null}
              {isMaestro ? <Badge tone="primary">também coordena o Maestro</Badge> : null}
            </div>
            <div className="mt-2 max-w-sm">
              <label
                htmlFor={`account-name-${connection.id}`}
                className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-text-faint"
              >
                <Pencil size={9} /> Nome dentro do Maestro · você pode renomear
              </label>
              <Input
                id={`account-name-${connection.id}`}
                className="h-8 text-[12px] font-semibold"
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
              className="mt-1.5 truncate text-[10px] text-text-faint"
              title={connection.stateDirectory ?? undefined}
            >
              {health.message} ·{" "}
              {connection.stateDirectory
                ? compactPath(connection.stateDirectory, 72)
                : "diretório padrão do CLI"}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 lg:mt-0 lg:justify-end">
            <div>
              <div className="flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-faint">
                <label htmlFor={`account-sessions-${connection.id}`}>sessões</label>
                <InfoTooltip
                  className="size-4"
                  content="Máximo de sessões simultâneas permitidas para esta conta. Ao atingir o limite, o Maestro escolhe outra conta disponível ou aguarda."
                  label="Ajuda sobre sessões simultâneas"
                />
              </div>
              <Input
                id={`account-sessions-${connection.id}`}
                className="mt-1 h-7 w-16"
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
  );
}

function SettingsHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[27px] font-semibold tracking-[-0.035em]">{title}</h2>
        <p className="mt-1.5 text-[13px] text-text-muted">{description}</p>
      </div>
      {action}
    </header>
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
    <section className="panel overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="grid size-9 place-items-center rounded-[9px] border border-border bg-bg-elevated text-[10px] font-semibold text-primary-soft">
          {providerInitials(provider.descriptor.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold">{provider.descriptor.name}</h3>
            <Badge tone={healthTone}>{healthLabels[provider.health.status]}</Badge>
            <Badge tone="neutral">{provider.descriptor.kind.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">{provider.descriptor.description}</p>
          <p className="mt-1 text-[10px] text-text-faint">
            {provider.health.message}
            {provider.health.version ? ` · ${provider.health.version}` : ""}
          </p>
        </div>
        {provider.configured ? (
          <span className="flex items-center gap-1.5 text-[10px] text-success">
            <Check size={11} />
            Configurado
          </span>
        ) : null}
      </div>
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
        <div className="flex items-center gap-2 text-[10px] text-text-faint">
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
  const baselineSettings = useRef(bootstrap.settings);
  useEffect(() => {
    const previous = baselineSettings.current;
    setSettings((current) => {
      if (JSON.stringify(current) === JSON.stringify(previous)) return bootstrap.settings;
      return { ...current, theme: bootstrap.settings.theme };
    });
    baselineSettings.current = bootstrap.settings;
  }, [bootstrap.settings]);
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
    mutationFn: () => api().updateSettings(settings),
    onSuccess: async () => onBootstrap(await api().bootstrap()),
  });
  const checkUpdate = useMutation({
    mutationFn: () => api().checkForUpdates(),
    onSuccess: async () => onBootstrap(await api().bootstrap()),
  });
  const dirty = JSON.stringify(settings) !== JSON.stringify(bootstrap.settings);
  return (
    <>
      <SettingsHeader
        title="Geral"
        description="Preferências locais e limites globais de execução."
      />
      <section className="panel mt-6 p-5 md:p-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <SettingLabel help="Muda apenas o visual da interface. A opção Sistema acompanha automaticamente o tema claro ou escuro do dispositivo.">
              Aparência
            </SettingLabel>
            <ThemePicker
              value={settings.theme}
              onValueChange={(theme) => setSettings({ ...settings, theme })}
            />
            <p className="mt-2 text-[10px] text-text-faint">
              A prévia é instantânea. Salve as preferências para manter a escolha.
            </p>
          </div>
          <div>
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
                setSettings({ ...settings, locale: event.target.value as AppSettings["locale"] })
              }
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div>
            <SettingLabel
              htmlFor="settings-default-mode"
              help="É o modo pré-selecionado ao criar uma conversa. Maestro planeja e coordena tarefas; Agente direto trabalha com um único agente; Chat simples apenas conversa."
            >
              Modo padrão
            </SettingLabel>
            <Select
              id="settings-default-mode"
              className="w-full"
              value={settings.defaultMode}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  defaultMode: event.target.value as AppSettings["defaultMode"],
                })
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
            <Input
              id="settings-global-concurrency"
              type="number"
              min={1}
              max={16}
              value={settings.globalConcurrency}
              onChange={(event) =>
                setSettings({ ...settings, globalConcurrency: event.target.valueAsNumber })
              }
            />
          </div>
          <div>
            <SettingLabel help="A prioridade agora é definida diretamente pela ordem visual das contas. O Maestro tenta primeiro a conta compatível que estiver mais acima e avança quando ela estiver indisponível ou sem capacidade.">
              Prioridade das contas dos agentes
            </SettingLabel>
            <div className="flex min-h-10 items-center gap-3 rounded-[10px] border border-primary/20 bg-primary/[0.045] px-3.5 py-2.5">
              <ListOrdered className="shrink-0 text-primary-soft" size={15} />
              <p className="text-[11px] leading-4 text-text-muted">
                Definida pela ordem da lista na aba <strong className="text-text">Conexões</strong>.
                Arraste as contas para alterar.
              </p>
            </div>
          </div>
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
                setSettings({
                  ...settings,
                  updateChannel: event.target.value as AppSettings["updateChannel"],
                })
              }
            >
              <option value="stable">Estável</option>
              <option value="beta">Beta</option>
            </Select>
            <p className="mt-1.5 text-[10px] text-text-faint">
              {settings.updateChannel === "stable"
                ? "Receba somente versões finais recomendadas."
                : "Receba somente prévias beta mais novas; versões estáveis e anteriores são ignoradas."}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-[11px] border border-success/20 bg-success/[0.055] p-3.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-success/10 text-success">
              <ShieldCheck size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-text">
                Origem oficial de atualizações
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-text-faint">
                GitHub Releases · polarco/maestro
              </span>
            </span>
            <Badge tone="success">Verificada</Badge>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-4 rounded-[11px] border border-border bg-bg-elevated p-3.5 transition-colors hover:border-border-strong">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[12px] font-semibold">
              Telemetria local
              <InfoTooltip
                content="Calcula contagens e métricas de uso somente neste dispositivo. Ativar não envia dados para servidores do Maestro."
                label="Ajuda sobre telemetria local"
              />
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-text-faint">
              Calcula métricas no dispositivo. Nenhum envio remoto é realizado pelo Maestro.
            </span>
          </span>
          <Switch
            checked={settings.telemetryEnabled}
            onCheckedChange={(telemetryEnabled) => setSettings({ ...settings, telemetryEnabled })}
            aria-label="Telemetria local"
          />
        </div>
        <div className="mt-3 flex items-center gap-4 rounded-[11px] border border-border bg-bg-elevated p-3.5 transition-colors hover:border-border-strong">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[12px] font-semibold">
              Verificar atualizações automaticamente
              <InfoTooltip
                content="Faz uma consulta ao iniciar e depois a cada seis horas. O Maestro avisa antes de baixar ou instalar qualquer versão."
                label="Ajuda sobre atualizações automáticas"
              />
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-text-faint">
              Verifica ao iniciar e a cada seis horas; download e instalação são oferecidos antes de
              acontecer. No Linux instalado por .deb, o Maestro abre o instalador do sistema.
            </span>
          </span>
          <Switch
            checked={settings.autoUpdateEnabled}
            onCheckedChange={(autoUpdateEnabled) => setSettings({ ...settings, autoUpdateEnabled })}
            aria-label="Verificar atualizações automaticamente"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[11px] border border-border bg-bg-elevated p-3.5">
          <RefreshCcw
            size={12}
            className={checkUpdate.isPending ? "animate-spin text-info" : "text-text-faint"}
          />
          <span className="min-w-0 flex-1 text-[11px] text-text-muted">
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
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-5">
          <span className="mr-auto text-[10px] text-text-faint">
            {dirty ? "Há alterações ainda não salvas" : "Preferências atualizadas"}
          </span>
          <Button disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
            {!dirty ? <Check size={13} /> : null}
            {save.isPending ? "Salvando…" : dirty ? "Salvar preferências" : "Tudo salvo"}
          </Button>
        </div>
        {save.error ? (
          <p className="mt-3 text-[10px] text-danger">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        ) : null}
      </section>
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
        title="Projeto"
        description="Raízes explicitamente autorizadas para leitura e escrita aprovada."
        action={
          <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
            <FolderPlus size={13} />
            Adicionar raiz
          </Button>
        }
      />
      <section className="panel mt-6 overflow-hidden">
        <div className="panel-header">
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-[14px] font-semibold">{project.name}</h3>
              <InfoTooltip
                content="O projeto agrupa conversas, execuções e pastas autorizadas. Renomear ou gerenciar projetos pode ser feito pelo menu de três pontos na barra lateral."
                label="Ajuda sobre o projeto"
              />
            </div>
            <p className="mt-0.5 text-[10px] text-text-faint">
              {project.roots.length} pasta{project.roots.length === 1 ? "" : "s"} no escopo
            </p>
          </div>
          <Badge tone="success">Local</Badge>
        </div>
        <div className="divide-y divide-border/70">
          {project.roots.map((root) => (
            <div key={root.id} className="flex items-center gap-3 px-4 py-4">
              <div className="grid size-8 place-items-center rounded-[8px] bg-success/10 text-success">
                <ShieldCheck size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold">{root.displayName}</div>
                <div
                  className="mt-1 truncate font-mono text-[10px] text-text-faint"
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
      </section>
      {add.error ? (
        <p className="mt-3 text-[10px] text-danger">
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
  return (
    <>
      <SettingsHeader
        title="Diagnósticos"
        description="Estado do runtime, cofre e integrações detectadas."
        action={
          <Button size="sm" variant="secondary" disabled={refreshing} onClick={refresh}>
            <RefreshCcw size={12} />
            Atualizar
          </Button>
        }
      />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Diagnostic label="Versão" value={`${bootstrap.app.name} ${bootstrap.app.version}`} />
        <Diagnostic label="Plataforma" value={bootstrap.app.platform} />
        <Diagnostic
          label="Cofre"
          value={`${bootstrap.vault.backend} · ${bootstrap.vault.locked ? "bloqueado" : "desbloqueado"}`}
        />
        <Diagnostic
          label="Telemetria"
          value={bootstrap.settings.telemetryEnabled ? "local ativada" : "desativada"}
        />
      </div>
      <section className="panel mt-5 overflow-hidden">
        <div className="panel-header">
          <h3 className="text-[14px] font-semibold">Provedores</h3>
          <span className="text-[10px] text-text-faint">Última verificação local</span>
        </div>
        <div className="divide-y divide-border/70">
          {bootstrap.providers.map((provider) => (
            <div
              key={provider.descriptor.id}
              className="grid grid-cols-[minmax(130px,180px)_110px_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-[11px] lg:grid-cols-[180px_110px_1fr_auto]"
            >
              <span className="font-medium text-text">{provider.descriptor.name}</span>
              <Badge tone={provider.health.status === "ready" ? "success" : "danger"}>
                {healthLabels[provider.health.status]}
              </Badge>
              <span className="truncate text-text-faint">{provider.health.message}</span>
              <span className="hidden font-mono text-[10px] text-text-faint lg:block">
                {provider.health.version ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint">
        {label}
      </div>
      <div className="mt-2 font-mono text-[12px] text-text-muted">{value}</div>
    </div>
  );
}
