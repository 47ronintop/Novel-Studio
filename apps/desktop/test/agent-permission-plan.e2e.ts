import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import {
  recordPlanExecutionDeviation,
  transitionPlanExecutionStep,
  type PlanExecutionRecord
} from "@novel-studio/agent-engine";
import { AgentRunFileRepository } from "@novel-studio/repository";
import type { JsonObject } from "@novel-studio/shared";
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

test("binds compact permissions to a persisted plan execution and restores revision approval", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-permission-plan-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const userDataRoot = join(tempRoot, "User Data");
  let heldExecutionResponse: ServerResponse | undefined;
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

    if (toolNames(body).includes("finish_plan")) {
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

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正在按批准计划执行。" } }] })}\n\n`
    );
    heldExecutionResponse = response;
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const env = electronEnv({
    NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
    NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot
  });
  let firstApp: ElectronApplication | undefined;
  let restoredApp: ElectronApplication | undefined;

  try {
    firstApp = await electron.launch({ args: [electronMain], env });
    const page = await firstApp.firstWindow();
    await queueDirectorySelection(firstApp, projectRoot);
    await openAgentPanel(page);
    await configureLocalModel(page, baseUrl);
    const composer = page.getByLabel("会话输入区");
    await selectOperationMode(composer, "planning");
    await expect(composer.getByText("只读规划", { exact: true })).toBeVisible();
    await expect(composer.getByLabel(/^修改权限：/)).toHaveCount(0);

    await selectOperationMode(composer, "execution");
    await composer.getByLabel("Agent 请求").fill("先规划，再核对开篇");
    const permissionTrigger = composer.getByLabel("修改权限：每次修改前确认");
    await permissionTrigger.click();
    const permissionMenu = composer.getByRole("dialog", { name: "修改权限与摘要" });
    const permissionSummary = permissionMenu.locator('details[aria-label="本次权限摘要"]');
    await expect(permissionSummary).not.toHaveAttribute("open", "");
    await expect(permissionSummary).toContainText("服务端事实");
    await permissionSummary.locator(":scope > summary").click();
    await expect(permissionSummary).toContainText("Shell");
    await expect(permissionSummary).toContainText("Git");
    await expect(permissionSummary).toContainText("网络");

    await permissionMenu.getByRole("radio", { name: "本次运行自动修改" }).check();
    await expect(composer.getByLabel("启动 Agent 运行")).toBeDisabled();
    await permissionMenu.getByRole("checkbox", { name: "确认本次运行自动修改风险" }).check();
    await expect(composer.getByLabel("启动 Agent 运行")).toBeEnabled();
    await expect(permissionSummary).toContainText("服务端事实");
    await permissionMenu.press("Escape");
    await selectOperationMode(composer, "planning");
    await expect(composer.getByLabel(/^修改权限：/)).toHaveCount(0);
    await composer.getByLabel("启动 Agent 运行").click();

    const planReview = page.getByLabel("Plan Artifact 审阅");
    await expect(planReview).toBeVisible();
    await expect(planReview).toContainText("每次修改前确认");
    await planReview.getByRole("radio", { name: "本次运行自动修改" }).check();
    await planReview
      .getByRole("checkbox", { name: /我理解本次运行可自动修改项目文件/ })
      .check();
    await planReview.getByRole("button", { name: "按此方案执行" }).click();

    const planStep = page.locator('[data-plan-step-id="step-stage5b-01"]');
    await expect(planStep).toBeVisible();
    await expect(planStep).toContainText("核对开篇");
    const planExecutionId = await planStep.getAttribute("data-plan-execution-id");
    expect(planExecutionId).toMatch(/^plan_execution_/);

    const boundPermission = composer.getByLabel("修改权限：本次运行自动修改");
    await expect(boundPermission).toBeVisible();
    await boundPermission.click();
    const boundSummary = composer.locator('details[aria-label="本次权限摘要"]');
    await expect(boundSummary).toContainText("服务端事实");

    const executionRunId = await latestExecutionRunId(page);
    await firstApp.close();
    firstApp = undefined;
    heldExecutionResponse?.destroy();
    heldExecutionResponse = undefined;

    await seedMaterialDeviation(projectRoot, executionRunId);

    restoredApp = await electron.launch({ args: [electronMain], env });
    const restoredPage = await restoredApp.firstWindow();
    await queueDirectorySelection(restoredApp, projectRoot);
    await openAgentPanel(restoredPage, false);
    const revisionCard = restoredPage.getByLabel("计划修订审批");
    await expect(revisionCard).toBeVisible();
    await expect(revisionCard).toContainText("核对开篇并按计划执行");
    await expect(revisionCard).toContainText("发现第二章也受影响");
    await expect(revisionCard).toContainText("将第二章加入计划并重新核对");
    await expect(revisionCard).toContainText("核对开篇");
    const rejectRevision = revisionCard.getByRole("button", { name: "拒绝计划修订" });
    await expect(rejectRevision).toBeVisible();
    await expect(rejectRevision).toBeEnabled();
    await rejectRevision.evaluate((button) => (button as HTMLButtonElement).click());
    await expect.poll(() => latestRunStatus(restoredPage, executionRunId)).toBe("cancelled");
    await expect(revisionCard).toHaveCount(0);
  } finally {
    if (firstApp !== undefined) await firstApp.close();
    if (restoredApp !== undefined) await restoredApp.close();
    heldExecutionResponse?.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function seedMaterialDeviation(projectRoot: string, runId: string): Promise<void> {
  const repository = new AgentRunFileRepository({ projectRoot, traceId: "stage5b-e2e" });
  const snapshotRead = await repository.readSnapshot(runId);
  if (!snapshotRead.ok || snapshotRead.value === undefined) throw new Error("Execution run missing");
  const snapshot = snapshotRead.value;
  const planExecutionId = stringField(snapshot, "planExecutionId");
  const recordRead = await repository.readPlanExecutionRecord(runId, planExecutionId);
  if (!recordRead.ok || recordRead.value === undefined) throw new Error("Plan execution missing");
  const record = recordRead.value as unknown as PlanExecutionRecord;
  const step = record.steps[0];
  if (step === undefined) throw new Error("Plan execution step missing");
  const initialSequence = numberField(snapshot, "lastSequence");
  const initialRunRevision = numberField(snapshot, "runRevision");
  const startedAt = new Date().toISOString();
  const started = transitionPlanExecutionStep(record, {
    stepId: step.stepId,
    status: "running",
    at: startedAt,
    checkpointId: "checkpoint-stage5b-e2e",
    eventSequence: initialSequence + 1
  });
  if (!started.ok) throw new Error(started.error.message);
  const deviated = recordPlanExecutionDeviation(started.value, {
    stepId: step.stepId,
    change: "scope_expanded",
    summary: "执行范围新增第二章",
    eventSequence: initialSequence + 2
  });
  if (!deviated.ok) throw new Error(deviated.error.message);
  const requestId = "plan-revision-stage5b-e2e";
  const requestedPlanRevision = record.planRevision + 1;
  const request = {
    schemaVersion: "1.0",
    requestId,
    runId,
    planExecutionId,
    planId: record.planId,
    planRevision: requestedPlanRevision,
    affectedStepIds: [step.stepId],
    discovery: "发现第二章也受影响",
    proposal: "将第二章加入计划并重新核对",
    createdAt: startedAt
  } satisfies JsonObject;
  const recordWritten = await repository.writePlanExecutionRecord(
    deviated.value.record as unknown as JsonObject
  );
  const requestWritten = await repository.writePlanRevisionRequest(request);
  if (!recordWritten.ok || !requestWritten.ok) throw new Error("Failed to seed plan deviation");

  const events = [
    {
      type: "plan_step_started",
      detail: {
        planExecutionId,
        stepId: step.stepId,
        checkpointId: "checkpoint-stage5b-e2e"
      }
    },
    {
      type: "plan_deviation_recorded",
      detail: {
        planExecutionId,
        stepId: step.stepId,
        kind: "material",
        summary: "执行范围新增第二章"
      }
    },
    {
      type: "plan_revision_requested",
      detail: {
        requestId,
        planExecutionId,
        planId: record.planId,
        planRevision: requestedPlanRevision,
        affectedStepIds: [step.stepId],
        discovery: request.discovery,
        proposal: request.proposal
      }
    }
  ] as const;
  for (const [index, event] of events.entries()) {
    const sequence = initialSequence + index + 1;
    const written = await repository.appendEvent({
      schemaVersion: "1.1",
      runId,
      projectId,
      sequence,
      runRevision: initialRunRevision + index + 1,
      type: event.type,
      createdAt: new Date(Date.parse(startedAt) + index).toISOString(),
      detail: event.detail
    });
    if (!written.ok) throw new Error(written.error.message);
  }
  const snapshotWritten = await repository.writeSnapshot({
    ...snapshot,
    status: "awaiting_plan_revision",
    runRevision: initialRunRevision + events.length,
    lastSequence: initialSequence + events.length,
    planExecutionRevision: deviated.value.record.revision,
    updatedAt: new Date(Date.parse(startedAt) + events.length).toISOString()
  });
  if (!snapshotWritten.ok) throw new Error(snapshotWritten.error.message);
}

async function selectOperationMode(
  composer: ReturnType<Page["getByLabel"]>,
  mode: "planning" | "execution"
): Promise<void> {
  const expected = mode === "planning" ? /^规划 · / : /^执行 · /;
  if ((await composer.getByRole("button", { name: expected }).count()) > 0) return;
  await composer
    .getByRole("button", { name: /^(规划|执行) · (写作上下文|文件上下文)$/ })
    .click();
  const modes = composer.getByLabel("运行方式");
  await modes
    .getByRole("button", { name: mode === "planning" ? "规划（只读）" : "执行", exact: true })
    .click();
}

async function latestExecutionRunId(page: Page): Promise<string> {
  const runId = await page.evaluate(async (boundProjectId) => {
    const listed = await window.novelStudio?.agentRuns.list(boundProjectId);
    if (listed?.ok !== true) return undefined;
    return listed.value.find((run) => run.operationMode === "execution")?.runId;
  }, projectId);
  if (runId === undefined) throw new Error("Expected an execution run");
  return runId;
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
  await expect(page.locator(".ns-project-feedback")).toContainText(
    "Connected to openai-compatible/local-agent"
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

function toolNames(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body["tools"])) return [];
  return body["tools"].flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || Array.isArray(tool)) return [];
    const fn = (tool as Record<string, unknown>)["function"];
    if (typeof fn !== "object" || fn === null || Array.isArray(fn)) return [];
    const name = (fn as Record<string, unknown>)["name"];
    return typeof name === "string" ? [name] : [];
  });
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

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

function stringField(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`Missing ${key}`);
  return field;
}

function numberField(value: JsonObject, key: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field)) throw new Error(`Missing ${key}`);
  return Number(field);
}
