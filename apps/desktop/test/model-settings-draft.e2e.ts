import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");

test("tests and discovers an unsaved model draft through real Electron IPC", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-model-draft-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });

  let releaseModels: (() => void) | undefined;
  const modelsGate = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });
  const requests: Array<{
    readonly method: string;
    readonly path: string;
    readonly authorization: string | undefined;
    readonly body?: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      requests.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization
      });
      await modelsGate;
      json(response, {
        data: [
          { id: "draft-model", context_window: 128000 },
          { id: "draft-model-fast", context_window: 64000 }
        ]
      });
      return;
    }

    const body = await readJsonBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization,
      body
    });
    if (isStreamingPingProbe(body)) {
      sendStreamingPing(response);
      return;
    }
    json(response, {
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await page.getByRole("button", { name: "新建模型" }).click();
    await page.getByLabel("模型 Base URL").fill(baseUrl);
    await page.getByLabel("模型名称").fill("draft-model");
    await page.getByLabel("密钥引用").fill("local-draft-e2e-key");

    const profilesBefore = await readProfileIds(page);
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.locator('.ns-project-feedback[role="status"]')).toHaveText(
      "Connected to openai-compatible/draft-model."
    );

    await page.getByRole("button", { name: "获取模型列表", exact: true }).click();
    await expect(page.getByText("正在获取模型列表...", { exact: true })).toBeVisible();
    releaseModels?.();
    await expect(page.getByText("已获取 2 个模型。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Discovered model name")).toHaveValue("draft-model");
    await expect(page.getByLabel("Discovered model name").locator("option")).toHaveCount(2);

    expect(await readProfileIds(page)).toEqual(profilesBefore);
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/v1/chat/completions",
        authorization: "Bearer local-draft-e2e-key",
        body: expect.objectContaining({ model: "draft-model" })
      }),
      expect.objectContaining({
        method: "GET",
        path: "/v1/models",
        authorization: "Bearer local-draft-e2e-key"
      })
    ]);
  } finally {
    releaseModels?.();
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function readProfileIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () => {
    const result = await window.novelStudio?.settings.listModelProfiles();
    if (result?.ok !== true) throw new Error("Unable to list model profiles");
    return result.value.profiles.map((profile) => profile.id);
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function isStreamingPingProbe(body: Record<string, unknown>): boolean {
  const messages = body["messages"];
  return (
    body["stream"] === true &&
    Array.isArray(messages) &&
    messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        message["role"] === "user" &&
        message["content"] === "ping"
    )
  );
}

function sendStreamingPing(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\ndata: [DONE]\n\n`
  );
}

function electronEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
