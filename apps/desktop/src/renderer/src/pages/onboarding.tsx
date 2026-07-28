import { useState } from "react";
import { ArrowRight, Check, FolderOpen, HardDrive, LockKeyhole, Workflow } from "lucide-react";
import { api } from "@renderer/lib/api";
import { compactPath } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/form";
import { MaestroMark } from "@renderer/components/logo";

interface OnboardingProps {
  onCreated: () => void;
}

export function Onboarding({ onCreated }: OnboardingProps) {
  const [directory, setDirectory] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    const selected = await api().selectDirectory();
    if (!selected) return;
    setDirectory(selected);
    setName(selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Meu projeto");
  };

  const create = async () => {
    if (!directory) return;
    setBusy(true);
    setError(null);
    try {
      await api().createProject({ name: name.trim() || "Meu projeto", directory });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-0 flex-1 overflow-y-auto bg-bg p-5 md:p-8">
      <div className="onboarding-grid pointer-events-none fixed inset-0 opacity-40" />
      <div className="hero-dot-field pointer-events-none fixed inset-y-0 right-0 w-[44%] opacity-55" />
      <section className="page-enter relative z-10 m-auto grid w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-border bg-surface shadow-[0_28px_80px_-36px_rgb(0_0_0/0.52)] min-[900px]:grid-cols-[1.05fr_.95fr]">
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-primary" />
        <div className="flex flex-col justify-between border-b border-border p-7 md:p-9 min-[900px]:border-b-0 min-[900px]:border-r">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <MaestroMark className="size-11" />
              <div>
                <div className="text-[18px] font-semibold tracking-[-0.035em]">maestro</div>
                <div className="text-[11px] text-text-faint">Central local de agentes de IA</div>
              </div>
            </div>
            <h1 className="max-w-md text-[34px] font-semibold leading-[1.12] tracking-[-0.04em] text-text">
              Coordene o trabalho.
              <br />
              Mantenha o controle.
            </h1>
            <p className="mt-4 max-w-md text-[14px] leading-6 text-text-muted">
              Planeje, aprove e acompanhe agentes de IA em tempo real, sem enviar seu workspace para
              uma nuvem do Maestro.
            </p>
          </div>

          <div className="onboarding-benefits mt-10 grid gap-3 sm:grid-cols-3">
            {[
              [
                Workflow,
                "Planos antes de mudanças",
                "Revise o DAG completo antes de liberar qualquer escrita.",
              ],
              [
                LockKeyhole,
                "Permissões por pasta",
                "Somente raízes escolhidas no diálogo nativo entram no escopo.",
              ],
              [
                HardDrive,
                "Histórico local",
                "Conversas, eventos e configurações ficam neste dispositivo.",
              ],
            ].map(([Icon, title, description]) => {
              const ItemIcon = Icon as typeof Workflow;
              return (
                <div key={String(title)} className="flex gap-3">
                  <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-bg-elevated text-primary-soft">
                    <ItemIcon size={15} />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-text">{String(title)}</div>
                    <div className="mt-1 text-[10px] leading-4 text-text-faint">
                      {String(description)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col justify-center bg-bg-elevated/45 p-7 md:p-9">
          <div className="mb-6">
            <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary-soft">
              Passo 1 de 1
            </span>
            <h2 className="mt-3 text-[21px] font-semibold tracking-tight">Abra seu workspace</h2>
            <p className="mt-2 text-[13px] leading-5 text-text-muted">
              Selecione a pasta que os agentes poderão ler e, somente após aprovação, editar.
            </p>
          </div>

          {!directory ? (
            <button
              className="group flex h-40 flex-col items-center justify-center rounded-[14px] border border-dashed border-border-strong bg-bg/55 text-center transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.045]"
              onClick={() => void choose()}
            >
              <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-surface-hover text-text-muted group-hover:text-primary-soft">
                <FolderOpen size={19} />
              </div>
              <span className="text-[13px] font-medium text-text">Selecionar uma pasta</span>
              <span className="mt-1 text-[11px] text-text-faint">
                Linux ou Windows · pasta local
              </span>
            </button>
          ) : (
            <div className="rounded-[12px] border border-success/20 bg-success/[0.04] p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-success/12 text-success">
                  <Check size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-text">Pasta autorizada</div>
                  <div
                    className="mt-1 truncate font-mono text-[10px] text-text-faint"
                    title={directory}
                  >
                    {compactPath(directory, 52)}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void choose()}>
                  Trocar
                </Button>
              </div>
            </div>
          )}

          <div className="mt-5">
            <label
              htmlFor="project-name"
              className="mb-1.5 block text-[12px] font-medium text-text-muted"
            >
              Nome do projeto
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Meu projeto"
              disabled={!directory || busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
          </div>

          {error ? (
            <p className="mt-3 text-[12px] text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            className="mt-5 w-full"
            size="lg"
            disabled={!directory || !name.trim() || busy}
            onClick={() => void create()}
          >
            {busy ? "Criando…" : "Criar projeto"}
            {!busy ? <ArrowRight size={15} /> : null}
          </Button>
          <p className="mt-4 text-center text-[10px] leading-4 text-text-faint">
            Você poderá adicionar outras raízes nas configurações do projeto.
          </p>
        </div>
      </section>
    </main>
  );
}
