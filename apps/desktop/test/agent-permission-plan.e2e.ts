import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const projectId = "prj_minimal_chapter";
const activeChapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";

test("persists a plan review and fails closed when the provider stream is incomplete", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-permission-plan-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const userDataRoot = join(tempRoot, "User Data");
  let planSent = false;
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
    if (isConnectionProbe(body)) {
      sendConnectionProbe(response);
      return;
    }

    if (!planSent) {
      planSent = true;
      sendToolCall(response, "stage5b-plan", "finish_plan", {
        planId: "plan-stage5b-e2e",
        goal: "核对开篇并按计划执行",
        successCriteria: ["完成开篇核对"],
        nonGoals: ["不扩大项目范围"],
        facts: ["当前章节是执行目标"],
        assumptions: [],
        openQuestions: [],
        targetRefs: [{ refId: `chapter:${activeChapterId}`, intent: "核对" }],
        steps: [{ stepId: "step-stage5b-01", title: "核对开篇", verification: "重新读取章节" }],
        risks: ["执行中可能发现范围变化"],
        verification: ["确认章节仍在项目内"],
        sourceRefs: [`chapter:${activeChapterId}`]
      });
      return;
    }

    response.end("data: [DONE]\n\n");
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const env = electronEnv({
    NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
    NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot
  });
  let firstApp: ElectronApplication | undefined;

  try {
    firstApp = await electron.launch({ args: [electronMain], env });
    const page = await firstApp.firstWindow();
    await queueDirectorySelection(firstApp, projectRoot);
    await openAgentPanel(page);
    await chooseWorkspaceModelSharing(page);
    await configureLocalModel(page, baseUrl);
    const composer = page.getByLabel("会话输入区");
    await selectOperationMode(page, composer, "planning");
    await expect(composer.getByRole("button", { name: "计划", exact: true })).toBeVisible();
    await composer.getByLabel("添加引用与执行审批").click();
    const planningOptions = page.getByRole("dialog", { name: "添加引用与执行审批" });
    await expect(planningOptions.getByLabel("执行审批")).toHaveCount(0);
    await planningOptions.press("Escape");

    await selectOperationMode(page, composer, "execution");
    await composer.getByLabel("Agent 请求").fill("先规划，再核对开篇");
    const permissionTrigger = composer.getByLabel("添加引用与执行审批");
    await permissionTrigger.click();
    const permissionMenu = page.getByRole("dialog", { name: "添加引用与执行审批" });
    const permissionSummary = permissionMenu.locator('details[aria-label="本次权限摘要"]');
    await expect(permissionSummary).not.toHaveAttribute("open", "");
    await expect(permissionSummary).toContainText("服务端事实");
    await permissionSummary.locator(":scope > summary").click();
    await expect(permissionSummary).toContainText("Shell");
    await expect(permissionSummary).toContainText("Git");
    await expect(permissionSummary).toContainText("网络");

    const requestApproval = permissionMenu.getByRole("radio", { name: "请求批准" });
    const preapproveRun = permissionMenu.getByRole("radio", { name: "替我审批" });
    await expect(requestApproval).toBeChecked();
    await expect(requestApproval).toBeEnabled();
    await expect(preapproveRun).toBeDisabled();
    await expect(permissionMenu.getByRole("checkbox")).toHaveCount(0);
    await expect(composer.getByLabel("启动 Agent 运行")).toBeEnabled();
    await expect(permissionSummary).toContainText("服务端事实");
    await permissionMenu.press("Escape");
    await selectOperationMode(page, composer, "planning");
    await composer.getByLabel("启动 Agent 运行").click();
    await expect(
      page
        .getByLabel("Agent 会话主视图")
        .locator('.ns-agent-conversation-user-message[data-speaker="user"]')
        .filter({ hasText: "先规划，再核对开篇" })
    ).toBeVisible();
    await expect
      .poll(async () => {
        const listed = await page.evaluate(async (boundProjectId) => {
          return window.novelStudio?.agentRuns.list(boundProjectId);
        }, projectId);
        const runId = listed?.ok === true ? listed.value[0]?.runId : undefined;
        return runId === undefined ? undefined : latestRunStatus(page, runId);
      })
      .toBe("plan_ready");
    // The run-event subscription updates the conversation timeline asynchronously. Rehydrate the
    // persisted artifact before asserting its review surface instead of racing that projection.
    await page.reload();
    await openAgentPanel(page, false);

    const planReview = page.getByLabel("Plan Artifact 审阅");
    await expect(planReview).toBeVisible();
    await expect(planReview).toContainText("每次修改前确认");
    await expect(planReview.getByRole("radio", { name: "每次修改前确认" })).toBeChecked();
    await expect(planReview.getByRole("radio", { name: "本次运行自动修改" })).toBeDisabled();
    await expect(planReview.getByRole("checkbox")).toHaveCount(0);
    await planReview.getByRole("button", { name: "按此方案执行" }).click();

    await expect(page.getByRole("alert")).toContainText("streamTermination");
    await expect(page.locator('[data-plan-step-id="step-stage5b-01"]')).toBeVisible();
  } finally {
    if (firstApp !== undefined) await firstApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function selectOperationMode(
  page: Page,
  composer: ReturnType<Page["getByLabel"]>,
  mode: "planning" | "execution"
): Promise<void> {
  const expected = mode === "planning" ? "计划" : "执行";
  const trigger = composer.getByTitle("选择计划或执行模式");
  if ((await trigger.getAttribute("aria-label")) === expected) return;
  await trigger.click();
  const modes = page.getByLabel("计划或执行模式");
  await modes.getByRole("button", { name: expected, exact: true }).click();
}

async function latestRunStatus(page: Page, runId: string): Promise<string | undefined> {
  return page.evaluate(async (boundRunId) => {
    const read = await window.novelStudio?.agentRuns.read(boundRunId);
    return read?.ok === true ? read.value.snapshot.status : undefined;
  }, runId);
}

async function openAgentPanel(page: Page, createIfEmpty = true): Promise<void> {
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
  const newConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (createIfEmpty && (await newConversation.isVisible())) {
    await newConversation.click();
  }
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

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("local-agent");
  await page.getByLabel("密钥引用").fill("local-stage5b-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page
      .locator(".ns-project-feedback")
      .filter({ hasText: "Connected to openai-compatible/local-agent" })
  ).toContainText("Connected to openai-compatible/local-agent");
  await page.getByRole("button", { name: "关闭设置" }).click();
}

async function chooseWorkspaceModelSharing(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        novelStudio?: {
          workspace?: {
            updateContextPolicy?: (update: unknown) => Promise<{ readonly ok: boolean }>;
          };
        };
      }
    ).novelStudio;
    return api?.workspace?.updateContextPolicy?.({
      action: "set_sharing_defaults",
      defaults: {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "allow",
        toolReadResults: "allow"
      }
    });
  });
  expect(result).toMatchObject({ ok: true });
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function isConnectionProbe(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
  return body["stream"] === true && messages.some(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      !Array.isArray(message) &&
      (message as Record<string, unknown>)["role"] === "user" &&
      (message as Record<string, unknown>)["content"] === "ping"
  );
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendConnectionProbe(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
