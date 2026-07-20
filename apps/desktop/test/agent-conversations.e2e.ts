import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from "@playwright/test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const projectId = "prj_minimal_chapter";

test("isolates multi-run conversation context and restores project-scoped conversations", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-conversations-e2e-"));
  const projectRoot = join(tempRoot, "Project A");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const modelRequests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, { data: [{ id: "local-agent", context_window: 128000 }] });
      return;
    }
    if (request.method !== "POST" || body["stream"] !== true) {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }
    modelRequests.push(body);
    const userRequest = lastUserRequest(body);
    if (userRequest.includes("Hold beta")) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Holding beta run" } }] })}\n\n`
      );
      return;
    }
    sendToolCall(response, `finish-${String(modelRequests.length)}`, "finish", {
      summary: `Completed ${userRequest}`
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
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
    await openAgentSurface(page);
    await configureLocalModel(page, `http://127.0.0.1:${address.port}/v1`);
    const conversationA = await createConversation(page);
    const composer = page.getByLabel("会话输入区");
    await expect(composer.getByLabel(/^模型：/)).toBeVisible();
    await expect(page.getByLabel("AI 对话面板")).toBeVisible();
    await expect(page.getByLabel("Agent 请求")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /启动 Agent 运行|停止 Agent 运行/ })).toHaveCount(
      1
    );
    await expect(
      page.getByRole("button", {
        name: /执行 · 写作|规划 · 写作|执行 · 通用文件|规划 · 通用文件/
      })
    ).toHaveCount(1);
    await expect(page.getByLabel("AI 对话记录")).toHaveCount(0);
    await expect(page.getByLabel("AI 写作工作流")).toHaveCount(0);
    await expect(page.getByLabel("AI 文风规则检查")).toHaveCount(0);
    await expect(page.getByLabel("工作流运行历史")).toHaveCount(0);
    await expect(page.getByLabel("AI 工作流运行观测")).toHaveCount(0);

    await selectPlanningWritingMode(page);
    await expect(page.getByRole("button", { name: "规划 · 写作" })).toHaveCount(1);
    await expect(page.getByLabel("会话输入区").getByLabel(/^修改权限：/)).toHaveCount(0);
    await expect(page.getByLabel("运行方式")).toHaveCount(0);
    await expect(
      page.getByLabel("会话输入区").getByRole("group", { name: "上下文" })
    ).toHaveCount(0);
    await selectExecutionMode(page);
    await composer.getByLabel("修改权限：每次修改前确认").click();
    const permissionMenu = composer.getByRole("dialog", { name: "修改权限与摘要" });
    await expect(permissionMenu.locator('details[aria-label="本次权限摘要"]')).toContainText(
      "服务端事实"
    );
    await permissionMenu.getByRole("radio", { name: "本次运行自动修改" }).check();
    await permissionMenu.getByRole("checkbox", { name: "确认本次运行自动修改风险" }).check();
    await permissionMenu.press("Escape");

    await sendConversationRequest(page, "Remember the alpha lantern clue.");
    await waitForRunCount(page, 1);
    await waitForLatestRunStatus(page, "completed");
    await expect(composer.getByLabel("修改权限：每次修改前确认")).toBeVisible();
    const firstRunId = await latestRunId(page);
    await expect(page.locator(`[data-run-id="${firstRunId}"]`)).toHaveCount(1);
    await expect(
      page.getByText("Completed Remember the alpha lantern clue.", { exact: true })
    ).toHaveCount(1);
    await expect(page.getByLabel("会话运行历史")).not.toContainText(/tokens?|成本|cost/i);
    await assertCompactConversationSurface(page);

    await sendConversationRequest(page, "Continue the alpha thread.");
    await waitForRunCount(page, 2);
    await expect.poll(() => modelRequests.length).toBe(2);
    expect(messageText(modelRequests[1])).toContain("Untrusted conversation context");
    expect(messageText(modelRequests[1])).toContain("Remember the alpha lantern clue.");

    const conversationB = await createConversation(page);
    expect(conversationB).not.toBe(conversationA);
    await selectExecutionMode(page);
    await expect(
      page.getByLabel("会话输入区").getByLabel("修改权限：每次修改前确认")
    ).toBeVisible();
    await sendConversationRequest(page, "Hold beta without alpha context.");
    await expect(page.locator(".ns-agent-assistant-text")).toContainText("Holding beta run");
    const conversationView = page.getByLabel("Agent 会话主视图");
    const runProjection = conversationView.locator(".ns-agent-run");
    const projectionWrapper = conversationView.locator(".ns-agent-conversation-run-panel");
    await expect(conversationView).toHaveCSS("overflow-y", "auto");
    await expect(runProjection).toHaveCSS("overflow-y", "visible");
    await expect(projectionWrapper).toHaveCSS("border-top-width", "0px");
    await expect(runProjection.locator(".ns-agent-runtime-label")).toHaveCount(0);
    await expect(runProjection).not.toContainText(
      /tokens?|成本|cost|Context Trace|Workflow History|Observability|文风规则|运行历史/i
    );
    await expect.poll(() => modelRequests.length).toBe(3);
    expect(messageText(modelRequests[2])).not.toContain("alpha lantern clue");
    expect(messageText(modelRequests[2])).not.toContain("Untrusted conversation context");

    await selectConversation(page, conversationA);
    await expect(
      page.getByText(/is running|currently has an active run|正在运行|已有活动运行/).first()
    ).toBeVisible();
    await expect(page.getByLabel("会话输入区").getByLabel("Agent 请求")).toBeDisabled();
    await page.getByRole("button", { name: "返回活动会话" }).click();
    await page.getByRole("button", { name: "停止 Agent 运行" }).click();
    await waitForTerminalRuns(page);
    await expect(page.getByLabel("会话运行历史")).toContainText("cancelled");

    await archiveConversation(page, conversationB);
    const archiveDrawer = await openHistoryDrawer(page);
    await archiveDrawer.getByRole("tab", { name: "显示已归档会话" }).click();
    await archiveDrawer.getByRole("searchbox", { name: "搜索会话" }).fill("Hold beta");
    await expect(
      archiveDrawer.locator(`[data-conversation-id="${conversationB}"]`)
    ).toBeVisible();
    await archiveDrawer
      .locator(`[data-conversation-id="${conversationB}"]`)
      .getByRole("button", { name: /^恢复会话/ })
      .click();
    await archiveDrawer.getByRole("tab", { name: "显示活跃会话" }).click();
    await archiveDrawer.getByRole("searchbox", { name: "搜索会话" }).fill("");
    await expect(
      archiveDrawer.locator(`[data-conversation-id="${conversationB}"]`)
    ).toBeVisible();
    await closeHistoryDrawer(archiveDrawer);

    await page.reload();
    await openAgentSurface(page);
    await expectConversationsInHistory(page, [conversationA, conversationB]);

    await page.getByLabel("活动栏").getByRole("button", { name: "工作区" }).click();
    await queueDirectorySelection(electronApp, tempRoot);
    await page.getByLabel("项目标题").fill("Project B");
    await page.getByLabel("项目文件夹名称").fill("Project B");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目" }).click();
    await expect(page.getByText("Project B", { exact: true })).toBeVisible();
    await openAgentSurface(page);
    const emptyDrawer = await openHistoryDrawer(page);
    await expect(emptyDrawer.locator(".ns-agent-conversation-row")).toHaveCount(0);
    await closeHistoryDrawer(emptyDrawer);

    await page.getByLabel("活动栏").getByRole("button", { name: "工作区" }).click();
    await queueDirectorySelection(electronApp, projectRoot);
    await page.getByLabel("项目导航").getByRole("button", { name: "打开项目" }).click();
    await waitForConversationService(page);
    await openAgentSurface(page);
    await expectConversationsInHistory(page, [conversationA, conversationB]);

    expect(
      (
        await readdir(join(projectRoot, "history", "conversations"), { withFileTypes: true })
      ).filter((entry) => entry.isDirectory())
    ).toHaveLength(2);
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function openAgentSurface(page: Page): Promise<void> {
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
}

async function queueDirectorySelection(
  electronApp: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function createConversation(page: Page): Promise<string> {
  const drawer = await openHistoryDrawer(page);
  const rows = drawer.locator(".ns-agent-conversation-row");
  const previousCount = await rows.count();
  const selectedBefore = drawer.locator(".ns-agent-conversation-row[data-selected=true]");
  const previousSelected =
    (await selectedBefore.count()) === 0
      ? null
      : await selectedBefore.getAttribute("data-conversation-id");
  await drawer.getByRole("button", { name: "新建会话" }).click();
  await expect(rows).toHaveCount(previousCount + 1);
  const selected = drawer.locator(".ns-agent-conversation-row[data-selected=true]");
  await expect(selected).toBeVisible();
  await expect.poll(() => selected.getAttribute("data-conversation-id")).not.toBe(previousSelected);
  const selectedId = await selected.getAttribute("data-conversation-id");
  if (selectedId === null) throw new Error("Expected selected conversation id");
  await closeHistoryDrawer(drawer);
  await expect(page.getByLabel("会话输入区")).toBeVisible();
  return selectedId;
}

async function selectConversation(page: Page, conversationId: string): Promise<void> {
  const drawer = await openHistoryDrawer(page);
  await drawer
    .locator(`[data-conversation-id="${conversationId}"] button[data-conversation-select]`)
    .click();
  await expect(
    drawer.locator(`[data-conversation-id="${conversationId}"][data-selected=true]`)
  ).toBeVisible();
  await closeHistoryDrawer(drawer);
}

async function archiveConversation(page: Page, conversationId: string): Promise<void> {
  const drawer = await openHistoryDrawer(page);
  const row = drawer.locator(`[data-conversation-id="${conversationId}"]`);
  await row.locator("summary").click();
  await row.getByRole("button", { name: /^归档会话/ }).click();
  await expect(row).toHaveCount(0);
  await closeHistoryDrawer(drawer);
}

async function expectConversationsInHistory(
  page: Page,
  conversationIds: readonly string[]
): Promise<void> {
  const drawer = await openHistoryDrawer(page);
  for (const conversationId of conversationIds) {
    await expect(drawer.locator(`[data-conversation-id="${conversationId}"]`)).toBeVisible();
  }
  await closeHistoryDrawer(drawer);
}

async function openHistoryDrawer(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "历史会话" }).click();
  const drawer = page.getByRole("dialog", { name: "历史会话抽屉" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function closeHistoryDrawer(drawer: Locator): Promise<void> {
  await drawer.getByRole("button", { name: "关闭历史会话" }).click();
  await expect(drawer).toHaveCount(0);
}

async function selectExecutionMode(page: Page): Promise<void> {
  const trigger = page.getByRole("button", {
    name: /执行 · 写作|规划 · 写作|执行 · 通用文件|规划 · 通用文件/
  });
  if ((await trigger.getAttribute("aria-label")) === "执行 · 写作") return;
  await trigger.click();
  await page.getByLabel("运行方式").getByRole("button", { name: "执行", exact: true }).click();
}

async function selectPlanningWritingMode(page: Page): Promise<void> {
  let trigger = page.getByRole("button", {
    name: /执行 · 写作|规划 · 写作|执行 · 通用文件|规划 · 通用文件/
  });
  await trigger.click();
  await page.getByLabel("运行方式").getByRole("button", { name: "规划（只读）" }).click();
  trigger = page.getByRole("button", { name: /规划 · 写作|规划 · 通用文件/ });
  await trigger.click();
  await page.getByLabel("上下文").getByRole("button", { name: "写作", exact: true }).click();
}

async function sendConversationRequest(page: Page, request: string): Promise<void> {
  const composer = page.getByLabel("会话输入区");
  await composer.getByLabel("Agent 请求").fill(request);
  await composer.getByRole("button", { name: "启动 Agent 运行" }).click();
}

async function waitForRunCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => {
      const listed = await page.evaluate(
        async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
        projectId
      );
      return listed?.ok ? listed.value.length : -1;
    })
    .toBe(count);
}

async function latestRunId(page: Page): Promise<string> {
  const runId = await page.evaluate(async (boundProjectId) => {
    const listed = await window.novelStudio?.agentRuns.list(boundProjectId);
    return listed?.ok ? listed.value.at(-1)?.runId : undefined;
  }, projectId);
  if (runId === undefined) throw new Error("Expected a persisted Agent run");
  return runId;
}

async function waitForLatestRunStatus(page: Page, status: string): Promise<void> {
  await expect
    .poll(async () => {
      const listed = await page.evaluate(
        async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
        projectId
      );
      return listed?.ok ? listed.value.at(-1)?.status : undefined;
    })
    .toBe(status);
}

async function waitForTerminalRuns(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const listed = await page.evaluate(
        async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
        projectId
      );
      if (!listed?.ok) return false;
      return listed.value.every((snapshot) =>
        ["completed", "cancelled", "failed", "limit_reached"].includes(snapshot.status)
      );
    })
    .toBe(true);
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

async function waitForConversationService(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const listed = await page.evaluate(
          async (boundProjectId) =>
            window.novelStudio?.agentConversations.list({
              projectId: boundProjectId,
              includeArchived: false,
              limit: 30
            }),
          projectId
        );
        return listed?.ok === true;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
}

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("local-agent");
  await page.getByLabel("密钥引用").fill("local-conversations-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator(".ns-project-feedback")).toContainText(
    "Connected to openai-compatible/local-agent"
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

function messageText(body: Record<string, unknown> | undefined): string {
  const messages = Array.isArray(body?.["messages"]) ? body["messages"] : [];
  return messages
    .flatMap((message) =>
      isRecord(message) && typeof message["content"] === "string" ? [message["content"]] : []
    )
    .join("\n");
}

function lastUserRequest(body: Record<string, unknown>): string {
  const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
  const users = messages.filter(isRecord).filter((message) => message["role"] === "user");
  const content = users.at(-1)?.["content"];
  return typeof content === "string" ? content : "";
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return isRecord(parsed) ? parsed : {};
}

function sendToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  args: Record<string, unknown>
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
