import { useEffect } from "react";
import { AlertCircle, RefreshCcw, X } from "lucide-react";
import { Button } from "./button";

export function ErrorPane({
  title = "Não foi possível carregar esta tela",
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="grid h-full place-items-center p-8">
      <section className="panel page-enter w-full max-w-md p-6 text-center" role="alert">
        <div className="mx-auto grid size-11 place-items-center rounded-[12px] bg-danger/10 text-danger">
          <AlertCircle size={20} />
        </div>
        <h2 className="mt-4 text-[16px] font-semibold text-text">{title}</h2>
        <p className="mt-2 text-[12px] leading-5 text-text-muted">{message}</p>
        {onRetry ? (
          <Button className="mt-5" variant="secondary" onClick={onRetry}>
            <RefreshCcw size={14} /> Tentar novamente
          </Button>
        ) : null}
      </section>
    </div>
  );
}

export function ActionToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 5_500);
    return () => window.clearTimeout(timeout);
  }, [message, onClose]);

  return (
    <div
      className="toast-in fixed bottom-5 right-5 z-[120] flex max-w-sm items-start gap-3 rounded-[13px] border border-danger/25 bg-surface-raised px-4 py-3 shadow-[0_20px_60px_rgb(0_0_0/0.35)]"
      role="alert"
      aria-live="assertive"
    >
      <AlertCircle className="mt-0.5 shrink-0 text-danger" size={16} />
      <span className="min-w-0 flex-1 text-[12px] leading-5 text-text-muted">{message}</span>
      <button
        className="grid size-6 shrink-0 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
        onClick={onClose}
        aria-label="Fechar aviso"
      >
        <X size={13} />
      </button>
    </div>
  );
}
