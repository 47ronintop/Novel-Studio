import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const firstChapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const secondChapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
const firstBody = "Original chapter body.\n";
const secondBody = "Second original body.\n";

test("keeps source-built execution read-only until a signed package is qualified", async () => {
  test.setTimeout(120_000);
  const scenario = await launchScenario();
  const firstPath = join(scenario.projectRoot, "chapters", `${firstChapterId}.md`);
  const secondPath = join(scenario.projectRoot, "chapters", `${secondChapterId}.md`);
  const firstBaseline = await readFile(firstPath, "utf8");
  const secondBaseline = await readFile(secondPath, "utf8");

  try {
    await startAutonomousExecution(scenario.page);
    await expect
      .poll(() => readLatestPermissionSummary(scenario.page), { timeout: 30_000 })
      .toMatchObject({
        ok: true,
        value: { forbiddenCapabilities: expect.arrayContaining(["operation:chapter_replace"]) }
      });
    const capabilitySummary = scenario.page.getByLabel("运行能力摘要");
    await expect(capabilitySummary).toContainText("只读执行");
    await expect(scenario.page.getByRole("button", { name: "撤销本次运行" })).toHaveCount(0);
    scenario.releaseProviderResponse();
    await expect
      .poll(async () => readLatestAgentRun(scenario.page), { timeout: 30_000 })
      .toMatchObject({ ok: true, value: { snapshot: { status: "completed" } } });
    const completedRun = await readLatestAgentRun(scenario.page);
    expect(agentRunEventTypes(completedRun)).not.toContain("change_set_ready");
    expect(agentRunEventTypes(completedRun)).not.toContain("write_applied");
    expect(await readFile(firstPath, "utf8")).toBe(firstBaseline);
    expect(await readFile(secondPath, "utf8")).toBe(secondBaseline);
    expect(
      (await readTransactionJournals(scenario.projectRoot)).filter(
        (journal) => journal.kind === "apply"
      )
    ).toHaveLength(0);
    expect(await readHistoryRecords(scenario.projectRoot, "before-agent-write")).toHaveLength(0);
  } finally {
    await scenario.close();
  }
});

async function launchScenario(): Promise<{
  readonly page: Page;
  readonly projectRoot: string;
  releaseProviderResponse(): void;
  close(): Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-autonomy-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await prepareProject(projectRoot);
  let releaseProviderResponse: (() => void) | undefined;
  const providerResponseGate = new Promise<void>((resolve) => {
    releaseProviderResponse = resolve;
  });
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
    if (isStreamingPingProbe(body)) {
      sendStreamingPing(response);
      return;
    }
    await providerResponseGate;
    const evidenceRef = "run-event/7/tool_completed/call_autonomy-read";
    sendToolCalls(response, [
      {
        id: "autonomy-read",
        name: "read_resource",
        arguments: { ref: `chapter:${firstChapterId}` }
      },
      {
        id: "autonomy-finish",
        name: "finish",
        arguments: {
          schemaVersion: "2.0",
          outcome: "completed",
          report: {
            result: "Read-only review completed without project mutations.",
            appliedChanges: [],
            verification: [evidenceRef],
            residualRisks: [],
            nextStep: "Use a qualified signed package before requesting a mutation."
          },
          evidenceRefs: [evidenceRef]
        }
      }
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address.");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });
  const page = await electronApp.firstWindow();
  await queueDirectorySelection(electronApp, projectRoot);
  await activateCreativeProject(page);
  await configureLocalModel(page, `http://127.0.0.1:${address.port}/v1`);
  await chooseWorkspaceModelSharing(page);
  return {
    page,
    projectRoot,
    releaseProviderResponse() {
      releaseProviderResponse?.();
    },
    async close() {
      releaseProviderResponse?.();
      await electronApp.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      );
      await rm(tempRoot, { recursive: true, force: true });
    }
  };
}

async function activateCreativeProject(page: Page): Promise<void> {
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

async function startAutonomousExecution(page: Page): Promise<void> {
  await expect(page.getByLabel("Agent 会话主视图")).toBeVisible();
  const createConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await createConversation.isVisible()) await createConversation.click();
  const composer = page.getByLabel("会话输入区");
  await selectAutomaticMode(page, composer);
  await expect(composer.getByLabel("添加引用与执行审批")).toBeVisible();
  await expect(composer.getByRole("checkbox")).toHaveCount(0);
  await composer.getByLabel("Agent 请求").fill("连续修改两章并完成运行");
  await composer.getByLabel("启动 Agent 运行").click();
  await resolveContextRefreshIfVisible(page);
}

async function selectAutomaticMode(
  page: Page,
  composer: ReturnType<Page["getByLabel"]>
): Promise<void> {
  const trigger = composer.getByTitle("选择计划或执行模式");
  if ((await trigger.getAttribute("aria-label")) !== "执行") {
    await trigger.click();
    await page
      .getByLabel("计划或执行模式")
      .getByRole("button", { name: "执行", exact: true })
      .click();
  }
  await composer.getByLabel("添加引用与执行审批").click();
  const menu = page.getByRole("dialog", { name: "添加引用与执行审批" });
  await expect(menu.getByRole("radio", { name: "请求批准" })).toBeChecked();
  await expect(menu.getByRole("radio", { name: "请求批准" })).toBeEnabled();
  await expect(menu.getByRole("radio", { name: "替我审批" })).toBeDisabled();
  await expect(menu.getByRole("checkbox")).toHaveCount(0);
  await menu.press("Escape");
}

async function resolveContextRefreshIfVisible(page: Page): Promise<void> {
  const returnToConversation = page.getByRole("button", { name: "返回对话" });
  if (await returnToConversation.isVisible()) await returnToConversation.click();
  const refresh = page.getByLabel("上下文刷新");
  const visible = await refresh
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (visible) await refresh.getByRole("button", { name: "从目标排除" }).click();
}

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("local-agent");
  await page.getByLabel("密钥引用").fill("local-autonomy-e2e-key");
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

async function prepareProject(projectRoot: string): Promise<void> {
  const chapters = join(projectRoot, "chapters");
  await mkdir(chapters, { recursive: true });
  await copyFile(join(fixtureRoot, "project.json"), join(projectRoot, "project.json"));
  await copyFile(join(fixtureRoot, "settings.json"), join(projectRoot, "settings.json"));
  await writeFile(
    join(chapters, `${firstChapterId}.md`),
    chapterFile(firstChapterId, "First", 1, firstBody),
    "utf8"
  );
  await writeFile(
    join(chapters, `${secondChapterId}.md`),
    chapterFile(secondChapterId, "Second", 2, secondBody),
    "utf8"
  );
}

function chapterFile(id: string, title: string, order: number, body: string): string {
  return `---\nschemaVersion: "1.0"\nid: "${id}"\ntype: "chapter"\ntitle: "${title}"\norder: ${order}\nstatus: "draft"\ncreatedAt: "2026-07-03T00:00:00.000Z"\nupdatedAt: "2026-07-03T00:00:00.000Z"\n---\n\n${body}`;
}

async function readTransactionJournals(projectRoot: string): Promise<Record<string, unknown>[]> {
  return readJsonRecords(join(projectRoot, "history", "agent-transactions"));
}

async function readLatestAgentRun(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const listed = await window.novelStudio?.agentRuns.list("prj_minimal_chapter");
    const latest = listed?.ok ? listed.value[0] : undefined;
    return latest === undefined ? listed : await window.novelStudio?.agentRuns.read(latest.runId);
  });
}

async function readLatestPermissionSummary(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const listed = await window.novelStudio?.agentRuns.list("prj_minimal_chapter");
    const latest = listed?.ok ? listed.value[0] : undefined;
    if (latest === undefined) return listed;
    const run = await window.novelStudio?.agentRuns.read(latest.runId);
    if (run?.ok !== true || typeof run.value.snapshot.permissionSummaryId !== "string") {
      return run;
    }
    return window.novelStudio?.agentRuns.readPermissionSummary({
      kind: "run",
      projectId: "prj_minimal_chapter",
      runId: run.value.snapshot.runId,
      permissionSummaryId: run.value.snapshot.permissionSummaryId
    });
  });
}

function agentRunEventTypes(readResult: unknown): string[] {
  if (!isRecord(readResult) || !isRecord(readResult["value"])) return [];
  const events = readResult["value"]["events"];
  return Array.isArray(events)
    ? events.flatMap((event) =>
        isRecord(event) && typeof event["type"] === "string" ? [event["type"]] : []
      )
    : [];
}

async function readHistoryRecords(
  projectRoot: string,
  reason: string
): Promise<Record<string, unknown>[]> {
  const records = await readJsonRecords(join(projectRoot, "history", "chapters-records"));
  return records.filter((record) => record["reason"] === reason);
}

async function readJsonRecords(root: string): Promise<Record<string, unknown>[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const records: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) records.push(...(await readJsonRecords(path)));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      records.push(await readJsonRecord(path));
    }
  }
  return records;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Expected JSON object at ${path}.`);
  return parsed;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return isRecord(parsed) ? parsed : {};
}

function sendToolCalls(
  response: ServerResponse,
  calls: readonly { readonly id: string; readonly name: string; readonly arguments: unknown }[]
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: `call_${call.id}`,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) }
            }))
          }
        }
      ]
    })}\n\n`
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

function isStreamingPingProbe(body: Record<string, unknown>): boolean {
  const messages = body["messages"];
  return (
    body["stream"] === true &&
    Array.isArray(messages) &&
    messages.some(
      (message) => isRecord(message) && message["role"] === "user" && message["content"] === "ping"
    )
  );
}

function sendStreamingPing(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\ndata: [DONE]\n\n`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
