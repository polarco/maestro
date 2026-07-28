import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, "../src/main/providers/generated/codex");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `codex exited with ${code}`));
    });
  });
}

try {
  const version = await run(["--version"]);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await run(["app-server", "generate-ts", "--out", output]);
  await writeFile(path.join(output, ".version"), `${version}\n`, "utf8");
  process.stdout.write(`Codex schema generated for ${version}\n`);
} catch (error) {
  process.stdout.write(
    `Codex schema skipped: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
