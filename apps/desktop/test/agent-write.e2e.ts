import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const chapterOneId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const chapterTwoId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
const chapterOneBody = "原始章节正文。\n";
const chapterTwoBody = "第二章原始正文。\n";

test("proposal stays unwritten, partial selection creates a revision, and double-click applies once", async () => {
  test.setTimeout(90_000);
  const scenario = await launchScenario([
    proposal(chapterOneId, chapterOneBody, 0, 2, "改写", "proposal-one"),
    proposal(chapterOneId, chapterOneBody, 4, 6, "内容", "proposal-two")
  ]);
  const chapterPath = join(scenario.projectRoot, "chapters", `${chapterOneId}.md`);

  try {
    const before = await readFile(chapterPath, "utf8");
    await startExecution(scenario.page);

    await expect(scenario.page.getByLabel("变更集差异审阅")).toContainText("尚未写入");
    await expect(scenario.page.getByLabel("变更集差异审阅")).toBeVisible();
    expect(await readFile(chapterPath, "utf8")).toBe(before);
    expect(await readTransactionJournals(scenario.projectRoot)).toHaveLength(0);

    const binding = scenario.page.getByLabel("Change Set 审批绑定");
    const firstBinding = await binding.textContent();
    const hunks = scenario.page.locator(".ns-diff-hunk input[type=checkbox]");
    await expect(hunks).toHaveCount(2);
    await hunks.nth(1).click();
    await expect(binding).not.toHaveText(firstBinding ?? "");
    await expect(binding).toContainText("v3");
    expect(await readFile(chapterPath, "utf8")).toBe(before);

    await scenario.page.getByRole("button", { name: "应用所选" }).dblclick();
    await expect.poll(async () => readFile(chapterPath, "utf8")).toContain("改写章节正文。");
    expect(await readFile(chapterPath, "utf8")).not.toContain("改写章节内容。");
    await waitForOnlyTransactionJournal(scenario.projectRoot, "applied");
  } finally {
    await scenario.close();
  }
});

test("base hash conflict disables apply and preserves the concurrent user edit", async () => {
  test.setTimeout(90_000);
  const scenario = await launchScenario([
    proposal(chapterOneId, chapterOneBody, 0, 2, "改写", "proposal-conflict")
  ]);
  const chapterPath = join(scenario.projectRoot, "chapters", `${chapterOneId}.md`);

  try {
    await startExecution(scenario.page);
    const concurrent = (await readFile(chapterPath, "utf8")).replace(
      "原始章节正文。",
      "用户并发编辑。"
    );
    await writeFile(chapterPath, concurrent, "utf8");
    await scenario.page.getByRole("button", { name: "应用所选" }).click();

    await expect.poll(async () => readFile(chapterPath, "utf8")).toBe(concurrent);
    expect(await readTransactionJournals(scenario.projectRoot)).toHaveLength(0);
    await expect(scenario.page.getByLabel("变更集差异审阅")).toContainText("Base hash 冲突");
    await expect(scenario.page.getByRole("button", { name: "应用所选" })).toBeDisabled();
  } finally {
    await scenario.close();
  }
});

test("applies a confirmed multi-file Change Set through one Version Group", async () => {
  test.setTimeout(90_000);
  const scenario = await launchScenario([
    proposal(chapterOneId, chapterOneBody, 0, 2, "改写", "proposal-chapter-one"),
    proposal(chapterTwoId, chapterTwoBody, 0, 3, "续章", "proposal-chapter-two")
  ]);
  const firstPath = join(scenario.projectRoot, "chapters", `${chapterOneId}.md`);
  const secondPath = join(scenario.projectRoot, "chapters", `${chapterTwoId}.md`);
  const firstBefore = await readFile(firstPath);
  const secondBefore = await readFile(secondPath);

  try {
    await startExecution(scenario.page);
    await expect(scenario.page.getByLabel("变更文件").locator("input")).toHaveCount(2);
    await scenario.page.getByRole("button", { name: "应用所选" }).click();

    await expect.poll(async () => readFile(firstPath, "utf8")).toContain("改写章节正文。");
    await expect.poll(async () => readFile(secondPath, "utf8")).toContain("续章原始正文。");

    const journal = await waitForOnlyTransactionJournal(scenario.projectRoot, "applied");
    expect(journal.kind).toBe("apply");
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries.map((entry) => entry.status)).toEqual(["applied", "applied"]);
    expect(journal.entries.map((entry) => entry.relativePath).sort()).toEqual(
      [
        `chapters/${chapterOneId}.md`,
        `chapters/${chapterTwoId}.md`
      ].sort()
    );
    expect(new Set(journal.entries.map((entry) => entry.writeId)).size).toBe(2);
    expect(journal.approvalSource).toBe("human_confirmation");
    expect(journal.approvalToken).toMatch(/^[a-f0-9]{64}$/);

    const changeSet = await readJsonRecord(
      join(
        scenario.projectRoot,
        "history",
        "change-sets",
        journal.changeSetId,
        "revisions",
        `${String(journal.changeSetRevision)}.json`
      )
    );
    expect(changeSet).toMatchObject({
      changeSetId: journal.changeSetId,
      revision: journal.changeSetRevision,
      checksum: journal.changeSetChecksum,
      runId: journal.runId,
      checkpointId: journal.checkpointId,
      approvalToken: journal.approvalToken
    });

    const runSnapshot = await readJsonRecord(
      join(
        scenario.projectRoot,
        "history",
        "agent-runs",
        journal.runId,
        "run.json"
      )
    );
    expect(runSnapshot).toMatchObject({
      runId: journal.runId
    });

    const writes = await readHistoryRecords(scenario.projectRoot, "before-agent-write");
    expect(writes).toHaveLength(2);
    expect(writes).toEqual(
      expect.arrayContaining(
        journal.entries.map((entry) =>
          expect.objectContaining({
            versionId: entry.beforeVersionId,
            writeId: entry.writeId,
            targetRelativePath: entry.relativePath,
            runId: journal.runId,
            checkpointId: journal.checkpointId
          })
        )
      )
    );

    await resolveContextRefreshIfVisible(scenario.page);
    const runSnapshotPath = join(
      scenario.projectRoot,
      "history",
      "agent-runs",
      journal.runId,
      "run.json"
    );
    await expect
      .poll(async () => {
        const current = await readJsonRecord(runSnapshotPath);
        return {
          status: current["status"],
          versionGroupId: current["versionGroupId"]
        };
      })
      .toEqual({ status: "completed", versionGroupId: journal.versionGroupId });

    const undo = scenario.page
      .getByLabel("Agentic Writing Loop")
      .getByRole("button", { name: "撤销本次运行" });
    await expect(undo).toBeEnabled();
    await undo.dblclick();
    await expect
      .poll(async () => (await readFile(firstPath)).toString("base64"))
      .toBe(firstBefore.toString("base64"));
    await expect
      .poll(async () => (await readFile(secondPath)).toString("base64"))
      .toBe(secondBefore.toString("base64"));
    await expect
      .poll(async () => {
        const transactions = await readTransactionJournals(scenario.projectRoot);
        const undoTransaction = transactions.find((transaction) => transaction.kind === "run_undo");
        return {
          kinds: transactions.map((transaction) => transaction.kind).sort(),
          status: undoTransaction?.transactionStatus,
          entryStatuses: undoTransaction?.entries.map((entry) => entry.status)
        };
      })
      .toEqual({
        kinds: ["apply", "run_undo"],
        status: "applied",
        entryStatuses: ["applied", "applied"]
      });
    const runUndo = (await readTransactionJournals(scenario.projectRoot)).find(
      (transaction) => transaction.kind === "run_undo"
    );
    expect(runUndo).toMatchObject({
      runId: journal.runId,
      transactionStatus: "applied",
      entries: [
        expect.objectContaining({ status: "applied" }),
        expect.objectContaining({ status: "applied" })
      ]
    });
    expect(runUndo).not.toHaveProperty("approvalSource");
    expect(runUndo).not.toHaveProperty("approvalToken");
    expect(await readHistoryRecords(scenario.projectRoot, "before-agent-session-undo")).toHaveLength(
      2
    );
  } finally {
    await scenario.close();
  }
});

test("deselects a whole file into a new revision and excludes it from the transaction", async () => {
  test.setTimeout(90_000);
  const scenario = await launchScenario([
    proposal(chapterOneId, chapterOneBody, 0, 2, "改写", "proposal-file-selection-one"),
    proposal(chapterTwoId, chapterTwoBody, 0, 3, "续章", "proposal-file-selection-two")
  ]);
  const firstPath = join(scenario.projectRoot, "chapters", `${chapterOneId}.md`);
  const secondPath = join(scenario.projectRoot, "chapters", `${chapterTwoId}.md`);
  const secondBefore = await readFile(secondPath);

  try {
    await startExecution(scenario.page);
    const binding = scenario.page.getByLabel("Change Set 审批绑定");
    const firstBinding = await binding.textContent();
    const fileSelections = scenario.page.locator(
      ".ns-diff-review-file-row input[type=checkbox]"
    );
    await expect(fileSelections).toHaveCount(2);
    await expect(fileSelections.nth(0)).toBeChecked();
    await expect(fileSelections.nth(1)).toBeChecked();

    await fileSelections.nth(1).click();

    await expect(fileSelections.nth(1)).not.toBeChecked();
    await expect(binding).not.toHaveText(firstBinding ?? "");
    await expect(binding).toContainText("v3");
    await expect(scenario.page.getByRole("button", { name: "应用所选" })).toBeEnabled();

    await scenario.page.getByRole("button", { name: "应用所选" }).click();

    await expect.poll(async () => readFile(firstPath, "utf8")).toContain("改写章节正文。");
    await expect
      .poll(async () => (await readFile(secondPath)).toString("base64"))
      .toBe(secondBefore.toString("base64"));
    const journal = await waitForOnlyTransactionJournal(scenario.projectRoot, "applied");
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({
      relativePath: `chapters/${chapterOneId}.md`,
      status: "applied"
    });
  } finally {
    await scenario.close();
  }
});

test("rolls back the first replacement when the second file replacement fails", async () => {
  test.setTimeout(90_000);
  const scenario = await launchScenario(
    [
      proposal(chapterOneId, chapterOneBody, 0, 2, "改写", "proposal-rollback-one"),
      proposal(chapterTwoId, chapterTwoBody, 0, 3, "续章", "proposal-rollback-two")
    ],
    { NOVEL_STUDIO_TEST_AGENT_WRITE_FAIL_AT: "2" }
  );
  const firstPath = join(scenario.projectRoot, "chapters", `${chapterOneId}.md`);
  const secondPath = join(scenario.projectRoot, "chapters", `${chapterTwoId}.md`);
  const firstBefore = await readFile(firstPath);
  const secondBefore = await readFile(secondPath);

  try {
    await startExecution(scenario.page);
    await scenario.page.getByRole("button", { name: "应用所选" }).click();
    await scenario.page.getByRole("button", { name: "返回对话" }).click();

    await expect(scenario.page.getByRole("alert")).toContainText(
      "Agent writing failed and applied files were rolled back."
    );
    await expect
      .poll(async () => (await readFile(firstPath)).toString("base64"))
      .toBe(firstBefore.toString("base64"));
    await expect
      .poll(async () => (await readFile(secondPath)).toString("base64"))
      .toBe(secondBefore.toString("base64"));

    const journal = await waitForOnlyTransactionJournal(scenario.projectRoot, "rolled_back");
    expect(journal.kind).toBe("apply");
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[0]).toMatchObject({
      relativePath: `chapters/${chapterOneId}.md`,
      status: "rolled_back"
    });
    expect(journal.entries[1]).toMatchObject({
      relativePath: `chapters/${chapterTwoId}.md`,
      status: "pending"
    });
    expect(journal.entries[1]?.status).not.toBe("applied");
  } finally {
    await scenario.close();
  }
});

interface Proposal {
  readonly id: string;
  readonly name: "propose_chapter_write";
  readonly arguments: Record<string, unknown>;
}

interface Scenario {
  readonly page: Page;
  readonly projectRoot: string;
  close(): Promise<void>;
}

interface TransactionJournalEntry {
  readonly writeId: string;
  readonly relativePath: string;
  readonly beforeVersionId: string;
  readonly status: "pending" | "applied" | "rolled_back" | "rollback_failed";
}

interface TransactionJournal {
  readonly versionGroupId: string;
  readonly kind: "apply" | "version_group_undo" | "run_undo";
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly approvalSource: string;
  readonly approvalToken: string;
  readonly transactionStatus:
    | "prepared"
    | "applying"
    | "compensating"
    | "applied"
    | "rolled_back"
    | "partial_failure";
  readonly entries: readonly TransactionJournalEntry[];
}

function proposal(
  chapterId: string,
  baseContent: string,
  start: number,
  end: number,
  replacement: string,
  id: string
): Proposal {
  return {
    id,
    name: "propose_chapter_write",
    arguments: {
      chapterId,
      baseHash: createHash("sha256").update(baseContent, "utf8").digest("hex"),
      range: { unit: "character", start, end },
      replacement
    }
  };
}

async function launchScenario(
  proposals: readonly Proposal[],
  extraEnv: Record<string, string> = {}
): Promise<Scenario> {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-write-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await prepareProject(projectRoot);
  let proposalSent = false;
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
    if (!proposalSent) {
      proposalSent = true;
      sendToolCalls(response, proposals, "准备候选修改。");
      return;
    }
    sendToolCalls(
      response,
      [{ id: "finish-write", name: "finish", arguments: { summary: "写入流程完成。" } }],
      ""
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data"),
      ...extraEnv
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

async function prepareProject(projectRoot: string): Promise<void> {
  const chapterRoot = join(projectRoot, "chapters");
  await mkdir(chapterRoot, { recursive: true });
  await copyFile(join(fixtureRoot, "project.json"), join(projectRoot, "project.json"));
  await copyFile(join(fixtureRoot, "settings.json"), join(projectRoot, "settings.json"));
  await copyFile(
    join(fixtureRoot, "chapters", `${chapterOneId}.md`),
    join(chapterRoot, `${chapterOneId}.md`)
  );
  await writeFile(
    join(chapterRoot, `${chapterTwoId}.md`),
    `---\nschemaVersion: "1.0"\nid: "${chapterTwoId}"\ntype: "chapter"\ntitle: "第二章"\norder: 2\nstatus: "draft"\ncreatedAt: "2026-07-03T00:00:00.000Z"\nupdatedAt: "2026-07-03T00:00:00.000Z"\n---\n\n${chapterTwoBody}`,
    "utf8"
  );
}

async function startExecution(page: Page): Promise<void> {
  await expect(page.getByLabel("Agent 会话主视图")).toBeVisible();
  const createConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await createConversation.isVisible()) await createConversation.click();
  const composer = page.getByLabel("会话输入区");
  await selectExecutionMode(composer);
  await composer.getByLabel("Agent 请求").fill("按候选修改章节");
  await composer.getByLabel("启动 Agent 运行").click();
  await resolveContextRefreshIfVisible(page);
  await expect(page.getByLabel("变更集差异审阅")).toBeVisible();
}

async function selectExecutionMode(composer: ReturnType<Page["getByLabel"]>): Promise<void> {
  if ((await composer.getByRole("button", { name: /^执行 · / }).count()) > 0) return;
  await composer
    .getByRole("button", { name: /^(规划|执行) · (写作上下文|文件上下文)$/ })
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
  const refreshVisible = await refresh
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (refreshVisible) {
    await refresh.getByRole("button", { name: "从目标排除" }).click();
  }
}

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
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

async function readTransactionJournals(projectRoot: string): Promise<TransactionJournal[]> {
  const root = join(projectRoot, "history", "agent-transactions");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const record = await readJsonRecord(join(root, entry.name));
        return record as unknown as TransactionJournal;
      })
  );
}

async function waitForOnlyTransactionJournal(
  projectRoot: string,
  transactionStatus: TransactionJournal["transactionStatus"]
): Promise<TransactionJournal> {
  await expect
    .poll(async () =>
      (await readTransactionJournals(projectRoot)).map((journal) => journal.transactionStatus)
    )
    .toEqual([transactionStatus]);
  const journal = (await readTransactionJournals(projectRoot))[0];
  if (journal === undefined) throw new Error("Expected exactly one Agent transaction journal.");
  return journal;
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
    if (entry.isDirectory()) {
      records.push(...(await readJsonRecords(path)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      records.push(await readJsonRecord(path));
    }
  }
  return records;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object at ${path}.`);
  return parsed;
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendToolCalls(
  response: ServerResponse,
  calls: readonly { readonly id: string; readonly name: string; readonly arguments: unknown }[],
  content: string
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
            content,
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
