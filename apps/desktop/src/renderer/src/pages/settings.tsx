import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CreditCard,
  FolderPlus,
  KeyRound,
  Link2,
  LockKeyhole,
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
  Project,
  ProviderConfigField,
  ProviderConnectionSummary,
  ProviderSummary,
} from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { compactPath, providerInitials } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { FieldLabel, Input, Select } from "@renderer/components/ui/form";
import { Switch } from "@renderer/components/ui/switch";
import { ThemePicker } from "@renderer/components/ui/theme-switcher";
import { ProviderLoginTerminal } from "@renderer/components/provider-login-terminal";
import { applyTheme } from "@renderer/lib/theme";

type SettingsTab = "connections" | "general" | "project" | "diagnostics";

const healthLabels: Record<ProviderSummary["health"]["status"], string> = {
  ready: "Pronto",
  unavailable: "Indisponível",
  unauthenticated: "Não conectado",
  degraded: "Instável",
  checking: "Verificando",
};

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
                description="Trabalhadores usam somente assinaturas isoladas. API paga é exclusiva do orquestrador."
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
              <SubscriptionAccounts
                bootstrap={bootstrap}
                onBootstrap={onBootstrap}
                onLogin={setLoginConnectionId}
              />
              <div className="mt-7">
                <h3 className="text-[13px] font-semibold">Executáveis e API do orquestrador</h3>
                <p className="mt-1 text-[10px] text-text-faint">
                  Configurações de API nunca são usadas por chat, agente direto ou tarefas do DAG.
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
  );
}

function SubscriptionAccounts({
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
  });
  const remove = useMutation({
    mutationFn: (connectionId: string) => api().deleteProviderConnection(connectionId),
    onSuccess: reload,
  });

  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold">Contas por assinatura</h3>
            <Badge tone="success">sem limite artificial</Badge>
          </div>
          <p className="mt-1 text-[10px] text-text-faint">
            Cada conta possui diretório e processo próprios; tokens continuam sob controle do CLI.
          </p>
        </div>
        <div className="hidden items-center gap-2 text-[10px] text-success sm:flex">
          <CreditCard size={11} /> somente assinatura
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {bootstrap.providerConnections.map((account) => (
          <SubscriptionAccountRow
            key={account.connection.id}
            account={account}
            busy={update.isPending || remove.isPending}
            onLogin={() => onLogin(account.connection.id)}
            onUpdate={(values) => update.mutate({ connectionId: account.connection.id, ...values })}
            onDelete={() => remove.mutate(account.connection.id)}
          />
        ))}
      </div>
      <div className="border-t border-warning/20 bg-warning/[0.035] px-4 py-3 text-[10px] leading-4 text-warning">
        Para garantia total, desative “usage credits/extra usage” em cada conta no próprio
        Claude/ChatGPT. O Maestro remove chaves e gateways, nunca compra créditos nem faz fallback
        pago, mas não pode alterar esse controle do servidor.
      </div>
      <div className="grid gap-2 border-t border-border bg-bg-elevated/30 p-3 sm:grid-cols-[150px_1fr_auto]">
        <Select
          value={providerId}
          onChange={(event) => setProviderId(event.target.value as "codex" | "claude-code")}
        >
          <option value="claude-code">Claude</option>
          <option value="codex">Codex</option>
        </Select>
        <Input
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
      {create.error || update.error || remove.error ? (
        <p className="border-t border-danger/20 bg-danger/[0.04] px-4 py-2 text-[10px] text-danger">
          {String(create.error ?? update.error ?? remove.error)}
        </p>
      ) : null}
    </section>
  );
}

function SubscriptionAccountRow({
  account,
  busy,
  onLogin,
  onUpdate,
  onDelete,
}: {
  account: ProviderConnectionSummary;
  busy: boolean;
  onLogin: () => void;
  onUpdate: (values: {
    name?: string;
    enabled?: boolean;
    priority?: number;
    concurrencyLimit?: number;
  }) => void;
  onDelete: () => void;
}) {
  const { connection, health } = account;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tone =
    health.status === "ready"
      ? "success"
      : health.status === "unauthenticated"
        ? "warning"
        : "danger";
  const healthLabel = healthLabels[health.status];
  return (
    <div className={`px-4 py-4 ${connection.enabled ? "" : "opacity-55"}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 lg:grid-cols-[auto_minmax(200px,1fr)_auto]">
        <div className="grid size-9 place-items-center rounded-[10px] border border-border bg-bg-elevated text-[10px] font-semibold text-primary-soft">
          {connection.providerId === "codex" ? "CX" : "CL"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 max-w-52 rounded-md border-0 bg-transparent px-1 text-[12px] font-semibold text-text outline-none focus:ring-1 focus:ring-primary/30"
              defaultValue={connection.name}
              aria-label="Nome da conta"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== connection.name) onUpdate({ name: value });
              }}
            />
            <Badge tone={tone}>{healthLabel}</Badge>
            {connection.isDefault ? <Badge tone="neutral">perfil atual</Badge> : null}
            <Badge tone="success">assinatura</Badge>
          </div>
          <p
            className="mt-1 truncate text-[10px] text-text-faint"
            title={connection.stateDirectory ?? undefined}
          >
            {health.message} ·{" "}
            {connection.stateDirectory
              ? compactPath(connection.stateDirectory, 72)
              : "diretório padrão do CLI"}
          </p>
        </div>
        <div className="col-span-2 ml-12 flex flex-wrap items-end gap-2 lg:col-span-1 lg:ml-0">
          <label className="text-[9px] font-semibold uppercase tracking-wide text-text-faint">
            prioridade
            <Input
              className="mt-1 h-7 w-16"
              type="number"
              min={0}
              max={10_000}
              defaultValue={connection.priority}
              onBlur={(event) =>
                onUpdate({ priority: Math.max(0, event.target.valueAsNumber || 0) })
              }
            />
          </label>
          <label className="text-[9px] font-semibold uppercase tracking-wide text-text-faint">
            sessões
            <Input
              className="mt-1 h-7 w-16"
              type="number"
              min={1}
              max={16}
              defaultValue={connection.concurrencyLimit}
              onBlur={(event) =>
                onUpdate({
                  concurrencyLimit: Math.max(1, Math.min(16, event.target.valueAsNumber || 1)),
                })
              }
            />
          </label>
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
  if (field.type === "boolean")
    return (
      <div className="flex items-center gap-3 rounded-[9px] border border-border bg-bg-elevated p-3 transition-colors hover:border-border-strong">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-text">{field.label}</span>
          {field.description ? (
            <span className="mt-1 block text-[10px] leading-4 text-text-faint">
              {field.description}
            </span>
          ) : null}
        </span>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    );
  return (
    <div>
      <FieldLabel>
        {field.label}
        {field.required ? " *" : ""}
      </FieldLabel>
      {field.type === "select" ? (
        <Select
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
            <FieldLabel>Aparência</FieldLabel>
            <ThemePicker
              value={settings.theme}
              onValueChange={(theme) => setSettings({ ...settings, theme })}
            />
            <p className="mt-2 text-[10px] text-text-faint">
              A prévia é instantânea. Salve as preferências para manter a escolha.
            </p>
          </div>
          <div>
            <FieldLabel>Idioma</FieldLabel>
            <Select
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
            <FieldLabel>Modo padrão</FieldLabel>
            <Select
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
            <FieldLabel>Concorrência global (1–16)</FieldLabel>
            <Input
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
            <FieldLabel>Roteamento entre assinaturas</FieldLabel>
            <Select
              className="w-full"
              value={settings.subscriptionRouting}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  subscriptionRouting: event.target.value as AppSettings["subscriptionRouting"],
                })
              }
            >
              <option value="least-active">Menor carga (recomendado)</option>
              <option value="round-robin">Alternar contas</option>
              <option value="priority">Preencher por prioridade</option>
            </Select>
          </div>
          <div>
            <FieldLabel>Canal de atualização</FieldLabel>
            <Select
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
                : "Receba prévias antecipadas e também versões estáveis."}
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
            <span className="block text-[12px] font-semibold">Telemetria local</span>
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
            <span className="block text-[12px] font-semibold">
              Verificar atualizações automaticamente
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
            <h3 className="text-[14px] font-semibold">{project.name}</h3>
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
              <Badge tone={root.writable ? "warning" : "neutral"}>
                {root.writable ? "escrita após aprovação" : "somente leitura"}
              </Badge>
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
