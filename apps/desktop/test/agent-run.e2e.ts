import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const activeChapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";

test("blocks an Agent run when the selected model fails capability preflight", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-preflight-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelection(electronApp, projectRoot);
    await openAgentPanel(page);
    const composer = page.getByLabel("会话输入区");
    await composer.getByLabel("Agent 请求").fill("检查当前章节");
    await composer.getByLabel("启动 Agent 运行").click();

    await expect(page.getByRole("alert")).toContainText("cannot start an Agent run");
    await expect(page.getByLabel("Agent 运行时间线")).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stops a live Agent run through the real Electron IPC path", async () => {
  test.setTimeout(60_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-stop-e2e-"));
  let streamClosed = false;
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, { data: [{ id: "local-agent", context_window: 128000 }] });
      return;
    }
    if (request.method !== "POST" || body.stream !== true) {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }

    const streamTimer = setTimeout(() => {
      if (!response.writableEnded) {
        response.end("data: [DONE]\n\n");
      }
    }, 20_000);
    response.on("close", () => {
      streamClosed = true;
      clearTimeout(streamTimer);
    });
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "等待停止" } }] })}\n\n`
    );
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const pageErrors: string[] = [];
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await queueDirectorySelection(electronApp, projectRoot);
    await openAgentPanel(page);
    await configureLocalModel(page, baseUrl);
    const composer = page.getByLabel("会话输入区");
    await composer.getByLabel("Agent 请求").fill("读取当前章节");
    await composer.getByLabel("启动 Agent 运行").click();
    await resolveContextRefreshIfVisible(page);
    await expect(page.locator(".ns-agent-assistant-text")).toContainText("等待停止");
    await expect(page.locator(".ns-agent-status")).toHaveText("规划中");

    await page.getByRole("button", { name: "停止 Agent 运行" }).click();
    await expect.poll(() => streamClosed).toBe(true);
    expect(pageErrors).toEqual([]);
    await waitForLatestRunStatus(page, "cancelled");
    await expect(page.getByLabel("会话运行历史")).toContainText("cancelled");
    await expect(page.locator(".ns-agent-timeline")).toHaveCount(0);
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("streams read tools, restores a question after reload, refreshes dirty context, and links plan execution", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const savedChapterBaseline = await readFile(
    join(projectRoot, "chapters", `${activeChapterId}.md`),
    "utf8"
  );
  const requests: Array<{ readonly body: Record<string, unknown>; readonly userRequest: string }> =
    [];
  let releaseChapterToolCall: (() => void) | undefined;
  const chapterToolCallGate = new Promise<void>((resolve) => {
    releaseChapterToolCall = resolve;
  });
  let releaseQuestion: (() => void) | undefined;
  const questionGate = new Promise<void>((resolve) => {
    releaseQuestion = resolve;
  });
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    const record = { body, userRequest: lastUserRequest(body) };
    requests.push(record);

    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, { data: [{ id: "local-agent", context_window: 128000 }] });
      return;
    }
    if (request.method !== "POST") {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }

    if (body.stream !== true) {
      json(response, {
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      });
      return;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolCount = messages.filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message as { role?: unknown }).role === "tool"
    ).length;
    const toolNames = Array.isArray(body.tools)
      ? body.tools
          .map((tool) =>
            typeof tool === "object" &&
            tool !== null &&
            typeof (tool as { function?: { name?: unknown } }).function?.name === "string"
              ? (tool as { function: { name: string } }).function.name
              : undefined
          )
          .filter((name): name is string => name !== undefined)
      : [];
    const planning = toolNames.includes("finish_plan");
    const answered = ["keep", "保留"].includes(lastUserRequest(body));

    if (planning && toolCount === 2 && !answered) {
      await questionGate;
      sendToolCall(response, "question", "request_user_input", {
        questionId: "question-01",
        prompt: "保留现有揭示时机？",
        reason: "它会改变执行范围。",
        options: [
          { id: "keep", label: "保留" },
          { id: "move", label: "提前" }
        ],
        allowFreeText: false
      });
      return;
    }
    if (planning && (toolCount >= 2 || answered)) {
      sendToolCall(response, "plan", "finish_plan", {
        planId: "plan-e2e",
        goal: "核对当前章节",
        successCriteria: ["读取上下文"],
        nonGoals: ["不写入文件"],
        facts: ["编辑器内容可能未保存"],
        assumptions: [],
        openQuestions: [],
        targetRefs: [{ refId: `chapter:${activeChapterId}`, intent: "核对" }],
        steps: [{ stepId: "step-01", title: "读取章节", verification: "重新读取章节" }],
        risks: ["上下文可能变化"],
        verification: ["刷新 Context Snapshot"],
        sourceRefs: [`chapter:${activeChapterId}`]
      });
      return;
    }
    if (toolCount === 0) {
      sendToolCall(
        response,
        "entries",
        "list_project_entries",
        { path: "chapters" },
        "先读取项目结构。"
      );
      return;
    }
    if (toolCount === 1) {
      await chapterToolCallGate;
      sendToolCall(
        response,
        "chapter",
        "read_chapter",
        { chapterId: activeChapterId },
        "读取当前章节。"
      );
      return;
    }
    sendToolCall(response, "finish", "finish", { summary: "只读执行完成" });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelection(electronApp, projectRoot);
    await openAgentPanel(page);
    await configureLocalModel(page, baseUrl);
    await replaceChapterText(page, "未保存的开头");
    const composer = page.getByLabel("会话输入区");
    await composer.getByLabel("Agent 请求").fill("核对当前章节并给出计划");
    await composer.getByLabel("启动 Agent 运行").click();
    await expect(page.getByText("editor_buffer / dirty", { exact: false })).toBeVisible();

    const activitySummary = page.getByLabel("Agent 活动摘要");
    await expect(activitySummary).toBeVisible();
    await expect(activitySummary).not.toHaveAttribute("open", "");
    await expect(activitySummary.locator(":scope > summary")).toContainText("已读取 1 项");
    await expect(
      activitySummary.locator("ol").getByText(/已列出 chapters 的 1 个条目/)
    ).not.toBeVisible();
    await expect(
      activitySummary.locator("ol").getByText(`已读取章节 ${activeChapterId}`, { exact: true })
    ).not.toBeVisible();
    releaseChapterToolCall?.();
    await expect(activitySummary.locator("ol > li")).toHaveCount(2);

    await page.getByLabel("活动栏").getByRole("button", { name: "工作区" }).click();
    await replaceChapterText(page, "运行中发生变化");
    releaseQuestion?.();

    await expect(page.getByLabel("Agent 阻塞问题")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("会话输入区")).toBeVisible();
    await expect(page.getByLabel("Agent 阻塞问题")).toBeVisible();
    await page.getByLabel("Agent 阻塞问题").getByText("保留", { exact: true }).click();
    await page.getByRole("button", { name: "回答并继续" }).click();

    await expect(page.getByLabel("上下文刷新")).toBeVisible();
    await page.getByLabel("上下文刷新").getByRole("button", { name: "使用当前内容刷新" }).click();
    await expect(page.getByLabel("Plan Artifact 审阅")).toBeVisible();
    await expect(page.getByLabel("Agentic Writing Loop")).not.toContainText("应用");
    const restoredSummary = page.getByLabel("Agent 活动摘要");
    await expect(restoredSummary).not.toHaveAttribute("open", "");
    await restoredSummary.locator(":scope > summary").click();
    const persistedSteps = await restoredSummary.locator("ol > li").allTextContents();
    expect(persistedSteps).toHaveLength(2);
    expect(persistedSteps[0]).toContain("已列出 chapters 的 1 个条目");
    expect(persistedSteps[1]).toContain(`已读取章节 ${activeChapterId}`);

    await page.getByRole("button", { name: "按此方案执行" }).click();
    await expect
      .poll(() => requests.some((entry) => entry.userRequest.includes("Execute approved plan")))
      .toBe(true);
    await waitForLatestRunStatus(page, "completed");
    await expect(page.getByLabel("会话运行历史")).toContainText("completed");
    const completedRunId = await latestRunId(page);
    const completedTurn = page.locator(`[data-run-id="${completedRunId}"]`);
    await expect(completedTurn).toHaveCount(1);
    const completedAssistant = completedTurn.locator('[data-speaker="assistant"] > p').first();
    await expect(completedAssistant).toBeVisible();
    const completedAssistantText = await completedAssistant.textContent();
    expect(completedAssistantText?.trim().length).toBeGreaterThan(0);
    const completedSummary = completedTurn.getByLabel("Agent 活动摘要");
    await expect(completedSummary).not.toHaveAttribute("open", "");
    await completedSummary.locator(":scope > summary").click();
    const completedSteps = await completedSummary.locator("ol > li").allTextContents();
    expect(completedSteps).toHaveLength(2);
    expect(completedSteps[0]).toContain("已列出 chapters 的 1 个条目");
    expect(completedSteps[1]).toContain(`已读取章节 ${activeChapterId}`);
    await assertCompactConversationSurface(page);

    await page.reload();
    await expect(page.getByLabel("会话输入区")).toBeVisible();
    const restoredTurn = page.locator(`[data-run-id="${completedRunId}"]`);
    await expect(restoredTurn).toHaveCount(1);
    await expect(restoredTurn.locator('[data-speaker="assistant"] > p').first()).toHaveText(
      completedAssistantText ?? ""
    );
    const restoredCompletedSummary = restoredTurn.getByLabel("Agent 活动摘要");
    await expect(restoredCompletedSummary).not.toHaveAttribute("open", "");
    await expect(restoredCompletedSummary.locator("ol > li")).toHaveCount(2);
    const restoredCompletedSteps = await restoredCompletedSummary
      .locator("ol > li")
      .allTextContents();
    expect(restoredCompletedSteps).toEqual(completedSteps);
    await assertCompactConversationSurface(page);

    const savedChapter = await readFile(
      join(projectRoot, "chapters", `${activeChapterId}.md`),
      "utf8"
    );
    expect(savedChapter).toBe(savedChapterBaseline);
    expect(savedChapter).not.toContain("未保存的开头");
    expect(savedChapter).not.toContain("运行中发生变化");
  } finally {
    releaseChapterToolCall?.();
    releaseQuestion?.();
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("local-agent");
  await page.getByLabel("密钥引用").fill("local-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator(".ns-project-feedback")).toContainText(
    "Connected to openai-compatible/local-agent"
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

async function openAgentPanel(page: Page): Promise<void> {
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
  const createConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await createConversation.isVisible()) await createConversation.click();
  await expect(page.getByLabel("会话输入区")).toBeVisible();
}

async function queueDirectorySelection(
  electronApp: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function resolveContextRefreshIfVisible(page: Page): Promise<void> {
  const refresh = page.getByLabel("上下文刷新");
  const visible = await refresh
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (visible) await refresh.getByRole("button", { name: "从目标排除" }).click();
}

async function waitForLatestRunStatus(page: Page, status: string): Promise<void> {
  await expect
    .poll(async () => {
      const listed = await page.evaluate(async () =>
        window.novelStudio?.agentRuns.list("prj_minimal_chapter")
      );
      return listed?.ok ? listed.value.at(-1)?.status : undefined;
    })
    .toBe(status);
}

async function latestRunId(page: Page): Promise<string> {
  const runId = await page.evaluate(async () => {
    const listed = await window.novelStudio?.agentRuns.list("prj_minimal_chapter");
    return listed?.ok ? listed.value.at(-1)?.runId : undefined;
  });
  if (runId === undefined) throw new Error("Expected a persisted Agent run");
  return runId;
}

async function assertCompactConversationSurface(page: Page): Promise<void> {
  const panel = page.getByLabel("AI 对话面板");
  await expect(panel.getByLabel("AI 对话记录")).toHaveCount(0);
  await expect(panel.getByLabel("AI 写作工作流")).toHaveCount(0);
  await expect(panel.getByLabel("AI 文风规则检查")).toHaveCount(0);
  await expect(panel.getByLabel("工作流运行历史")).toHaveCount(0);
  await expect(panel.getByLabel("AI 工作流运行观测")).toHaveCount(0);
  await expect(panel).not.toContainText(
    /tokens?|成本|cost|Context Trace|Workflow History|Observability|文风规则/i
  );
}

async function replaceChapterText(page: Page, value: string): Promise<void> {
  const editor = page.getByLabel("章节正文").locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(value);
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return isRecord(parsed) ? parsed : {};
}

function lastUserRequest(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const users = messages.filter(isRecord).filter((message) => message["role"] === "user");
  const content = users.at(-1)?.["content"];
  return typeof content === "string" ? content : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  args: Record<string, unknown>,
  content?: string
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { ...(content === undefined ? {} : { content }), tool_calls: [{ index: 0, id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}
