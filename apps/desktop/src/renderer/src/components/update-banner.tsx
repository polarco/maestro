import { useMutation } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCcw, RotateCcw } from "lucide-react";
import type { UpdateState } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { Button } from "@renderer/components/ui/button";

export function UpdateBanner({ state }: { state: UpdateState }) {
  const download = useMutation({ mutationFn: () => api().downloadUpdate() });
  const install = useMutation({ mutationFn: () => api().installUpdate() });
  if (!["available", "downloading", "downloaded", "installing"].includes(state.status)) return null;
  const systemInstaller = state.installStrategy === "system-installer";
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-primary/20 bg-primary/[0.075] px-4 py-1.5 text-[11px]">
      {state.status === "downloading" ? (
        <RefreshCcw size={12} className="animate-spin text-primary-soft" />
      ) : state.status === "downloaded" || state.status === "installing" ? (
        systemInstaller ? (
          <ExternalLink size={12} className="text-success" />
        ) : (
          <RotateCcw size={12} className="text-success" />
        )
      ) : (
        <Download size={12} className="text-primary-soft" />
      )}
      <span className="font-medium text-text">{state.message}</span>
      {state.status === "downloading" ? (
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-bg-elevated">
          <div className="h-full bg-primary" style={{ width: `${state.progress ?? 0}%` }} />
        </div>
      ) : null}
      <span className="ml-auto text-text-faint">
        atual {state.currentVersion}
        {state.availableVersion ? ` · nova ${state.availableVersion}` : ""}
      </span>
      {state.status === "available" ? (
        <Button size="sm" disabled={download.isPending} onClick={() => download.mutate()}>
          <Download size={11} /> {download.isPending ? "Iniciando…" : "Baixar"}
        </Button>
      ) : state.status === "downloaded" ? (
        <Button size="sm" disabled={install.isPending} onClick={() => install.mutate()}>
          {systemInstaller ? <ExternalLink size={11} /> : <RotateCcw size={11} />}
          {systemInstaller ? "Abrir instalador" : "Instalar e reiniciar"}
        </Button>
      ) : state.status === "installing" && systemInstaller ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={install.isPending}
          onClick={() => install.mutate()}
        >
          <ExternalLink size={11} /> Abrir novamente
        </Button>
      ) : null}
    </div>
  );
}
