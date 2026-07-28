import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from "@playwright/test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const standaloneScope = { kind: "standalone", scopeId: "standalone" } as const;

test("keeps standalone conversations project-free across fresh production startup and restart", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-standalone-e2e-"));
  const userDataRoot = join(tempRoot, "User Data");
  const minimalChapterRoot = join(userDataRoot, "projects", "minimal-chapter");
  const modelRequests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, {
        data: [
          {
            id: "plain-text-only",
            context_window: 32_768,
            capabilities: {
              streaming: true,
              tool_calling: false,
              structured_arguments: false
            }
          }
        ]
      });
      return;
    }

    const body = await readJsonBody(request);
    if (request.method !== "POST" || body["stream"] !== true) {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }

    modelRequests.push(body);
    sendTextCompletion(response, `Standalone response for ${lastUserRequest(body)}`);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address for the local standalone model server.");
  }

  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await launchStandaloneElectron(userDataRoot);
    let page = await electronApp.firstWindow();

    await expectStandaloneShell(page);
    await expect(page.getByText("未命名长篇项目", { exact: true })).toHaveCount(0);
    await expectPathAbsent(minimalChapterRoot);
    await expectStandaloneConversationSurface(page);

    await configureTextOnlyModel(page, `http://127.0.0.1:${address.port}/v1`);

    const primaryConversationId = await createConversation(page);
    const composer = page.getByLabel("会话输入区");
    await expect(composer.getByTitle("选择计划或执行模式")).toHaveCount(0);
    await expect(composer.getByLabel("添加引用与执行审批")).toHaveCount(0);
    const primaryRequest = "STANDALONE_E2E_PRIMARY_MARKER";
    await sendConversationRequest(page, primaryRequest);
    await waitForLatestStandaloneRunStatus(page, "completed");
    await expect(
      page
        .locator('.ns-agent-conversation-message[data-speaker="assistant"]')
        .filter({ hasText: `Standalone response for ${primaryRequest}` })
    ).toBeVisible();

    const archiveConversationId = await createConversation(page);
    const archiveRequest = "STANDALONE_E2E_ARCHIVE_MARKER";
    await sendConversationRequest(page, archiveRequest);
    await waitForLatestStandaloneRunStatus(page, "completed");
    await expect.poll(() => modelRequests.length, { timeout: 30_000 }).toBe(2);

    for (const request of modelRequests) {
      expect(request["tools"] ?? []).toEqual([]);
      expect(request["functions"]).toBeUndefined();
      expect(request["tool_choice"]).toBeUndefined();
      assertStandaloneProviderPayload(request, {
        repositoryRoot,
        tempRoot,
        userDataRoot,
        minimalChapterRoot
      });
    }

    await archiveConversation(page, archiveConversationId);
    const archivedDrawer = await openHistoryDrawer(page);
    await archivedDrawer.getByRole("tab", { name: "显示已归档会话" }).click();
    const search = archivedDrawer.getByRole("searchbox", { name: "搜索会话" });
    await search.fill(archiveRequest);
    const archivedConversation = archivedDrawer.locator(
      `[data-conversation-id="${archiveConversationId}"]`
    );
    await expect(archivedConversation).toBeVisible();
    await Promise.all([
      page.waitForEvent("dialog").then(async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toContain("确定删除归档会话");
        await dialog.accept();
      }),
      archivedConversation.getByRole("button", { name: /^删除会话/ }).click()
    ]);
    await expect(archivedConversation).toHaveCount(0);
    await archivedDrawer.getByRole("tab", { name: "显示活跃会话" }).click();
    await search.fill("");
    const primaryConversation = archivedDrawer.locator(
      `[data-conversation-id="${primaryConversationId}"]`
    );
    await expect(primaryConversation).toBeVisible();
    await primaryConversation.locator("button[data-conversation-select]").click();
    await expect(primaryConversation).toHaveAttribute("data-selected", "true");
    const expectedConversationIds = await conversationIds(archivedDrawer);
    await closeHistoryDrawer(archivedDrawer);

    await electronApp.close();
    electronApp = undefined;
    electronApp = await launchStandaloneElectron(userDataRoot);
    page = await electronApp.firstWindow();
    await expectStandaloneShell(page);
    await expectPathAbsent(minimalChapterRoot);
    await expectStandaloneConversationSurface(page);

    const reloadedDrawer = await openHistoryDrawer(page);
    const reloadedPrimaryConversation = reloadedDrawer.locator(
      `[data-conversation-id="${primaryConversationId}"]`
    );
    await expect(reloadedPrimaryConversation).toBeVisible();
    await expect(reloadedPrimaryConversation).toHaveAttribute("data-selected", "true");
    await expect(
      reloadedDrawer.locator(`[data-conversation-id="${archiveConversationId}"]`)
    ).toHaveCount(0);
    await expect.poll(() => conversationIds(reloadedDrawer)).toEqual(expectedConversationIds);
    await closeHistoryDrawer(reloadedDrawer);
  } finally {
    await electronApp?.close();
    await closeServer(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function launchStandaloneElectron(userDataRoot: string): Promise<ElectronApplication> {
  const env = { ...process.env, NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot };
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["NOVEL_STUDIO_PROJECT_ROOT"];
  return electron.launch({ args: [electronMain], env });
}

async function expectStandaloneConversationSurface(page: Page): Promise<void> {
  await expect(page.getByLabel("Agent 会话主视图")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "新建会话" }).first()).toBeEnabled();
}

async function expectStandaloneShell(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(async () => window.novelStudio?.getShellState());
        return state?.workspaceContext.kind;
      },
      { timeout: 15_000 }
    )
    .toBe("none");
}

async function configureTextOnlyModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("plain-text-only");
  await page.getByLabel("密钥引用").fill("standalone-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator('.ns-project-feedback[role="status"]')).toHaveText(
    "Connected to openai-compatible/plain-text-only."
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

async function createConversation(page: Page): Promise<string> {
  const drawer = await openHistoryDrawer(page);
  const rows = drawer.locator(".ns-agent-conversation-row");
  const previousCount = await rows.count();
  const previousSelected = drawer.locator(".ns-agent-conversation-row[data-selected=true]");
  const previousSelectedId =
    (await previousSelected.count()) === 0
      ? null
      : await previousSelected.getAttribute("data-conversation-id");
  await drawer.getByRole("button", { name: "新建会话" }).click();
  await expect(rows).toHaveCount(previousCount + 1);
  const selected = drawer.locator(".ns-agent-conversation-row[data-selected=true]");
  await expect(selected).toBeVisible();
  await expect
    .poll(() => selected.getAttribute("data-conversation-id"))
    .not.toBe(previousSelectedId);
  const conversationId = await selected.getAttribute("data-conversation-id");
  if (conversationId === null) throw new Error("Expected a selected standalone conversation id.");
  await closeHistoryDrawer(drawer);
  await expect(page.getByLabel("会话输入区")).toBeVisible();
  return conversationId;
}

async function sendConversationRequest(page: Page, request: string): Promise<void> {
  const composer = page.getByLabel("会话输入区");
  await composer.getByLabel("Agent 请求").fill(request);
  await composer.getByRole("button", { name: "启动 Agent 运行" }).click();
  await expect(
    page
      .getByLabel("Agent 会话主视图")
      .locator('.ns-agent-conversation-user-message[data-speaker="user"]')
      .filter({ hasText: request })
  ).toBeVisible();
}

async function archiveConversation(page: Page, conversationId: string): Promise<void> {
  const drawer = await openHistoryDrawer(page);
  const row = drawer.locator(`[data-conversation-id="${conversationId}"]`);
  await row.locator("summary").click();
  await row.getByRole("button", { name: /^归档会话/ }).click();
  await expect(row).toHaveCount(0);
  await closeHistoryDrawer(drawer);
}

async function openHistoryDrawer(page: Page) {
  await page.getByRole("button", { name: "历史会话" }).click();
  const drawer = page.getByRole("dialog", { name: "历史会话抽屉" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function closeHistoryDrawer(drawer: Locator): Promise<void> {
  await drawer.getByRole("button", { name: "关闭历史会话" }).click();
  await expect(drawer).toHaveCount(0);
}

async function conversationIds(drawer: Locator): Promise<readonly string[]> {
  const ids = await drawer.locator(".ns-agent-conversation-row").evaluateAll((rows) =>
    rows
      .map((row) => row.getAttribute("data-conversation-id"))
      .filter((id): id is string => id !== null)
      .sort()
  );
  return ids;
}

async function waitForLatestStandaloneRunStatus(page: Page, status: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const listed = await page.evaluate(
          async (scope) => window.novelStudio?.agentRuns.list(scope),
          standaloneScope
        );
        if (listed === undefined) return "agent-runs-api-unavailable";
        return listed.ok
          ? (listed.value.at(-1)?.status ?? "no-persisted-run")
          : `${listed.error.code}: ${listed.error.message}`;
      },
      { timeout: 30_000 }
    )
    .toBe(status);
}

function assertStandaloneProviderPayload(
  request: Record<string, unknown>,
  forbiddenRoots: Record<string, string>
): void {
  expect(hasKey(request, "cwd")).toBe(false);
  expect(hasKey(request, "projectId")).toBe(false);
  expect(hasKey(request, "workspaceId")).toBe(false);
  expect(hasKey(request, "contentRoot")).toBe(false);

  const payload = JSON.stringify(request).replaceAll("\\\\", "/");
  for (const root of Object.values(forbiddenRoots)) {
    expect(payload).not.toContain(root.replaceAll("\\", "/"));
  }

  const projectContextKinds = projectContextSourceKinds(request);
  expect(projectContextKinds).not.toContain("project_conventions");
  expect(projectContextKinds).not.toContain("workspace_outline");
  expect(payload).not.toContain("project_conventions");
  expect(payload).not.toContain("workspace_outline");
}

function projectContextSourceKinds(request: Record<string, unknown>): readonly string[] {
  const messages = Array.isArray(request["messages"]) ? request["messages"] : [];
  return messages.flatMap((message) => {
    if (!isRecord(message) || typeof message["content"] !== "string") return [];
    try {
      const payload = JSON.parse(message["content"]) as unknown;
      if (!isRecord(payload) || payload["kind"] !== "untrusted_project_data") return [];
      const source = payload["source"];
      return isRecord(source) && typeof source["sourceKind"] === "string"
        ? [source["sourceKind"]]
        : [];
    } catch {
      return [];
    }
  });
}

function hasKey(value: unknown, expectedKey: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, expectedKey));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) => key === expectedKey || hasKey(child, expectedKey)
  );
}

async function expectPathAbsent(path: string): Promise<void> {
  await expect.poll(async () => pathExists(path)).toBe(false);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  );
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

function lastUserRequest(body: Record<string, unknown>): string {
  const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
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

function sendTextCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}
