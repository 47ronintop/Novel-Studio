import { expect, test, _electron as electron } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

function createElectronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function replaceCodeMirrorText(page: Page, editor: Locator, text: string): Promise<void> {
  const content = editor.locator('.cm-content[contenteditable="true"]');
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(text);
}

async function readCodeMirrorText(editor: Locator): Promise<string> {
  const lines = await editor.locator(".cm-line").allTextContents();
  return lines.join("\n");
}

test("generates an AI writing suggestion and applies it only after confirmation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-ai-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "AI Workflow Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({ NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot })
  });

  try {
    const page = await electronApp.firstWindow();
    const activityBar = page.getByLabel("活动栏");

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await replaceCodeMirrorText(page, body, "Opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByLabel("AI 写作指令").fill("Continue the active scene.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(
      page.getByText("Generated a local mock continuation for review.", { exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("AI 建议差异")).toContainText("AI continuation draft.");
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toContain("Opening line.");
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .not.toContain("AI continuation draft.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByRole("button", { name: "应用 AI 建议" }).click();

    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toBe("Opening line.\nAI continuation draft.\n");
    await expect(page.getByText("未保存").first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completes the core writing journey across save, close, reopen, and continued editing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-core-journey-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "Core Journey Smoke");

  const firstApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({ NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot })
  });

  try {
    const page = await firstApp.firstWindow();
    const activityBar = page.getByLabel("活动栏");

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await replaceCodeMirrorText(page, body, "Core journey opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByLabel("AI 写作指令").fill("Continue the current chapter for the core journey.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(page.getByLabel("AI 建议差异")).toContainText("AI continuation draft.");
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toBe("Core journey opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByRole("button", { name: "应用 AI 建议" }).click();
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toBe("Core journey opening line.\nAI continuation draft.\n");
    await expect(page.getByText("未保存").first()).toBeVisible();

    await page.getByRole("button", { name: "保存当前文档" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();
  } finally {
    await firstApp.close();
  }

  const chapterFiles = (await readdir(join(projectRoot, "chapters"))).filter((entry) =>
    entry.endsWith(".md")
  );
  expect(chapterFiles).toHaveLength(1);
  const [chapterFile] = chapterFiles;
  if (chapterFile === undefined) {
    throw new Error("Expected one chapter file after the first writing session.");
  }
  const chapterPath = join(projectRoot, "chapters", chapterFile);
  const savedAfterAi = await readFile(chapterPath, "utf8");
  expect(savedAfterAi).toContain("Core journey opening line.");
  expect(savedAfterAi).toContain("AI continuation draft.");

  const historyAssetDirs = await readdir(join(projectRoot, "history", "chapters"));
  expect(historyAssetDirs.length).toBeGreaterThan(0);

  const secondApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Second Default Project")
    })
  });

  try {
    const page = await secondApp.firstWindow();

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "打开项目" }).click();

    const body = page.getByLabel("章节正文");
    await expect
      .poll(() => readCodeMirrorText(body))
      .toBe("Core journey opening line.\nAI continuation draft.\n");
    await expect(page.getByLabel("版本历史")).toContainText("Before AI apply");

    await replaceCodeMirrorText(
      page,
      body,
      "Core journey opening line.\nAI continuation draft.\nContinued after reopen."
    );
    await expect(page.getByText("未保存").first()).toBeVisible();
    await page.getByRole("button", { name: "保存当前文档" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();
  } finally {
    await secondApp.close();
  }

  const savedAfterReopen = await readFile(chapterPath, "utf8");
  expect(savedAfterReopen).toContain("Continued after reopen.");

  await rm(tempRoot, { recursive: true, force: true });
});

test("routes a real Electron streaming request to a local OpenAI-compatible SSE server", async () => {
  test.setTimeout(60_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-real-provider-e2e-"));
  const requests: Array<{ readonly method: string; readonly url: string; readonly body: unknown }> =
    [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody.length === 0 ? undefined : (JSON.parse(rawBody) as unknown);
    requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      body
    });

    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "local-test-model" }] }));
      return;
    }

    const stream =
      typeof body === "object" && body !== null && "stream" in body && body.stream === true;
    if (!stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      );
      return;
    }

    const output = JSON.stringify({
      proposedBody: "Real provider opening.\nReal provider continuation.\n",
      summary: "Returned by local SSE provider."
    });
    const splitAt = Math.ceil(output.length / 2);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    for (const content of [output.slice(0, splitAt), output.slice(splitAt)]) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address for the local SSE server.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const electronApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await replaceCodeMirrorText(page, page.getByLabel("章节正文"), "Real provider opening.");

    await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await page.getByLabel("模型 Base URL").fill(baseUrl);
    const modelName = page.getByLabel("模型名称");
    if (await modelName.isVisible()) {
      await modelName.fill("local-test-model");
    }
    await page.getByLabel("密钥引用").fill("local-e2e-key");
    await page.getByRole("button", { name: "保存模型配置" }).click();
    await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.locator(".ns-project-feedback")).toHaveText(
      "Connected to openai-compatible/local-test-model."
    );
    await page.getByRole("button", { name: "关闭设置" }).click();

    await page.getByLabel("活动栏").getByRole("button", { name: "AI 工作流" }).click();
    await page.getByLabel("AI 写作指令").fill("Continue through the local provider.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(page.getByText("Returned by local SSE provider.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("AI 建议差异")).toContainText("Real provider continuation.");
    await expect(page.getByText("当前是演示模式，未配置真实Key。")).toHaveCount(0);
    await expect
      .poll(
        () =>
          requests.filter(
            (entry) =>
              entry.method === "POST" &&
              entry.url === "/v1/chat/completions" &&
              typeof entry.body === "object" &&
              entry.body !== null &&
              "stream" in entry.body &&
              entry.body.stream === true
          ).length
      )
      .toBe(1);
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});
