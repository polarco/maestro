import { MaestroError } from "@maestro/core";

export async function consumeSse(
  response: Response,
  onData: (data: string, event: string | null) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new MaestroError("EMPTY_STREAM", "O provedor não retornou um stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let event: string | null = null;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) await onData(data.join("\n"), event);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const data = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) await onData(data, null);
  }
}

export async function responseError(response: Response): Promise<MaestroError> {
  const body = await response.text().catch(() => "");
  let message = body.slice(0, 1_000);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    message =
      (typeof parsed.error === "object" ? parsed.error.message : parsed.error) ??
      parsed.message ??
      message;
  } catch {
    // Plain-text provider errors are useful as-is.
  }
  return new MaestroError(
    "PROVIDER_HTTP_ERROR",
    `O provedor respondeu HTTP ${response.status}: ${message || response.statusText}`,
    { recoverable: response.status === 429 || response.status >= 500 },
  );
}
