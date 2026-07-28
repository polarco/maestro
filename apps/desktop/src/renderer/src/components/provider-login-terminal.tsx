import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RefreshCcw, X } from "lucide-react";
import type { ProviderConnectionSummary, TerminalSessionDto } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { Button } from "@renderer/components/ui/button";

export function ProviderLoginTerminal({
  account,
  onClose,
  onFinished,
}: {
  account: ProviderConnectionSummary;
  onClose: () => void;
  onFinished: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionRef = useRef<TerminalSessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 4_000,
      theme: {
        background: "#0b0d12",
        foreground: "#d8dbe2",
        cursor: "#aaa7ff",
        selectionBackground: "#353363",
        red: "#ef6a7a",
        green: "#43c59e",
        yellow: "#e8ad55",
        blue: "#59b8e8",
        magenta: "#aaa7ff",
        cyan: "#65d6ce",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminal.write(
      `\x1b[38;5;141mConectando ${account.connection.name}\x1b[0m\r\n` +
        "Este fluxo aceita somente a assinatura oficial; o Maestro não recebe seus tokens.\r\n\r\n",
    );
    terminalRef.current = terminal;
    const resize = () => {
      fit.fit();
      if (sessionRef.current)
        void api().resizeTerminal(sessionRef.current.id, terminal.cols, terminal.rows);
    };
    const frame = requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const input = terminal.onData((data) => {
      if (sessionRef.current) void api().writeTerminal(sessionRef.current.id, data);
    });
    const unsubscribe = api().onTerminalEvent((event) => {
      if (event.sessionId !== sessionRef.current?.id) return;
      if (event.type === "data" && event.data) terminal.write(event.data);
      if (event.type === "exit") {
        sessionRef.current = null;
        setExited(true);
        terminal.write("\r\n\x1b[38;5;244m[fluxo de login encerrado]\x1b[0m\r\n");
        onFinished();
      }
    });
    void api()
      .loginProviderConnection(account.connection.id)
      .then(async (session) => {
        sessionRef.current = session;
        terminal.focus();
        await api().resizeTerminal(session.id, terminal.cols, terminal.rows);
      })
      .catch((value) => {
        const message = value instanceof Error ? value.message : String(value);
        setError(message);
        terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      unsubscribe();
      if (sessionRef.current) void api().killTerminal(sessionRef.current.id);
      sessionRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [account.connection.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-8">
      <section className="flex h-[560px] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] border border-border bg-surface-raised shadow-2xl">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <span
            className={`size-2 rounded-full ${exited ? "bg-text-faint" : "animate-pulse bg-info"}`}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-semibold">{account.connection.name}</h3>
            <p className="text-[9px] text-text-faint">
              {account.connection.providerId === "codex"
                ? "Codex · assinatura ChatGPT"
                : "Claude Code · assinatura Claude.ai"}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>
            <X size={12} /> Fechar
          </Button>
        </header>
        {error ? (
          <div className="border-b border-danger/20 bg-danger/[0.05] px-4 py-2 text-[10px] text-danger">
            {error}
          </div>
        ) : null}
        <div ref={hostRef} className="min-h-0 flex-1 bg-[#0b0d12] p-2" />
        <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-4 text-[9px] text-text-faint">
          <RefreshCcw size={10} /> Após concluir no navegador, aguarde o processo encerrar e use
          “Verificar”.
        </footer>
      </section>
    </div>
  );
}
