import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Folder, Play, Plus, SquareTerminal, StopCircle } from "lucide-react";
import type { Project, TerminalSessionDto } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { compactPath } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/button";
import { Select } from "@renderer/components/ui/form";

export function TerminalPage({ project }: { project: Project }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionRef = useRef<TerminalSessionDto | null>(null);
  const [rootId, setRootId] = useState(project.roots[0]?.id ?? "");
  const [session, setSession] = useState<TerminalSessionDto | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new XTerm({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Geist Mono Variable", "Geist Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 10_000,
      theme: {
        background: "#181611",
        foreground: "#e7e3d9",
        cursor: "#fb4137",
        selectionBackground: "#5b2e27",
        black: "#201d17",
        red: "#f17878",
        green: "#69c9a7",
        yellow: "#efb65d",
        blue: "#70b7d6",
        magenta: "#ff8d86",
        cyan: "#7cc9c0",
        white: "#f4f3ee",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminal.write(
      "\x1b[38;5;203mMaestro Terminal\x1b[0m\r\nSelecione uma raiz e inicie uma sessão PTY.\r\n",
    );
    terminalRef.current = terminal;
    const fitAndResize = () => {
      fit.fit();
      const current = sessionRef.current;
      if (current) void api().resizeTerminal(current.id, terminal.cols, terminal.rows);
    };
    const frame = requestAnimationFrame(fitAndResize);
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);
    const input = terminal.onData((data) => {
      const current = sessionRef.current;
      if (current) void api().writeTerminal(current.id, data);
    });
    const unsubscribe = api().onTerminalEvent((event) => {
      if (event.sessionId !== sessionRef.current?.id) return;
      if (event.type === "data" && event.data) terminal.write(event.data);
      if (event.type === "exit") {
        setExited(event.exitCode ?? -1);
        setSession(null);
        sessionRef.current = null;
        terminal.write(
          `\r\n\x1b[38;5;244m[processo encerrado: ${event.exitCode ?? "sinal"}]\x1b[0m\r\n`,
        );
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      unsubscribe();
      const current = sessionRef.current;
      if (current) void api().killTerminal(current.id);
      sessionRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sessionRef.current) setRootId(project.roots[0]?.id ?? "");
  }, [project.id]);

  const start = async () => {
    if (!rootId || sessionRef.current) return;
    setStarting(true);
    setError(null);
    setExited(null);
    try {
      const value = await api().createTerminal(project.id, rootId);
      sessionRef.current = value;
      setSession(value);
      terminalRef.current?.clear();
      terminalRef.current?.focus();
      if (terminalRef.current) {
        await api().resizeTerminal(value.id, terminalRef.current.cols, terminalRef.current.rows);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    const current = sessionRef.current;
    if (!current) return;
    setError(null);
    try {
      await api().killTerminal(current.id);
      sessionRef.current = null;
      setSession(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  return (
    <div className="page-enter flex h-full min-w-0 flex-col bg-bg">
      <header className="flex min-h-[66px] shrink-0 items-center gap-3 border-b border-border bg-bg/90 px-4 py-2.5 md:px-5">
        <div className="grid size-9 place-items-center rounded-[10px] border border-info/20 bg-info/10 text-info">
          <SquareTerminal size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] font-semibold">Terminal</h1>
          <p className="mt-0.5 text-[10px] text-text-faint">
            Sessão PTY completa, distinta das execuções estruturadas
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-2.5">
          <Folder size={12} className="text-text-faint" />
          <Select
            className="h-9 max-w-52 border-0 bg-transparent px-0 focus:bg-transparent focus:ring-0"
            value={rootId}
            disabled={Boolean(session)}
            onChange={(event) => setRootId(event.target.value)}
            aria-label="Raiz do terminal"
          >
            {project.roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.displayName}
              </option>
            ))}
          </Select>
        </div>
        {session ? (
          <Button variant="danger" size="sm" onClick={() => void stop()}>
            <StopCircle size={13} />
            Encerrar
          </Button>
        ) : (
          <Button size="sm" disabled={!rootId || starting} onClick={() => void start()}>
            {exited === null ? <Play size={13} /> : <Plus size={13} />}
            {starting ? "Iniciando…" : exited === null ? "Iniciar sessão" : "Nova sessão"}
          </Button>
        )}
      </header>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-4 font-mono text-[10px] text-text-faint">
        <span
          className={`size-1.5 rounded-full ${session ? "bg-success shadow-[0_0_8px_rgb(105_201_167/0.65)]" : "bg-text-faint"}`}
        />
        <span>{session ? session.shell : "PTY inativo"}</span>
        <span>·</span>
        <span className="truncate" title={session?.cwd}>
          {session
            ? compactPath(session.cwd, 90)
            : project.roots.find((root) => root.id === rootId)?.canonicalPath}
        </span>
        {exited !== null ? <span className="ml-auto">exit {exited}</span> : null}
      </div>
      {error ? (
        <div
          className="border-b border-danger/20 bg-danger/[0.05] px-4 py-2 text-[11px] text-danger"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <div ref={hostRef} className="min-h-0 flex-1 bg-[#181611]" aria-label="Terminal interativo" />
    </div>
  );
}
