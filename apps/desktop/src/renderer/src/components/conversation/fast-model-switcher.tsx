import { useEffect, useMemo, useRef, useState } from "react";
import { BrainCircuit, Check, Clock3, Eye, Search, Zap } from "lucide-react";
import type {
  ProviderConnectionSummary,
  ProviderModel,
  ProviderSummary,
  RunMode,
} from "@maestro/contracts";
import { cn } from "@renderer/lib/utils";

const RECENT_MODELS_KEY = "maestro.fast-model-recent";

export interface FastModelSelection {
  providerId: string;
  modelId: string;
  connectionId?: string;
}

interface ModelOption extends FastModelSelection {
  key: string;
  providerName: string;
  connectionName: string | null;
  model: ProviderModel;
}

interface FastModelSwitcherProps {
  open: boolean;
  mode: RunMode;
  providers: ProviderSummary[];
  connections: ProviderConnectionSummary[];
  current: FastModelSelection | null;
  automatic: boolean;
  allowImmediate?: boolean;
  onSelectAuto: () => void;
  onSelect: (selection: FastModelSelection, timing: "next_checkpoint" | "immediate") => void;
  onClose: () => void;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function optionKey(selection: FastModelSelection): string {
  return `${selection.providerId}:${selection.connectionId ?? "-"}:${selection.modelId}`;
}

function contextLabel(model: ProviderModel): string {
  const context = model.capabilities.contextWindow;
  if (!context) return "janela automática";
  return context >= 1_000_000
    ? `${Math.round(context / 1_000_000)}M tokens`
    : `${Math.round(context / 1_000)}k tokens`;
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_MODELS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function FastModelSwitcher({
  open,
  mode,
  providers,
  connections,
  current,
  automatic,
  allowImmediate = false,
  onSelectAuto,
  onSelect,
  onClose,
}: FastModelSwitcherProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [timing, setTiming] = useState<"next_checkpoint" | "immediate">("next_checkpoint");
  const [recent, setRecent] = useState<string[]>(readRecent);

  const options = useMemo<ModelOption[]>(() => {
    return providers.flatMap((provider): ModelOption[] => {
      if (provider.descriptor.kind !== "cli")
        return provider.models.map((model) => ({
          key: optionKey({ providerId: provider.descriptor.id, modelId: model.id }),
          providerId: provider.descriptor.id,
          modelId: model.id,
          providerName: provider.descriptor.name,
          connectionName: null,
          model,
        }));

      const accounts = connections.filter(
        (item) =>
          item.connection.providerId === provider.descriptor.id &&
          item.connection.enabled &&
          item.health.status === "ready",
      );
      return accounts.flatMap((account) => {
        const models = account.models.length > 0 ? account.models : provider.models;
        return models.map((model) => ({
          key: optionKey({
            providerId: provider.descriptor.id,
            connectionId: account.connection.id,
            modelId: model.id,
          }),
          providerId: provider.descriptor.id,
          connectionId: account.connection.id,
          modelId: model.id,
          providerName: provider.descriptor.name,
          connectionName: account.connection.name,
          model,
        }));
      });
    });
  }, [connections, providers]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const matches = needle
      ? options.filter((option) =>
          normalize(
            [
              option.model.name,
              option.model.id,
              option.providerName,
              option.connectionName,
              option.model.description,
            ]
              .filter(Boolean)
              .join(" "),
          ).includes(needle),
        )
      : options;
    if (needle) return matches;
    const recentOrder = new Map(recent.map((key, index) => [key, index]));
    return [...matches].sort((left, right) => {
      const leftCurrent = current && left.key === optionKey(current) ? -1 : 0;
      const rightCurrent = current && right.key === optionKey(current) ? -1 : 0;
      if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;
      const leftRecent = recentOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = recentOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      return leftRecent - rightRecent;
    });
  }, [current, options, query, recent]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    setTiming("next_checkpoint");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  const choose = (option: ModelOption) => {
    const nextRecent = [option.key, ...recent.filter((key) => key !== option.key)].slice(0, 8);
    setRecent(nextRecent);
    window.localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(nextRecent));
    onSelect(
      {
        providerId: option.providerId,
        modelId: option.modelId,
        ...(option.connectionId ? { connectionId: option.connectionId } : {}),
      },
      allowImmediate ? timing : "next_checkpoint",
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((value) => (visible.length ? (value + 1) % visible.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((value) =>
          visible.length ? (value - 1 + visible.length) % visible.length : 0,
        );
      } else if (event.key === "Enter" && visible[selected]) {
        event.preventDefault();
        choose(visible[selected]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allowImmediate, open, onClose, recent, selected, timing, visible]);

  if (!open) return null;
  const currentKey = current ? optionKey(current) : null;
  const showAutomatic =
    mode === "maestro" &&
    (!query.trim() ||
      normalize("Auto roteamento rápido econômico profundo").includes(normalize(query.trim())));

  return (
    <div
      className="command-backdrop fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Troca rápida de modelo"
        className="glass-popover page-enter w-full max-w-[680px] overflow-hidden rounded-[18px]"
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-primary/25 bg-primary/10 text-primary-soft">
            <Zap size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <input
              ref={inputRef}
              className="h-7 w-full border-0 bg-transparent text-[14px] font-medium text-text outline-none placeholder:text-text-faint"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar modelo, provedor ou conta…"
              aria-label="Buscar modelo"
            />
            <p className="truncate text-[9.5px] text-text-faint">
              A troca preserva a conversa com um handoff local otimizado.
            </p>
          </div>
          <kbd className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[9px] text-text-faint">
            Esc
          </kbd>
        </div>

        <div className="max-h-[470px] overflow-y-auto p-2">
          {showAutomatic ? (
            <button
              type="button"
              className={cn(
                "mb-1 flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                automatic
                  ? "border-primary/25 bg-primary/[0.09]"
                  : "border-transparent hover:bg-surface-hover",
              )}
              onClick={onSelectAuto}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-primary/20 bg-primary/[0.08] text-primary-soft">
                <Zap size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-text">
                  Auto
                  {automatic ? (
                    <span className="rounded-full border border-success/20 bg-success/[0.07] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-success">
                      atual
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-text-faint">
                  Seleciona por capacidade e qualidade; depois otimiza o perfil configurado.
                </span>
              </span>
              <span className="grid size-6 shrink-0 place-items-center text-success">
                {automatic ? <Check size={13} /> : null}
              </span>
            </button>
          ) : null}
          {visible.length > 0 ? (
            visible.map((option, index) => {
              const isCurrent = option.key === currentKey;
              const isRecent = recent.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition-colors",
                    selected === index
                      ? "border-primary/20 bg-primary/[0.09]"
                      : "hover:bg-surface-hover",
                  )}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => choose(option)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-bg-elevated text-text-muted">
                    <BrainCircuit size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-text">
                        {option.model.name}
                      </span>
                      {isCurrent ? (
                        <span className="rounded-full border border-success/20 bg-success/[0.07] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-success">
                          atual
                        </span>
                      ) : isRecent ? (
                        <Clock3 size={10} className="shrink-0 text-text-faint" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-text-faint">
                      {option.providerName}
                      {option.connectionName ? ` · ${option.connectionName}` : ""} ·{" "}
                      {option.model.id}
                    </span>
                  </span>
                  <span className="hidden items-center gap-2 text-[9px] text-text-faint sm:flex">
                    {option.model.capabilities.vision ? (
                      <span className="flex items-center gap-1" title="Aceita imagens">
                        <Eye size={10} /> visão
                      </span>
                    ) : null}
                    <span>{contextLabel(option.model)}</span>
                  </span>
                  <span className="grid size-6 shrink-0 place-items-center text-success">
                    {isCurrent ? <Check size={13} /> : null}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <span className="grid size-11 place-items-center rounded-[12px] bg-surface-hover text-text-faint">
                <Search size={18} />
              </span>
              <p className="mt-3 text-[13px] font-medium text-text">Nenhum modelo encontrado</p>
              <p className="mt-1 text-[10px] text-text-faint">
                Verifique a busca ou conecte outra conta nas configurações.
              </p>
            </div>
          )}
        </div>

        <footer className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-bg-elevated/55 px-4 py-2 text-[9.5px] text-text-faint">
          <span>↑↓ navegar</span>
          <span>↵ trocar</span>
          {allowImmediate && mode === "maestro" ? (
            <span className="flex items-center gap-1 rounded-lg border border-border bg-bg px-1 py-1">
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  timing === "next_checkpoint"
                    ? "bg-primary/10 text-primary-soft"
                    : "hover:text-text",
                )}
                onClick={() => setTiming("next_checkpoint")}
              >
                próximo checkpoint
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  timing === "immediate" ? "bg-primary/10 text-primary-soft" : "hover:text-text",
                )}
                onClick={() => setTiming("immediate")}
                title="Cancela a sessão atual e retoma somente se houver checkpoint seguro"
              >
                cancelar e continuar
              </button>
            </span>
          ) : null}
          <span className="ml-auto">
            {mode === "chat" ? "Chat sem ferramentas" : "Contexto preservado"}
          </span>
        </footer>
      </section>
    </div>
  );
}
