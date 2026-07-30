import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderInput } from "@maestro/contracts";
import { anthropicContent } from "../src/main/providers/anthropic-api.js";
import { claudeContentBlocks } from "../src/main/providers/claude-code.js";
import {
  codexCliImageArgs,
  codexModelSupportsVision,
  codexServerInput,
} from "../src/main/providers/codex.js";

describe("provider multimodal payloads", () => {
  let directory: string;
  let imagePath: string;
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "maestro-provider-images-"));
    imagePath = path.join(directory, "context.png");
    await writeFile(imagePath, bytes);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("maps Codex images to app-server localImage and CLI --image", () => {
    const input: ProviderInput = [
      { type: "text", text: "descreva" },
      { type: "localImage", path: imagePath, mimeType: "image/png" },
    ];
    expect(codexServerInput(input)).toEqual([
      { type: "text", text: "descreva", text_elements: [] },
      { type: "localImage", path: imagePath },
    ]);
    expect(codexCliImageArgs(input)).toEqual(["--image", imagePath]);
    expect(codexModelSupportsVision({ input_modalities: ["text", "image"] })).toBe(true);
    expect(codexModelSupportsVision({ inputModalities: ["text"] })).toBe(false);
    expect(codexModelSupportsVision({})).toBe(false);
  });

  it("encodes Claude Code and Anthropic API image blocks without exposing a path", async () => {
    const input: ProviderInput = [
      { type: "text", text: "descreva" },
      { type: "localImage", path: imagePath, mimeType: "image/png" },
    ];
    const expectedImage = {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: bytes.toString("base64"),
      },
    };
    expect(await claudeContentBlocks(input)).toEqual([
      { type: "text", text: "descreva" },
      expectedImage,
    ]);
    expect(await anthropicContent(input)).toEqual([
      { type: "text", text: "descreva" },
      expectedImage,
    ]);
    expect(JSON.stringify(await claudeContentBlocks(input))).not.toContain(imagePath);
  });
});
