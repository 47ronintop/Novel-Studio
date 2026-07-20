import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { createHash } from "node:crypto";
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

test("auto-applies two versioned Change Sets and reviews a conflicting run undo", async () => {
  test.setTimeout(120_000);
  const scenario = await launchScenario();
  const firstRelativePath = `chapters/${firstChapterId}.md`;
  const secondRelativePath = `chapters/${secondChapterId}.md`;
  const firstPath = join(scenario.projectRoot, firstRelativePath);
  const secondPath = join(scenario.projectRoot, secondRelativePath);
  const firstBaseline = await readFile(firstPath, "utf8");
  const secondBaseline = await readFile(secondPath, "utf8");

  try {
    await startAutonomousExecution(scenario.page);

    await expect
      .poll(async () => {
        const read = await readLatestAgentRun(scenario.page);
        if (
          read.ok === true &&
          isRecord(read.value) &&
          isRecord(read.value["snapshot"]) &&
          read.value["snapshot"]["status"] === "failed"
        ) {
          throw new Error(`Agent run failed: ${JSON.stringify(read.value["events"])}`);
        }
        if (
          read.ok === true &&
          isRecord(read.value) &&
          isRecord(read.value["snapshot"]) &&
          read.value["snapshot"]["status"] === "awaiting_context_refresh"
        ) {
          await resolveContextRefreshIfVisible(scenario.page);
        }
        return read;
      }, { timeout: 30_000 })
      .toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed", writePolicy: "user_preapproved_run" },
          changeSet: { status: "applied", writePolicy: "user_preapproved_run" }
        }
      });

    await expect
      .poll(async () => readFile(firstPath, "utf8"), { timeout: 30_000 })
      .toContain("Autonomous first chapter body.");
    await expect
      .poll(async () => readFile(secondPath, "utf8"), { timeout: 30_000 })
      .toContain("Autonomous second original body.");
    const completedRun = await readLatestAgentRun(scenario.page);
    expect(
      agentRunEventTypes(completedRun).filter((type) => type === "change_set_auto_approved")
    ).toHaveLength(2);
    expect(
      agentRunEventTypes(completedRun).filter((type) => type === "write_applied")
    ).toHaveLength(2);
    const applyJournals = (await readTransactionJournals(scenario.projectRoot)).filter(
      (journal) => journal.kind === "apply"
    );
    expect(applyJournals).toHaveLength(2);
    expect(applyJournals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          writePolicy: "user_preapproved_run",
          approvalSource: "user_preapproved_run",
          transactionStatus: "applied"
        }),
        expect.objectContaining({
          writePolicy: "user_preapproved_run",
          approvalSource: "user_preapproved_run",
          transactionStatus: "applied"
        })
      ])
    );
    expect(await readHistoryRecords(scenario.projectRoot, "before-agent-write")).toHaveLength(2);

    const userEdited = (await readFile(firstPath, "utf8")).replace(
      "Autonomous first chapter body.",
      "User edit after Agent write."
    );
    await writeFile(firstPath, userEdited, "utf8");
    const returnToConversation = scenario.page.getByRole("button", { name: "返回对话" });
    if (await returnToConversation.isVisible()) await returnToConversation.click();
    const undo = scenario.page
      .getByLabel("Agentic Writing Loop")
      .getByRole("button", { name: "撤销本次运行" });
    await expect(undo).toBeEnabled();
    await undo.click();

    await expect.poll(async () => readFile(secondPath, "utf8")).toBe(secondBaseline);
    await expect.poll(async () => readFile(firstPath, "utf8")).toBe(userEdited);
    const review = scenario.page.getByLabel("运行撤销冲突审阅");
    await expect(review).toBeVisible();
    const conflictFile = review
      .locator(".ns-rollback-review-file")
      .filter({ hasText: firstRelativePath });
    await expect(conflictFile.getByText("当前内容", { exact: true })).toBeVisible();
    await expect(conflictFile.getByText("AI 最后写入", { exact: true })).toBeVisible();
    await expect(conflictFile.getByText("运行前基线", { exact: true })).toBeVisible();
    await conflictFile.getByRole("radio", { name: "保留当前" }).check();
    await review.getByRole("button", { name: "应用所选恢复" }).click();

    expect(await readFile(firstPath, "utf8")).toBe(userEdited);
    expect(await readFile(secondPath, "utf8")).toBe(secondBaseline);
    expect(
      await readHistoryRecords(scenario.projectRoot, "before-agent-session-undo")
    ).toHaveLength(1);

    const rollbackReviewPath = join(
      scenario.projectRoot,
      "history",
      "rollback-reviews",
      `${applyJournals[0]?.runId}.json`
    );
    await expect
      .poll(() => readJsonRecord(rollbackReviewPath), { timeout: 15_000 })
      .toMatchObject({
        status: "completed",
        files: expect.arrayContaining([
          expect.objectContaining({ relativePath: firstRelativePath, status: "kept" }),
          expect.objectContaining({ relativePath: secondRelativePath, status: "completed" })
        ])
      });
    expect(firstBaseline).not.toBe(userEdited);
  } finally {
    await scenario.close();
  }
});

async function launchScenario(): Promise<{
  readonly page: Page;
  readonly projectRoot: string;
  close(): Promise<void>;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-autonomy-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await prepareProject(projectRoot);
  let round = 0;
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
    round += 1;
    if (round === 1) {
      sendToolCall(response, {
        id: "autonomy-first",
        name: "propose_chapter_write",
        arguments: {
          chapterId: firstChapterId,
          baseHash: sha256(firstBody),
          range: { unit: "character", start: 0, end: 8 },
          replacement: "Autonomous first"
        }
      });
      return;
    }
    if (round === 2) {
      sendToolCall(response, {
        id: "autonomy-second",
        name: "propose_chapter_write",
        arguments: {
          chapterId: secondChapterId,
          baseHash: sha256(secondBody),
          range: { unit: "character", start: 0, end: 6 },
          replacement: "Autonomous second"
        }
      });
      return;
    }
    sendToolCall(response, {
      id: "autonomy-finish",
      name: "finish",
      arguments: { summary: "Two autonomous writes completed." }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address.");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });
  const page = await electronApp.firstWindow();
  await queueDirectorySelection(electronApp, projectRoot);
  await activateCreativeProject(page);
  await configureLocalModel(page, `http://127.0.0.1:${address.port}/v1`);
  return {
    page,
    projectRoot,
    async close() {
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
  await selectExecutionMode(composer);
  await composer.getByLabel("修改权限：每次修改前确认").click();
  const policy = composer.getByRole("dialog", { name: "修改权限与摘要" });
  await policy.getByRole("radio", { name: "本次运行自动修改" }).check();
  await expect(policy).toContainText("每次实际写入仍会生成差异、校验并创建版本点");
  await policy.getByRole("checkbox", { name: "确认本次运行自动修改风险" }).check();
  await policy.press("Escape");
  await composer.getByLabel("Agent 请求").fill("连续修改两章并完成运行");
  await composer.getByLabel("启动 Agent 运行").click();
  await resolveContextRefreshIfVisible(page);
}

async function selectExecutionMode(composer: ReturnType<Page["getByLabel"]>): Promise<void> {
  if ((await composer.getByRole("button", { name: /^执行 · / }).count()) > 0) return;
  await composer
    .getByRole("button", { name: /^(规划|执行) · (写作|通用文件)$/ })
    .click();
  await composer
    .getByLabel("运行方式")
    .getByRole("button", { name: "执行", exact: true })
    .click();
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
  await expect(page.locator(".ns-project-feedback")).toContainText(
    "Connected to openai-compatible/local-agent"
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
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

function sendToolCall(
  response: ServerResponse,
  call: { readonly id: string; readonly name: string; readonly arguments: unknown }
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
            tool_calls: [
              {
                index: 0,
                id: `call_${call.id}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) }
              }
            ]
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

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
