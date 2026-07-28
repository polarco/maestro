import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const executablePath = process.env.MAESTRO_SMOKE_EXECUTABLE;
if (!executablePath) {
  throw new Error("MAESTRO_SMOKE_EXECUTABLE must point to the packaged application.");
}

const userDataDirectory = await mkdtemp(path.join(tmpdir(), "maestro-packaged-smoke-"));
let application;
const platformArguments = process.platform === "win32" ? [] : ["--ozone-platform=headless"];

try {
  application = await electron.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--headless",
      ...platformArguments,
      "--disable-gpu",
      `--user-data-dir=${userDataDirectory}`,
    ],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const result = await page.evaluate(async () => {
    if (!window.maestro) throw new Error("The secure preload bridge was not exposed.");
    const payload = await window.maestro.bootstrap();
    return {
      name: payload.app.name,
      version: payload.app.version,
      development: payload.app.development,
      projects: Array.isArray(payload.projects),
      providers: Array.isArray(payload.providers),
      providerConnections: Array.isArray(payload.providerConnections),
      updateStatus: typeof payload.update?.status === "string",
    };
  });
  assert.equal(result.name, "Maestro");
  assert.equal(result.version, "0.2.0");
  assert.equal(result.development, false);
  assert.equal(result.projects, true);
  assert.equal(result.providers, true);
  assert.equal(result.providerConnections, true);
  assert.equal(result.updateStatus, true);
  process.stdout.write("Packaged Maestro preload and bootstrap smoke test passed.\n");
} finally {
  await application?.close().catch(() => undefined);
  await rm(userDataDirectory, { recursive: true, force: true });
}
