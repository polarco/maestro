import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { Button } from "./button";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-[520px]",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal-content ${width}`}>
          <header className="flex items-start gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[16px] font-semibold text-text">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[11px] leading-4 text-text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-[9px] text-text-faint hover:bg-surface-hover hover:text-text"
                aria-label="Fechar"
              >
                <X size={15} />
              </button>
            </Dialog.Close>
          </header>
          <div className="p-5">{children}</div>
          {footer ? (
            <footer className="flex items-center justify-end gap-2 border-t border-border bg-bg-elevated/45 px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content className="modal-content max-w-[460px] p-5">
          <AlertDialog.Title className="text-[16px] font-semibold text-text">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[12px] leading-5 text-text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant="danger"
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  setPending(true);
                  void Promise.resolve(onConfirm())
                    .then(() => onOpenChange(false))
                    .catch(() => {})
                    .finally(() => setPending(false));
                }}
              >
                {pending ? "Processando…" : confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
