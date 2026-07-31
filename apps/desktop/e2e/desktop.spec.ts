import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function structuredResponse(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const combined = JSON.stringify(messages);
  if (combined.includes("descoberta colaborativa do Maestro")) {
    const deliverableAligned = combined.includes("Mudança no produto existente");
    const surfaceAligned = combined.includes("Na conversa principal");
    const persistenceAligned = combined.includes("Persistir após reiniciar");
    const approvalAligned = combined.includes("Somente após aprovação");
    const questions = !deliverableAligned
      ? [
          {
            id: "deliverable",
            question: "Qual deve ser a entrega real deste cenário?",
            reason: "A resposta impede que o formato seja decidido sem o usuário.",
            options: ["Mudança no produto existente", "Protótipo visual"],
          },
        ]
      : !surfaceAligned
        ? [
            {
              id: "surface",
              question: "Onde o acompanhamento deve aparecer?",
              reason: "A superfície muda a experiência e a arquitetura da solução.",
              options: ["Na conversa principal", "Em uma tela separada"],
            },
          ]
        : !persistenceAligned
          ? [
              {
                id: "persistence",
                question: "O histórico dos agentes deve sobreviver ao reinício?",
                reason: "Isso define se as mensagens precisam ser persistidas.",
                options: ["Persistir após reiniciar", "Somente durante a execução"],
              },
            ]
          : !approvalAligned
            ? [
                {
                  id: "approval",
                  question: "Quando os agentes podem começar a editar?",
                  reason: "Essa decisão controla a barreira de segurança do fluxo.",
                  options: ["Somente após aprovação", "Assim que o brief estiver pronto"],
                },
              ]
            : [];
    return JSON.stringify({
      understanding: "O usuário quer validar o fluxo colaborativo do Maestro no produto real.",
      desiredOutcome: "Concluir o cenário E2E sem trocar a entrega por uma demonstração.",
      deliverable: approvalAligned
        ? "Mudança funcional no produto existente"
        : "Decisões da entrega ainda em alinhamento",
      audience: "Usuários do Maestro",
      constraints: ["Preservar o arquivo sentinela."],
      assumptions: [],
      requiredCapabilities: ["pesquisa no workspace", "implementação", "validação"],
      researchTopics: ["estrutura do workspace", "fluxo do Maestro"],
      questions,
    });
  }
  if (combined.includes("etapa de pesquisa e síntese do Maestro")) {
    return JSON.stringify({
      summary: "Validar no produto real o fluxo colaborativo e auditável do Maestro.",
      deliverable: "Mudança funcional no produto existente",
      userDecisions: ["Não substituir a entrega por um protótipo."],
      findings: [
        {
          title: "Workspace isolado",
          detail: "O arquivo sentinela delimita o cenário sem alterações de produto.",
          source: "sentinel.txt",
        },
      ],
      scope: ["Executar e validar a fixture local."],
      outOfScope: ["Publicação externa."],
      successCriteria: ["O cenário conclui e preserva o arquivo sentinela."],
      remainingRisks: [],
      researchLimits: ["A pesquisa está limitada ao workspace e ao contexto fornecido."],
    });
  }
  if (combined.includes("analista do Maestro")) {
    return JSON.stringify({
      objective: "Validar o fluxo E2E do Maestro",
      risks: ["Ambiente de teste isolado"],
      requiredCapabilities: ["coding", "validation"],
      recommendedPlanner: { providerId: "codex", modelId: "fixture", effort: "medium" },
      rationale: "Roteamento determinístico para o provedor fixture.",
    });
  }
  return JSON.stringify({
    summary: "Executar o cenário E2E local",
    assumptions: ["O workspace de teste está isolado."],
    risks: [],
    successCriteria: ["O cenário termina sem alterar o arquivo sentinela."],
    tasks: [
      {
        key: "fixture",
        title: "Executar fixture",
        description: "Responder pelo provedor local.",
        role: "implementer",
        dependencies: [],
        successCriteria: ["A fixture responde."],
        validationCommands: [],
        recommendedModel: { providerId: "codex", modelId: "fixture", effort: "medium" },
      },
    ],
  });
}

async function startApiFixture(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (body.stream === true) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        response.write(
          `data: ${JSON.stringify({ id: "chat-fixture", model: "fixture-chat", choices: [{ delta: { content: "Olá do " } }] })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({ id: "chat-fixture", model: "fixture-chat", choices: [{ delta: { content: "chat E2E." } }] })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
        return;
      }
      const content = body.response_format ? structuredResponse(body) : "Olá do chat E2E.";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "fixture-response",
          model: "fixture-chat",
          choices: [{ message: { role: "assistant", content } }],
          usage: { prompt_tokens: 12, completion_tokens: 8 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API fixture did not bind to TCP.");
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
}

async function waitForRun(
  page: Page,
  state: "awaiting_clarification" | "awaiting_approval" | "completed",
): Promise<string> {
  return page.evaluate(async (target) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const bootstrap = await window.maestro.bootstrap();
      const conversation = bootstrap.recentConversations[0];
      if (conversation) {
        const detail = await window.maestro.getConversation(conversation.id);
        const run = detail.runs[0];
        if (run?.state === target) return run.id;
        if (run?.state === "failed") throw new Error(run.error ?? "Run failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Run did not reach ${target}`);
  }, state);
}

// Playwright requires the first callback argument to be an object destructuring pattern.
// eslint-disable-next-line no-empty-pattern
test("Maestro, agente, chat e terminal funcionam no Electron isolado", async ({}, testInfo) => {
  test.skip(
    process.platform === "win32",
    "A fixture de CLI deste teste é POSIX; Windows possui smoke próprio no CI.",
  );
  const workspace = await mkdtemp(path.join(tmpdir(), "maestro-e2e-workspace-"));
  const userData = await mkdtemp(path.join(tmpdir(), "maestro-e2e-profile-"));
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "maestro-e2e-provider-"));
  const sentinel = path.join(workspace, "sentinel.txt");
  const fakeCodex = path.join(fixtureDirectory, "codex-fixture");
  await writeFile(sentinel, "do not change\n", "utf8");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const command = args[0] === "-c" ? args.slice(2) : args;
if (command[0] === "--version") process.stdout.write("codex-cli 0.0.0-e2e\\n");
else if (command[0] === "login" && command[1] === "status") process.stdout.write("Logged in using ChatGPT\\n");
else if (command[0] === "debug") process.stdout.write(JSON.stringify({ models: [
  { slug: "fixture", display_name: "Fixture Codex", isDefault: true, context_window: 128000, supported_reasoning_levels: [{ effort: "medium" }] },
  { slug: "fixture-fast", display_name: "Fixture Codex Fast", context_window: 64000, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] }
] }));
else if (command[0] === "exec") {
  const prompt = command.at(-1) || "";
  const answer = prompt.includes("Continue no modelo rápido") && prompt.includes("<context_handoff")
    ? "Fast-switch com contexto recebido."
    : prompt.includes("conteúdo anexado E2E")
    ? "Contexto anexado recebido."
    : prompt.includes("Diga olá")
      ? "Olá do chat E2E."
      : "Direct agent fixture complete.";
  const answers = prompt.includes("Brief consolidado e aprovado:")
    ? ["Agente fixture: contexto recebido.", "Agente fixture: tarefa concluída."]
    : [answer];
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "e2e-thread" }) + "\\n");
  for (const [index, text] of answers.entries())
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { id: "answer-" + index, type: "agent_message", text } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }) + "\\n");
} else process.exitCode = 1;
`,
    { encoding: "utf8", mode: 0o755 },
  );
  const apiFixture = await startApiFixture();
  let application: ElectronApplication | null = null;
  try {
    application = await electron.launch({
      cwd: desktopDirectory,
      args: [
        ".",
        "--no-sandbox",
        "--headless",
        "--ozone-platform=headless",
        "--disable-gpu",
        `--user-data-dir=${userData}`,
      ],
      env: {
        ...process.env,
        MAESTRO_E2E_WORKSPACE: workspace,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(
      async ({ directory, codexExecutable, endpoint }) => {
        const initial = await window.maestro.bootstrap();
        if (initial.vault.locked) await window.maestro.unlockVault("maestro-e2e-vault");
        await window.maestro.createProject({ name: "Projeto E2E", directory });
        await window.maestro.configureProvider({
          providerId: "codex",
          values: { executable: codexExecutable },
        });
        await window.maestro.configureProvider({
          providerId: "openai-compatible",
          values: { baseUrl: endpoint, model: "fixture-chat", structuredOutput: true },
        });
        await window.maestro.updateSettings({
          defaultMode: "maestro",
          defaultModels: {
            maestro: { providerId: "openai-compatible", modelId: "fixture-chat", effort: "medium" },
            analyst: { providerId: "openai-compatible", modelId: "fixture-chat", effort: "medium" },
            planner: { providerId: "codex", modelId: "fixture", effort: "medium" },
            implementer: { providerId: "codex", modelId: "fixture", effort: "medium" },
            reviewer: { providerId: "codex", modelId: "fixture", effort: "medium" },
          },
        });
      },
      { directory: workspace, codexExecutable: fakeCodex, endpoint: apiFixture.url },
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.reload(),
    );
    await expect(page.getByRole("heading", { name: "Projeto E2E" })).toBeVisible();
    await page.getByRole("button", { name: "Mais ações para o projeto Projeto E2E" }).click();
    await expect(page.getByRole("menuitem", { name: "Renomear projeto…" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Gerenciar pastas…" })).toBeVisible();
    await page.keyboard.press("Escape");

    const draftLifecycle = await page.evaluate(async () => {
      const bootstrap = await window.maestro.bootstrap();
      const project = bootstrap.projects.find((item) => item.id === bootstrap.activeProjectId)!;
      const input = {
        projectId: project.id,
        mode: "chat" as const,
        sessionKind: "structured" as const,
        workspaceRootId: project.roots[0]!.id,
      };
      const first = await window.maestro.createConversation(input);
      const second = await window.maestro.createConversation(input);
      const recentCount = (await window.maestro.bootstrap()).recentConversations.length;
      const historyCount = (await window.maestro.listConversations(project.id, 500)).length;
      await window.maestro.deleteConversation(first.id);
      const deleted = await window.maestro
        .getConversation(first.id)
        .then(() => false)
        .catch(() => true);
      return { sameDraft: first.id === second.id, recentCount, historyCount, deleted };
    });
    expect(draftLifecycle).toEqual({
      sameDraft: true,
      recentCount: 0,
      historyCount: 0,
      deleted: true,
    });

    await page.getByRole("button", { name: "Nova conversa" }).first().click();
    const maestroComposer = page.getByPlaceholder("Descreva o resultado que você quer…");
    await page.getByRole("button", { name: /Investigue e corrija os testes que falham/ }).click();
    await expect(maestroComposer).toHaveText("Investigue e corrija os testes que falham");
    await expect(maestroComposer).toBeFocused();
    await maestroComposer.fill("Execute o fluxo Maestro E2E");
    await page.getByRole("button", { name: "Enviar" }).click();
    const runId = await waitForRun(page, "awaiting_clarification");
    await expect(page.getByText("Preciso alinhar com você")).toBeVisible();
    await expect(
      page.getByText("Qual deve ser a entrega real deste cenário?", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mudança no produto existente", exact: true }).click();
    const clarificationComposer = page.getByPlaceholder("Responda às dúvidas do Maestro…");
    await expect(clarificationComposer).toContainText("Mudança no produto existente");
    await page.getByRole("button", { name: "Responder", exact: true }).click();

    await expect(
      page.getByText("Onde o acompanhamento deve aparecer?", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Na conversa principal", exact: true }).click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();

    await expect(
      page
        .getByText("O histórico dos agentes deve sobreviver ao reinício?", { exact: true })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Persistir após reiniciar", exact: true }).click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();

    await expect(
      page.getByText("Quando os agentes podem começar a editar?", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Rodada 4 · conforme necessário", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Somente após aprovação", exact: true }).click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();

    expect(await waitForRun(page, "awaiting_approval")).toBe(runId);
    await expect(page.getByText("Workspace estudado").first()).toBeVisible();
    await expect(page.getByText("Brief consolidado").first()).toBeVisible();
    await expect(page.getByText("Mudança funcional no produto existente").first()).toBeVisible();
    await expect(page.getByText("Aprovação necessária")).toBeVisible();
    await expect(page.getByText("Nenhum arquivo foi alterado até aqui")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("maestro-plan.png"), fullPage: true });
    expect(await readFile(sentinel, "utf8")).toBe("do not change\n");
    expect(await readdir(workspace)).toEqual(["sentinel.txt"]);

    await page.getByRole("button", { name: "Aprovar e executar" }).click();
    expect(await waitForRun(page, "completed")).toBe(runId);
    await expect(page.getByRole("heading", { name: "Execução concluída" })).toBeVisible();
    await expect(page.getByText("Chats dos agentes", { exact: true })).toBeVisible();
    const dispatchedAgentCount = await page.evaluate(
      async (id) => (await window.maestro.getRun(id)).tasks.length,
      runId,
    );
    const agentChatButtons = page.locator('button[aria-label*="chat do agente"]');
    await expect(agentChatButtons).toHaveCount(dispatchedAgentCount);
    for (let index = 0; index < dispatchedAgentCount; index += 1) {
      const agentChatButton = agentChatButtons.nth(index);
      if ((await agentChatButton.getAttribute("aria-expanded")) !== "true") {
        await agentChatButton.click();
      }
      const agentChat = agentChatButton.locator("..");
      await expect(
        agentChat.getByText("Agente fixture: contexto recebido.", { exact: true }),
      ).toBeVisible();
      await expect(
        agentChat.getByText("Agente fixture: tarefa concluída.", { exact: true }),
      ).toBeVisible();
    }
    expect(await readFile(sentinel, "utf8")).toBe("do not change\n");

    const recentConversation = page.locator("aside").getByTitle("Execute o fluxo Maestro E2E");
    await recentConversation.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Renomear" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Excluir conversa" })).toBeVisible();
    await page.keyboard.press("Escape");
    await recentConversation.hover();
    await page.getByRole("button", { name: "Mais ações para Execute o fluxo Maestro E2E" }).click();
    await page.getByRole("menuitem", { name: "Renomear" }).click();
    await page.getByLabel("Título", { exact: true }).fill("Fluxo Maestro E2E");
    await page.getByRole("button", { name: "Salvar título" }).click();
    await expect(page.locator("aside").getByTitle("Fluxo Maestro E2E")).toBeVisible();

    await page
      .getByRole("button", { name: /Maestro/ })
      .last()
      .click();
    await page.getByRole("button", { name: /Agente Coding agent direto/ }).click();
    await page
      .getByPlaceholder("Peça uma alteração direta no workspace…")
      .fill("Responda pela fixture direta");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Direct agent fixture complete.", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: /Agente/ })
      .last()
      .click();
    await page.getByRole("button", { name: /Chat Conversa sem ferramentas/ }).click();
    await expect(page.getByText("Sem acesso ao workspace")).toBeVisible();
    await page.getByPlaceholder("Escreva uma mensagem…").fill("Diga olá");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Olá do chat E2E.", { exact: true })).toBeVisible();

    await page.keyboard.press("Control+Shift+M");
    await expect(page.getByRole("dialog", { name: "Troca rápida de modelo" })).toBeVisible();
    await page.getByRole("button", { name: /Fixture Codex Fast/ }).click();
    await expect(page.getByText("Troca preparada:", { exact: true })).toBeVisible();
    await page.getByPlaceholder("Escreva uma mensagem…").fill("Continue no modelo rápido");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(
      page.getByText("Fast-switch com contexto recebido.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const conversation = (await window.maestro.bootstrap()).recentConversations[0];
          return conversation?.modelId ?? null;
        }),
      )
      .toBe("fixture-fast");

    await application.evaluate(({ clipboard }) => clipboard.writeText("conteúdo anexado E2E"));
    await page.getByRole("button", { name: "Adicionar contexto" }).click();
    await page.getByRole("button", { name: "Colar conteúdo" }).click();
    await expect(page.locator(".context-asset-chip").getByText(/texto-colado-/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled();
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Contexto anexado recebido.", { exact: true })).toBeVisible();
    const persistedClipboardAsset = await page.evaluate(async () => {
      const bootstrap = await window.maestro.bootstrap();
      const conversation = bootstrap.recentConversations[0];
      if (!conversation) return null;
      const detail = await window.maestro.getConversation(conversation.id);
      const asset = detail.messages.flatMap((message) => message.contextAssets)[0];
      return asset
        ? { conversationId: conversation.id, source: asset.source, kind: asset.kind }
        : null;
    });
    expect(persistedClipboardAsset).toMatchObject({ source: "clipboard", kind: "text" });

    await page.getByRole("button", { name: "Terminal" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page.getByRole("button", { name: "Encerrar" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar" }).click();
    await page.getByRole("button", { name: "Histórico" }).click();
    await expect(page.getByText("Fluxo Maestro E2E", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Configurações" }).click();
    await expect(
      page.getByRole("heading", { name: "Conta/API principal do Maestro" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contas dos agentes" })).toBeVisible();
    await expect(page.getByLabel("Nome da conta no Maestro").first()).toHaveValue("Conta padrão");
    await expect(page.getByText("ordem = prioridade", { exact: true })).toBeVisible();
    const maestroAccount = page.getByLabel("Conta ou API");
    const openAiOption = maestroAccount.locator("option").filter({ hasText: "OpenAI-compatible" });
    const openAiValue = await openAiOption.getAttribute("value");
    if (!openAiValue) throw new Error("Opção OpenAI-compatible não encontrada.");
    await maestroAccount.selectOption(openAiValue);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.maestro.bootstrap()).settings.defaultModels.maestro?.providerId,
        ),
      )
      .toBe("openai-compatible");
    const accountOrder = await page.evaluate(async () =>
      (await window.maestro.bootstrap()).providerConnections.map((item) => item.connection.id),
    );
    const firstAccountHandle = page.getByRole("button", {
      name: /Reordenar .* prioridade 1 de/,
    });
    const secondAccountHandle = page.getByRole("button", {
      name: /Reordenar .* prioridade 2 de/,
    });
    await expect(firstAccountHandle).toBeEnabled();
    await expect(secondAccountHandle).toBeEnabled();
    await firstAccountHandle.focus();
    await firstAccountHandle.press("ArrowDown");
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.maestro.bootstrap()).providerConnections.map((item) => item.connection.id),
        ),
      )
      .toEqual([...accountOrder].reverse());
    await page.getByRole("tab", { name: "Geral", exact: true }).click();
    await expect(page.getByText("Origem oficial de atualizações")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Tema escuro", exact: true })).toBeChecked();
    await page.getByText("Claro", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("switch", { name: "Telemetria local" })).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Verificar atualizações automaticamente" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Ajuda sobre telemetria local" }).hover();
    await expect(
      page.getByText(/Calcula contagens e métricas de uso somente neste dispositivo/),
    ).toBeVisible();
    await page.getByLabel("Canal de atualização").selectOption("beta");
    await page.getByLabel("Modo padrão de conversa").selectOption("chat");
    await page.getByLabel("Otimização de tokens").selectOption("aggressive");
    await page.getByLabel("Concorrência global (1–16)").fill("7");
    await page.getByRole("switch", { name: "Telemetria local" }).click();
    await page.getByRole("tab", { name: "Conexões", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Conta/API principal do Maestro" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const settings = await page.evaluate(
          async () => (await window.maestro.bootstrap()).settings,
        );
        return {
          theme: settings.theme,
          updateChannel: settings.updateChannel,
          defaultMode: settings.defaultMode,
          globalConcurrency: settings.globalConcurrency,
          telemetryEnabled: settings.telemetryEnabled,
          tokenOptimizationMode: settings.tokenOptimizationMode,
        };
      })
      .toEqual({
        theme: "light",
        updateChannel: "beta",
        defaultMode: "chat",
        globalConcurrency: 7,
        telemetryEnabled: true,
        tokenOptimizationMode: "aggressive",
      });
    await page.getByRole("tab", { name: "Geral", exact: true }).click();
    await expect(page.getByText("Preferências salvas automaticamente")).toBeVisible();
    await expect(page.getByLabel("Canal de atualização")).toHaveValue("beta");
    await expect(page.getByLabel("Modo padrão de conversa")).toHaveValue("chat");
    await expect(page.getByLabel("Otimização de tokens")).toHaveValue("aggressive");
    await expect(page.getByLabel("Concorrência global (1–16)")).toHaveValue("7");
    await expect(page.getByRole("switch", { name: "Telemetria local" })).toBeChecked();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.reload(),
    );
    await expect(page.getByRole("button", { name: "Configurações" })).toBeVisible();
    await page.getByRole("button", { name: "Configurações" }).click();
    await page.getByRole("tab", { name: "Geral", exact: true }).click();
    await expect(page.getByLabel("Canal de atualização")).toHaveValue("beta");
    await expect(page.getByLabel("Modo padrão de conversa")).toHaveValue("chat");
    await expect(page.getByLabel("Otimização de tokens")).toHaveValue("aggressive");
    await expect(page.getByLabel("Concorrência global (1–16)")).toHaveValue("7");
    await expect(page.getByRole("switch", { name: "Telemetria local" })).toBeChecked();

    await page.locator("aside").getByTitle("Fluxo Maestro E2E").hover();
    await page.getByRole("button", { name: "Mais ações para Fluxo Maestro E2E" }).click();
    await page.getByRole("menuitem", { name: "Excluir conversa" }).click();
    await page.getByRole("button", { name: "Excluir conversa" }).click();
    await expect(page.locator("aside").getByTitle("Fluxo Maestro E2E")).toHaveCount(0);

    await page.getByRole("button", { name: "Mais ações para o projeto Projeto E2E" }).click();
    await page.getByRole("menuitem", { name: "Excluir projeto…" }).click();
    await page.getByRole("button", { name: "Excluir projeto" }).click();
    await expect(page.getByRole("heading", { name: "Abra seu workspace" })).toBeVisible();
  } finally {
    await application?.close().catch(() => undefined);
    await new Promise<void>((resolve) => apiFixture.server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
