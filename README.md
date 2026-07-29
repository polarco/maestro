# Maestro

Maestro é uma central desktop local-first para conversar com, planejar e coordenar agentes de IA em workspaces explicitamente selecionados.

## Estado do projeto

Este repositório contém um MVP vertical com:

- Electron seguro (renderer isolado, preload e IPC tipado);
- React, TypeScript, Tailwind e componentes no estilo shadcn/ui;
- SQLite + Drizzle com eventos append-only;
- projetos e raízes de workspace canonicalizadas;
- modos Maestro, Agente direto e Chat;
- adapters para Codex, Claude Code, Anthropic API e OpenAI-compatible;
- planos versionados, aprovação, DAG, scheduler e integração Git por worktrees;
- dashboard em tempo real e terminal PTY integrado;
- cofre via Electron `safeStorage`, com fallback por senha no Linux inseguro.

## Desenvolvimento

Requisitos: Node.js 22+, pnpm 11, ferramentas de compilação nativas para `better-sqlite3` e `node-pty`.

```bash
pnpm install
pnpm dev
```

Validação completa:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

O E2E abre o Electron real com `contextIsolation` e sandbox ativos e cobre os três modos, aprovação sem escrita prematura, streaming, terminal e histórico. Os testes unitários e de integração cobrem máquina de estados, DAG, roteamento, políticas de caminho/comando, persistência append-only, processos e fluxos Git/worktree.

Os CLIs Codex e Claude são detectados no `PATH`. O Maestro nunca lê nem copia os tokens OAuth mantidos por esses CLIs.

## Segurança

O renderer não possui acesso a Node. Pastas são escolhidas pelo diálogo nativo, canonicalizadas e associadas ao projeto. A aprovação de um plano libera somente edições e validações nas raízes selecionadas; publicação, deploy, push, elevação de privilégio e escrita externa continuam fora do escopo.

## Distribuição

Distribuições estáveis podem ser geradas com:

```bash
pnpm package:linux
pnpm package:windows
```

Para gerar metadados do canal beta, use `pnpm package:linux:beta` ou
`pnpm package:windows:beta`. O aplicativo aceita somente os canais internos
`stable` e `beta`; ambos usam exclusivamente as releases públicas de
[`polarco/maestro`](https://github.com/polarco/maestro/releases), sem URL de feed configurável.
Os canais são estritos: `stable` ignora prévias, `beta` ignora releases estáveis, e nenhum deles
aceita versões iguais ou anteriores à instalada.

Tags `vX.Y.Z` publicam o canal estável. Tags `vX.Y.Z-beta.N` publicam o canal beta. A versão da
tag precisa coincidir com `apps/desktop/package.json`; o workflow `.github/workflows/release.yml`
valida, empacota Linux e Windows e cria a release com instaladores e metadados de atualização.

Os artefatos são escritos em `release/`. O instalador Windows deve ser gerado num host Windows (ou ambiente com Wine); a CI usa runners nativos para ambos os sistemas e executa um smoke test do preload e bootstrap já empacotados. Assinatura de código deve ser configurada antes de uma distribuição pública.

## Estrutura

- `apps/desktop`: main process, preload isolado, adapters, orquestração e interface React;
- `packages/contracts`: contratos, schemas Zod, IPC e eventos normalizados;
- `packages/core`: políticas, roteamento, DAG, scheduler e normalizadores;
- `packages/database`: schema Drizzle, migração embutida e repositório SQLite.

As configurações específicas aparecem somente quando o adapter declara suporte à capacidade. Codex e Claude Code mantêm a própria autenticação; chaves de API são armazenadas no cofre local e nunca retornam ao renderer.
