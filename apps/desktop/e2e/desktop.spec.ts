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

async function waitForRun(page: Page, state: "awaiting_approval" | "completed"): Promise<string> {
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
else if (command[0] === "debug") process.stdout.write(JSON.stringify({ models: [{ slug: "fixture", display_name: "Fixture Codex", isDefault: true, supported_reasoning_levels: [{ effort: "medium" }] }] }));
else if (command[0] === "exec") {
  const prompt = command.at(-1) || "";
  const answer = prompt.includes("Diga olá") ? "Olá do chat E2E." : "Direct agent fixture complete.";
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "e2e-thread" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { id: "answer", type: "agent_message", text: answer } }) + "\\n");
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

    await page.getByRole("button", { name: "Nova conversa" }).first().click();
    await page
      .getByPlaceholder("Descreva o resultado que você quer…")
      .fill("Execute o fluxo Maestro E2E");
    await page.getByRole("button", { name: "Enviar" }).click();
    const runId = await waitForRun(page, "awaiting_approval");
    await expect(page.getByText("Aprovação necessária")).toBeVisible();
    await expect(page.getByText("Nenhum arquivo foi alterado até aqui")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("maestro-plan.png"), fullPage: true });
    expect(await readFile(sentinel, "utf8")).toBe("do not change\n");
    expect(await readdir(workspace)).toEqual(["sentinel.txt"]);

    await page.getByRole("button", { name: "Aprovar e executar" }).click();
    expect(await waitForRun(page, "completed")).toBe(runId);
    expect(await readFile(sentinel, "utf8")).toBe("do not change\n");

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

    await page.getByRole("button", { name: "Terminal" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page.getByRole("button", { name: "Encerrar" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar" }).click();
    await page.getByRole("button", { name: "Histórico" }).click();
    await expect(
      page.getByText("Execute o fluxo Maestro E2E", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Configurações" }).click();
    await expect(page.getByRole("heading", { name: "Contas por assinatura" })).toBeVisible();
    await expect(page.getByLabel("Nome da conta").first()).toHaveValue("Conta padrão");
    await page.getByRole("button", { name: "Geral", exact: true }).click();
    await expect(page.getByText("Origem oficial de atualizações")).toBeVisible();
  } finally {
    await application?.close().catch(() => undefined);
    await new Promise<void>((resolve) => apiFixture.server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
