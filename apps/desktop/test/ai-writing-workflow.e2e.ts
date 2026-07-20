import { expect, test, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");

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
  const electronApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();

    await queueDirectorySelection(electronApp, tempRoot);
    await createQueuedCreativeProject(page, {
      folderName: "AI Workflow Smoke",
      projectId: "prj_ai_workflow_smoke",
      title: "AI Workflow Smoke"
    });
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await replaceCodeMirrorText(page, body, "Opening line.");
    const composer = await openAgentComposer(page);

    const review = await requestSelectionReview(page, body, composer, "改写当前选区");
    await expect(review).toContainText("Opening line.");
    const proposedText = await readSelectionProposal(review);

    await review.getByRole("button", { name: "Reject selection AI preview" }).click();
    await expect(review).toContainText("rejected");
    await expect(review.getByRole("button", { name: "Undo selection AI rejection" })).toBeEnabled();
    await review.getByRole("button", { name: "Undo selection AI rejection" }).click();
    await expect(review).toContainText("pending");

    await review.getByRole("button", { name: "Accept selection AI preview" }).click();
    await expect(review).toHaveCount(0);

    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toBe(proposedText);
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
  let appliedBody = "";

  const firstApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await firstApp.firstWindow();

    await queueDirectorySelection(firstApp, tempRoot);
    await createQueuedCreativeProject(page, {
      folderName: "Core Journey Smoke",
      projectId: "prj_core_journey_smoke",
      title: "Core Journey Smoke"
    });
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await replaceCodeMirrorText(page, body, "Core journey opening line.");
    const composer = await openAgentComposer(page);

    const review = await requestSelectionReview(
      page,
      body,
      composer,
      "检查文风与一致性"
    );
    await expect(review.getByLabel("AI 文风规则检查")).toBeVisible();
    appliedBody = await readSelectionProposal(review);

    await review.getByRole("button", { name: "Accept selection AI preview" }).click();
    await expect(review).toHaveCount(0);
    await expect
      .poll(() => readCodeMirrorText(page.getByLabel("章节正文")))
      .toBe(appliedBody);
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
  expect(savedAfterAi).toContain(appliedBody);

  const historyAssetDirs = await readdir(join(projectRoot, "history", "chapters"));
  expect(historyAssetDirs.length).toBeGreaterThan(0);

  const secondApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Second Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "Second User Data")
    })
  });

  try {
    const page = await secondApp.firstWindow();

    await queueDirectorySelection(secondApp, projectRoot);
    await openAgentComposer(page);

    const body = page.getByLabel("章节正文");
    await expect
      .poll(async () => (await readCodeMirrorText(body)).trimEnd())
      .toBe(appliedBody.trimEnd());
    await expect(page.getByLabel("版本历史")).toContainText("Before AI apply");

    const continuedBody = `${appliedBody}${appliedBody.endsWith("\n") ? "" : "\n"}Continued after reopen.`;
    await replaceCodeMirrorText(page, body, continuedBody);
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

test("routes a real Electron selection preview to a local OpenAI-compatible server", async () => {
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
          choices: [
            {
              message: {
                role: "assistant",
                content: isSelectionPreviewRequest(body)
                  ? JSON.stringify({
                      proposedText: "Real provider opening, refined.",
                      summary: "Returned by local provider."
                    })
                  : "pong"
              }
            }
          ],
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
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const electronApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelection(electronApp, projectRoot);
    const composer = await openAgentComposer(page);
    const body = page.getByLabel("章节正文");
    await replaceCodeMirrorText(page, body, "Real provider opening.");

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

    const review = await requestSelectionReview(page, body, composer, "改写当前选区");

    await expect(review).toContainText("Real provider opening, refined.");
    await expect(page.getByText("当前是演示模式，未配置真实Key。")).toHaveCount(0);
    await review.getByRole("button", { name: "Accept selection AI preview" }).click();
    await expect(review).toHaveCount(0);
    await expect.poll(() => readCodeMirrorText(page.getByLabel("章节正文"))).toBe(
      "Real provider opening, refined."
    );
    await expect
      .poll(
        () =>
          requests.filter(
            (entry) =>
              entry.method === "POST" &&
              entry.url === "/v1/chat/completions" &&
              isSelectionPreviewRequest(entry.body)
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

async function openAgentComposer(page: Page): Promise<Locator> {
  const unbound = page.getByLabel("Agent 未绑定工作区");
  const view = page.getByLabel("Agent 会话主视图");
  await expect
    .poll(async () => (await unbound.isVisible()) || (await view.isVisible()), { timeout: 15_000 })
    .toBe(true);
  if (await unbound.isVisible()) {
    const opened = await page.evaluate(async () => {
      const selected = await window.novelStudio?.project.chooseOpenCreativeDirectory();
      if (selected?.ok !== true || selected.value.selectionId === undefined) return selected;
      return window.novelStudio?.project.openCreativeProject(selected.value.selectionId);
    });
    if (opened?.ok !== true) {
      throw new Error(`Creative project activation failed: ${JSON.stringify(opened)}`);
    }
    await page.reload();
  }
  await expect(view).toBeVisible({ timeout: 15_000 });
  const composer = view.getByLabel("会话输入区");
  if (!(await composer.isVisible())) {
    const createConversation = view.getByRole("button", { name: "新建会话" });
    await expect(createConversation).toBeEnabled();
    await createConversation.click();
  }
  await expect(composer).toBeVisible();
  return composer;
}

async function createQueuedCreativeProject(
  page: Page,
  input: { readonly folderName: string; readonly projectId: string; readonly title: string }
): Promise<void> {
  const created = await page.evaluate(async (request) => {
    const selected = await window.novelStudio?.project.chooseCreateParentDirectory();
    if (selected?.ok !== true || selected.value.selectionId === undefined) return selected;
    return window.novelStudio?.project.createCreativeProject({
      parentSelectionId: selected.value.selectionId,
      folderName: request.folderName,
      projectId: request.projectId,
      title: request.title,
      language: "zh-CN"
    });
  }, input);
  if (created?.ok !== true) {
    throw new Error(`Creative project creation failed: ${JSON.stringify(created)}`);
  }
  await page.reload();
  await expect(page.getByLabel("项目导航")).toBeVisible({ timeout: 15_000 });
}

async function queueDirectorySelection(
  electronApp: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function requestSelectionReview(
  page: Page,
  editor: Locator,
  composer: Locator,
  actionName: "改写当前选区" | "检查文风与一致性"
): Promise<Locator> {
  await selectAllCodeMirrorText(page, editor);
  const action = composer.getByRole("button", { name: actionName });
  await expect(action).toBeEnabled();
  await action.click();
  const review = page.getByLabel("Selection AI review");
  await expect(review).toBeVisible();
  return review;
}

async function selectAllCodeMirrorText(page: Page, editor: Locator): Promise<void> {
  const content = editor.locator('.cm-content[contenteditable="true"]');
  await content.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
}

async function readSelectionProposal(review: Locator): Promise<string> {
  const proposedText = await review
    .locator(".ns-selection-review-diff article")
    .nth(1)
    .locator("p")
    .textContent();
  if (proposedText === null) throw new Error("Expected a selection preview proposal.");
  return proposedText;
}

function isSelectionPreviewRequest(body: unknown): boolean {
  return JSON.stringify(body).includes("selected text rewrite");
}
