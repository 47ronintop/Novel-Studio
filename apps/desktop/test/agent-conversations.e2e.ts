import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from "@playwright/test";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const screenshotRoot = join(repositoryRoot, "test-results", "agent-composer-layout");
const projectId = "prj_minimal_chapter";

test("isolates multi-run conversation context and restores project-scoped conversations", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-conversations-e2e-"));
  await mkdir(screenshotRoot, { recursive: true });
  const projectRoot = join(tempRoot, "Project A");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const modelRequests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, {
        data: [
          {
            id: "local-agent",
            context_window: 128000,
            capabilities: {
              streaming: true,
              tool_calling: true,
              structured_arguments: true
            }
          }
        ]
      });
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
    await openQueuedCreativeProject(page);
    await openAgentSurface(page);
    await configureLocalModel(page, `http://127.0.0.1:${address.port}/v1`);
    const conversationA = await selectedConversation(page);
    const composer = page.getByLabel("会话输入区");
    await expect(composer.getByLabel(/^模型与推理：/)).toBeVisible();
    await assertComposerLayout(composer);
    await assertComposerPopover(
      page,
      composer.getByLabel("添加引用与执行审批"),
      "添加引用与执行审批",
      "composer-default-add.png"
    );
    await assertComposerPopover(
      page,
      composer.getByLabel(/^模型与推理：/),
      "选择模型与推理强度",
      "composer-default-model.png"
    );
    const defaultComposerWidth = (await composer.boundingBox())?.width;
    expect(defaultComposerWidth).toBeDefined();
    await page.locator(".ns-workspace-grid").evaluate((grid) => {
      (grid as HTMLElement).style.setProperty("--ns-ai-panel-width", "280px");
    });
    await expect
      .poll(async () => (await composer.boundingBox())?.width ?? 0)
      .toBeLessThan(defaultComposerWidth ?? 0);
    await assertComposerLayout(composer);
    await assertComposerPopover(
      page,
      composer.getByLabel("添加引用与执行审批"),
      "添加引用与执行审批",
      "composer-280px-add.png"
    );
    await assertComposerPopover(
      page,
      composer.getByLabel(/^模型与推理：/),
      "选择模型与推理强度",
      "composer-280px-model.png"
    );
    await page.locator(".ns-workspace-grid").evaluate((grid) => {
      (grid as HTMLElement).style.setProperty("--ns-ai-panel-width", "320px");
    });
    await assertComposerLayout(composer);
    await assertComposerPopover(
      page,
      composer.getByLabel("添加引用与执行审批"),
      "添加引用与执行审批",
      "composer-320px-add.png"
    );
    await assertComposerPopover(
      page,
      composer.getByLabel(/^模型与推理：/),
      "选择模型与推理强度",
      "composer-320px-model.png"
    );
    await expect(page.getByLabel("AI 对话面板")).toBeVisible();
    await expect(page.getByLabel("Agent 请求")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /启动 Agent 运行|停止 Agent 运行/ })).toHaveCount(
      1
    );
    await expect(
      page.getByRole("button", {
        name: /^(计划|执行)$/
      })
    ).toHaveCount(1);
    await expect(page.getByLabel("AI 对话记录")).toHaveCount(0);
    await expect(page.getByLabel("AI 写作工作流")).toHaveCount(0);
    await expect(page.getByLabel("AI 文风规则检查")).toHaveCount(0);
    await expect(page.getByLabel("工作流运行历史")).toHaveCount(0);
    await expect(page.getByLabel("AI 工作流运行观测")).toHaveCount(0);

    await selectPlanningWritingMode(page);
    await expect(page.getByRole("button", { name: "计划", exact: true })).toHaveCount(1);
    await composer.getByLabel("添加引用与执行审批").click();
    const planningMenu = page.getByRole("dialog", { name: "添加引用与执行审批" });
    await expect(planningMenu.getByLabel("执行审批")).toHaveCount(0);
    await planningMenu.press("Escape");
    await expect(page.getByLabel("计划或执行模式")).toHaveCount(0);
    await expect(page.getByLabel("会话输入区").getByRole("group", { name: "上下文" })).toHaveCount(
      0
    );
    await selectExecutionMode(page);
    await composer.getByLabel("添加引用与执行审批").click();
    const permissionMenu = page.getByRole("dialog", { name: "添加引用与执行审批" });
    await expect(permissionMenu.locator('details[aria-label="本次权限摘要"]')).toContainText(
      "服务端事实"
    );
    await permissionMenu.getByRole("radio", { name: "替我审批" }).check();
    await expect(permissionMenu.getByRole("checkbox")).toHaveCount(0);
    await permissionMenu.press("Escape");

    await sendConversationRequest(page, "Remember the alpha lantern clue.");
    await waitForRunCount(page, 1);
    await waitForLatestRunStatus(page, "completed");
    await expect(composer.getByLabel("添加引用与执行审批")).toBeVisible();
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
    await expect(page.getByLabel("会话输入区").getByLabel("添加引用与执行审批")).toBeVisible();
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
    await expect(archiveDrawer.locator(`[data-conversation-id="${conversationB}"]`)).toBeVisible();
    await archiveDrawer
      .locator(`[data-conversation-id="${conversationB}"]`)
      .getByRole("button", { name: /^恢复会话/ })
      .click();
    await archiveDrawer.getByRole("tab", { name: "显示活跃会话" }).click();
    await archiveDrawer.getByRole("searchbox", { name: "搜索会话" }).fill("");
    await expect(archiveDrawer.locator(`[data-conversation-id="${conversationB}"]`)).toBeVisible();
    await closeHistoryDrawer(archiveDrawer);

    await page.reload();
    await openAgentSurface(page);
    await expectConversationsInHistory(page, [conversationA, conversationB]);

    await queueDirectorySelection(electronApp, tempRoot);
    await createQueuedCreativeProject(page, {
      folderName: "Project B",
      projectId: "prj_project_b",
      title: "Project B"
    });
    await expect(page.getByRole("banner").getByText("Project B", { exact: true })).toBeVisible();
    await openAgentSurface(page);
    const preparedDrawer = await openHistoryDrawer(page);
    await expect(preparedDrawer.locator(".ns-agent-conversation-row")).toHaveCount(1);
    await expect(
      preparedDrawer.locator(".ns-agent-conversation-row[data-selected=true]")
    ).toBeVisible();
    await closeHistoryDrawer(preparedDrawer);

    await queueDirectorySelection(electronApp, projectRoot);
    await openQueuedCreativeProject(page);
    await waitForConversationService(page);
    await openAgentSurface(page);
    await expectConversationsInHistory(page, [conversationA, conversationB]);

    await archiveConversation(page, conversationB);
    const archivedDrawer = await openHistoryDrawer(page);
    await archivedDrawer.getByRole("tab", { name: "显示已归档会话" }).click();
    const archivedConversation = archivedDrawer.locator(
      `[data-conversation-id="${conversationB}"]`
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
    await closeHistoryDrawer(archivedDrawer);

    await page.reload();
    await openAgentSurface(page);
    const reloadedDrawer = await openHistoryDrawer(page);
    await expect(reloadedDrawer.locator(`[data-conversation-id="${conversationA}"]`)).toBeVisible();
    await expect(reloadedDrawer.locator(`[data-conversation-id="${conversationB}"]`)).toHaveCount(
      0
    );
    await expect(reloadedDrawer.locator(".ns-agent-conversation-row")).toHaveCount(1);
    await closeHistoryDrawer(reloadedDrawer);

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

async function openQueuedCreativeProject(page: Page): Promise<void> {
  const opened = await page.evaluate(async () => {
    const selected = await window.novelStudio?.project.chooseOpenCreativeDirectory();
    if (selected?.ok !== true || selected.value.selectionId === undefined) return selected;
    return window.novelStudio?.project.openCreativeProject(selected.value.selectionId);
  });
  if (opened?.ok !== true) {
    throw new Error(`Creative project activation failed: ${JSON.stringify(opened)}`);
  }
  await page.reload();
  await expect(page.getByLabel("项目导航")).toBeVisible({ timeout: 15_000 });
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

async function selectedConversation(page: Page): Promise<string> {
  const drawer = await openHistoryDrawer(page);
  const selected = drawer.locator(".ns-agent-conversation-row[data-selected=true]");
  await expect(selected).toBeVisible();
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
  const trigger = page.getByTitle("选择计划或执行模式");
  if ((await trigger.getAttribute("aria-label")) === "执行") return;
  await trigger.click();
  await page
    .getByLabel("计划或执行模式")
    .getByRole("button", { name: "执行", exact: true })
    .click();
}

async function selectPlanningWritingMode(page: Page): Promise<void> {
  const trigger = page.getByTitle("选择计划或执行模式");
  if ((await trigger.getAttribute("aria-label")) === "计划") return;
  await trigger.click();
  await page
    .getByLabel("计划或执行模式")
    .getByRole("button", { name: "计划", exact: true })
    .click();
}

async function sendConversationRequest(page: Page, request: string): Promise<void> {
  const composer = page.getByLabel("会话输入区");
  await composer.getByLabel("Agent 请求").fill(request);
  await composer.getByRole("button", { name: "启动 Agent 运行" }).click();
}

async function waitForRunCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const listed = await page.evaluate(
          async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
          projectId
        );
        return listed?.ok ? listed.value.length : -1;
      },
      { timeout: 30_000 }
    )
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
    .poll(
      async () => {
        const listed = await page.evaluate(
          async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
          projectId
        );
        return listed?.ok ? listed.value.at(-1)?.status : undefined;
      },
      { timeout: 30_000 }
    )
    .toBe(status);
}

async function waitForTerminalRuns(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const listed = await page.evaluate(
          async (boundProjectId) => window.novelStudio?.agentRuns.list(boundProjectId),
          projectId
        );
        if (!listed?.ok) return false;
        return listed.value.every((snapshot) =>
          ["completed", "cancelled", "failed", "limit_reached"].includes(snapshot.status)
        );
      },
      { timeout: 30_000 }
    )
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

async function assertComposerLayout(composer: Locator): Promise<void> {
  const surface = composer.locator(".ns-agent-composer-surface");
  const footer = composer.locator(".ns-agent-composer-footer");
  const add = composer.locator(".ns-agent-composer-add-popover-root");
  const mode = composer.locator(".ns-agent-composer-mode-popover-root");
  const context = composer.locator(".ns-agent-context-popover-root");
  const model = composer.locator(".ns-agent-composer-model-popover-root");
  const command = composer.locator(".ns-agent-composer-command-slot");
  await expect(footer).toBeVisible();
  await expect(add).toBeVisible();
  await expect(mode).toBeVisible();
  await expect(context).toBeVisible();

  const [surfaceBox, footerBox, addBox, modeBox, contextBox, modelBox, commandBox] =
    await Promise.all([
      surface.boundingBox(),
      footer.boundingBox(),
      add.boundingBox(),
      mode.boundingBox(),
      context.boundingBox(),
      model.boundingBox(),
      command.boundingBox()
    ]);
  expect(surfaceBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(addBox).not.toBeNull();
  expect(modeBox).not.toBeNull();
  expect(contextBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(commandBox).not.toBeNull();
  if (
    surfaceBox === null ||
    footerBox === null ||
    addBox === null ||
    modeBox === null ||
    contextBox === null ||
    modelBox === null ||
    commandBox === null
  ) {
    return;
  }

  const metrics = JSON.stringify({
    surfaceBox,
    footerBox,
    addBox,
    modeBox,
    contextBox,
    modelBox,
    commandBox
  });
  expect(footerBox.height, metrics).toBeLessThanOrEqual(34);
  expect(addBox.x + addBox.width, metrics).toBeLessThanOrEqual(modeBox.x + 1);
  expect(modeBox.x + modeBox.width, metrics).toBeLessThanOrEqual(contextBox.x + 1);
  expect(contextBox.x + contextBox.width, metrics).toBeLessThanOrEqual(modelBox.x + 1);
  expect(modelBox.x + modelBox.width, metrics).toBeLessThanOrEqual(commandBox.x + 1);
  expect(modelBox.width, metrics).toBeGreaterThanOrEqual(72);
  expect(commandBox.width, metrics).toBeGreaterThanOrEqual(30);
  for (const box of [footerBox, addBox, modeBox, contextBox, modelBox, commandBox]) {
    expect(box.x, metrics).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(box.x + box.width, metrics).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width + 1);
  }
  await expect(composer.locator(".ns-agent-composer-mode-trigger")).toHaveCSS("font-size", "12px");
}

async function assertComposerPopover(
  page: Page,
  trigger: Locator,
  panelLabel: string,
  screenshotName: string
): Promise<void> {
  await trigger.click();
  const panel = page.getByRole("dialog", { name: panelLabel });
  await expect(panel).toBeVisible();
  const [panelBox, triggerBox, viewport] = await Promise.all([
    panel.boundingBox(),
    trigger.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  ]);
  expect(panelBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  if (panelBox !== null && triggerBox !== null) {
    const metrics = JSON.stringify({ panelBox, triggerBox, viewport });
    expect(panelBox.width, metrics).toBeGreaterThan(0);
    expect(panelBox.height, metrics).toBeGreaterThan(0);
    expect(panelBox.x + panelBox.width, metrics).toBeGreaterThan(0);
    expect(panelBox.y + panelBox.height, metrics).toBeGreaterThan(0);
    expect(panelBox.x, metrics).toBeLessThan(viewport.width);
    expect(panelBox.y, metrics).toBeLessThan(viewport.height);
    expect(panelBox.y + panelBox.height, metrics).toBeLessThanOrEqual(triggerBox.y + 1);
  }
  await page.screenshot({ path: join(screenshotRoot, screenshotName) });
  await panel.press("Escape");
  await expect(panel).toHaveCount(0);
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
  await expect(
    page
      .locator(".ns-project-feedback")
      .filter({ hasText: "Connected to openai-compatible/local-agent" })
  ).toContainText("Connected to openai-compatible/local-agent");
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
