import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createUnifiedError, err, ok, type JsonObject } from "@novel-studio/shared";
import { createAgentRunSession } from "@novel-studio/application";
import {
  AgentConversationFileRepository,
  AgentRunFileRepository
} from "@novel-studio/repository";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const projectId = "prj_minimal_chapter";
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";

test("restores a provider disconnect with the same error ID, copies it, and retries an explicit model target", async () => {
  test.setTimeout(60_000);
  const fixture = await seedDiagnosticFixture("provider_disconnect");
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await launchFixture(fixture);
    const page = await electronApp.firstWindow();
    await openFixtureConversation(page, fixture.title);
    const card = page.getByLabel("Agent 错误");
    await expect(card).toBeVisible();
    await expect(card).toContainText("模型连接已中断");
    await expect(card.locator("details")).not.toHaveAttribute("open", "");

    await card.locator("summary").click();
    await expect(card).toContainText(fixture.errorId);
    await card.getByRole("button", { name: "复制错误 ID" }).click();
    await expect.poll(() => electronApp?.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      fixture.errorId
    );

    await page.reload();
    await openFixtureConversation(page, fixture.title);
    const restored = page.getByLabel("Agent 错误");
    await expect(restored).toBeVisible();
    await expect(restored.locator("details")).not.toHaveAttribute("open", "");
    const readAfterReload = await readRun(page, fixture.runId);
    expect(readAfterReload.snapshot).toMatchObject({
      activeErrorId: fixture.errorId,
      recoveryState: "retryable"
    });
    expect(readAfterReload.diagnostic).toMatchObject({
      errorId: fixture.errorId,
      recoveryState: "retryable"
    });

    await restored.getByRole("button", { name: "重试模型轮次" }).click();
    await waitForRunStatus(page, fixture.runId, "completed");
    await expect(page.getByLabel("Agent 错误")).toHaveCount(0);
    const retried = await readRun(page, fixture.runId);
    expect(retried.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run_resumed",
          detail: expect.objectContaining({
            errorId: fixture.errorId,
            targetKind: "model_round"
          })
        })
      ])
    );
    await assertNoPermanentDiagnostics(page);
  } finally {
    await electronApp?.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("retries the persisted failed tool call through its explicit target", async () => {
  test.setTimeout(60_000);
  const fixture = await seedDiagnosticFixture("tool_error");
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await launchFixture(fixture);
    const page = await electronApp.firstWindow();
    await openFixtureConversation(page, fixture.title);
    const card = page.getByLabel("Agent 错误");
    await expect(card).toContainText("项目目录暂时不可读取");
    await expect(card.getByRole("button", { name: "重试工具调用" })).toBeVisible();

    await card.getByRole("button", { name: "重试工具调用" }).click();
    await waitForRunStatus(page, fixture.runId, "completed");
    const retried = await readRun(page, fixture.runId);
    expect(retried.snapshot).toMatchObject({ activeErrorId: null, recoveryState: "none" });
    expect(retried.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_retry_requested",
          detail: expect.objectContaining({
            errorId: fixture.errorId,
            targetKind: "tool_call",
            targetId: "tool_retry_e2e"
          })
        })
      ])
    );
    await expect(page.getByLabel("Agent 错误")).toHaveCount(0);
    await assertNoPermanentDiagnostics(page);
  } finally {
    await electronApp?.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("renders context stale diagnostics inline and clears them through context refresh", async () => {
  test.setTimeout(60_000);
  const fixture = await seedDiagnosticFixture("context_stale");
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await launchFixture(fixture);
    const page = await electronApp.firstWindow();
    await openFixtureConversation(page, fixture.title);
    const card = page.getByLabel("Agent 错误");
    await expect(card).toContainText("上下文已变化，需要刷新后才能继续");
    await expect(page.getByLabel("上下文刷新")).toBeVisible();
    expect((await readRun(page, fixture.runId)).snapshot).toMatchObject({
      activeErrorId: fixture.errorId,
      recoveryState: "awaiting_context_refresh"
    });

    await page.getByLabel("上下文刷新").getByRole("button", { name: "从目标排除" }).click();
    await waitForRunStatus(page, fixture.runId, "completed");
    const refreshed = await readRun(page, fixture.runId);
    expect(refreshed.snapshot).toMatchObject({ activeErrorId: null, recoveryState: "none" });
    expect(refreshed.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "context_excluded" })])
    );
    await expect(page.getByLabel("Agent 错误")).toHaveCount(0);
    await assertNoPermanentDiagnostics(page);
  } finally {
    await electronApp?.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("shows only the recovery-journal reference for a partial failure", async () => {
  test.setTimeout(60_000);
  const fixture = await seedDiagnosticFixture("partial_failure");
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await launchFixture(fixture);
    const page = await electronApp.firstWindow();
    await openFixtureConversation(page, fixture.title);
    const card = page.getByLabel("Agent 错误");
    await expect(card).toContainText("部分写入需要先完成恢复审阅");
    await expect(card.locator("details")).not.toHaveAttribute("open", "");
    await card.locator("summary").click();
    await expect(card).toContainText("version_group_partial_e2e");
    const read = await readRun(page, fixture.runId);
    expect(read.diagnostic).toMatchObject({
      errorId: fixture.errorId,
      recoveryState: "recovery_review",
      redactedDetail: {
        recoveryJournal: { versionGroupId: "version_group_partial_e2e" }
      }
    });
    const eventTypes = read.events.map((event) => event.type);
    expect(
      eventTypes.filter(
        (type) => type === "write_failed" || type === "error_recorded" || type === "run_failed"
      )
    ).toEqual(["write_failed", "error_recorded", "run_failed"]);
    expect(eventTypes).not.toContain("write_applied");
    expect(JSON.stringify(read.diagnostic)).not.toContain("writes");
    await assertNoPermanentDiagnostics(page);
  } finally {
    await electronApp?.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

type FixtureKind = "provider_disconnect" | "tool_error" | "context_stale" | "partial_failure";

interface DiagnosticFixture {
  readonly tempRoot: string;
  readonly projectRoot: string;
  readonly conversationId: string;
  readonly title: string;
  readonly runId: string;
  readonly errorId: string;
}

async function seedDiagnosticFixture(kind: FixtureKind): Promise<DiagnosticFixture> {
  const tempRoot = await mkdtemp(join(tmpdir(), `novel-studio-diagnostics-${kind}-`));
  const projectRoot = join(tempRoot, "Default Project");
  await prepareProject(projectRoot);
  const conversationId = `conv_${kind}`;
  const runId = `run_${kind}`;
  const title = fixtureTitle(kind);
  const now = "2026-07-17T12:00:00.000Z";
  const conversations = new AgentConversationFileRepository({
    projectRoot,
    traceId: "agent-diagnostics-e2e"
  });
  const created = await conversations.createConversation({
    schemaVersion: "1.0",
    conversationId,
    projectId,
    revision: 1,
    title,
    status: "active",
    createdAt: now,
    updatedAt: now,
    createdByCommandId: `create_${kind}`
  });
  if (!created.ok) throw created.error;

  const repository = new AgentRunFileRepository({
    projectRoot,
    traceId: "agent-diagnostics-e2e"
  });
  const common = {
    coordinatorOptions: { createRunId: () => runId },
    repository,
    startPreflight: startPreflight(kind),
    readToolExecutor: {
      async execute() {
        return err(
          createUnifiedError({
            errorId: "err_tool_retry_e2e",
            code: "AGENT_PROJECT_READ_TEMPORARY",
            category: "StorageError",
            message: "项目目录暂时不可读取。",
            recoverability: "retryable",
            suggestedAction: "重试此工具调用。",
            traceId: "agent-diagnostics-e2e",
            createdAt: now
          })
        );
      }
    }
  };
  const session = createAgentRunSession(
    fixtureSessionOptions(kind, common) as unknown as Parameters<typeof createAgentRunSession>[0]
  );
  const started = await session.startAgentRun({
    projectId,
    conversationId,
    commandId: `start_${kind}`,
    expectedRunRevision: 0,
    runDraftId: `draft_${kind}`,
    runDraftRevision: 1,
    runDraftChecksum: `checksum_${kind}`
  });
  if (!started.ok) throw started.error;

  if (kind === "partial_failure") {
    const pending = await waitForSnapshot(repository, runId, (snapshot) =>
      snapshot["status"] === "awaiting_write_approval"
    );
    const decided = await session.decideChangeSet({
      projectId,
      runId,
      commandId: "apply_partial_e2e",
      expectedRunRevision: Number(pending["runRevision"]),
      changeSetId: "changes_partial_e2e",
      revision: 1,
      checksum: "checksum_partial_e2e",
      decision: "apply_selected"
    });
    if (decided.ok || decided.error.code !== "AGENT_WRITE_PARTIAL_FAILURE") {
      throw new Error("Expected the injected partial failure.");
    }
  }

  const snapshot = await waitForSnapshot(
    repository,
    runId,
    (candidate) => typeof candidate["activeErrorId"] === "string"
  );
  const errorId = String(snapshot["activeErrorId"]);
  const diagnostic = await repository.readRunError(runId, errorId);
  if (!diagnostic.ok || diagnostic.value === undefined) {
    throw new Error("Expected a persisted diagnostic fixture.");
  }
  return { tempRoot, projectRoot, conversationId, title, runId, errorId };
}

function fixtureSessionOptions(kind: FixtureKind, common: Record<string, unknown>): JsonObject {
  if (kind === "provider_disconnect") {
    return {
      ...common,
      modelDriver: {
        async *streamRound() {
          yield* [];
          throw createUnifiedError({
            errorId: "err_provider_disconnect_e2e",
            code: "LLM_PROVIDER_DISCONNECTED",
            category: "ModelProviderError",
            message: "模型连接已中断。",
            recoverability: "retryable",
            suggestedAction: "重试当前模型轮次或从安全检查点恢复。",
            traceId: "agent-diagnostics-e2e",
            createdAt: "2026-07-17T12:00:00.000Z",
            redactedDetail: { requestId: "request_provider_disconnect_e2e" }
          });
        }
      }
    } as unknown as JsonObject;
  }
  if (kind === "tool_error") {
    let rounds = 0;
    const paused = new Promise<void>(() => undefined);
    return {
      ...common,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds > 1) {
            await paused;
            return;
          }
          yield {
            type: "tool_call_delta",
            toolCallId: "tool_retry_e2e",
            name: "list_project_entries",
            argumentsDelta: JSON.stringify({ path: "chapters" })
          };
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    } as unknown as JsonObject;
  }
  if (kind === "context_stale") {
    return {
      ...common,
      contextSourceReader: {
        async readCurrentSources() {
          return ok([{ refId: "file:notes/stale.md", content: "after" }]);
        }
      },
      modelDriver: {
        async *streamRound() {
          yield { type: "round_completed", finishReason: "stop" };
        }
      }
    } as unknown as JsonObject;
  }
  const changeSet = partialChangeSet();
  return {
    ...common,
    modelDriver: {
      async *streamRound() {
        yield {
          type: "tool_call_delta",
          toolCallId: "proposal_partial_e2e",
          name: "propose_file_write",
          argumentsDelta: JSON.stringify({
            path: "notes/partial.md",
            baseHash: "a".repeat(64),
            range: { unit: "character", start: 0, end: 6 },
            replacement: "after"
          })
        };
        yield { type: "round_completed", finishReason: "tool_calls" };
      }
    },
    changeSetSession: {
      async proposeFileWrite() {
        return ok(changeSet);
      },
      async proposeChapterWrite() {
        throw new Error("unused");
      },
      async selectRevision() {
        throw new Error("unused");
      },
      async readChangeSet() {
        return ok(changeSet);
      },
      async decide() {
        return ok({
          schemaVersion: "1.0",
          decision: "apply_selected",
          approvalSource: "human_confirmation",
          resolvedAt: "2026-07-17T12:00:00.000Z",
          binding: {
            changeSetId: "changes_partial_e2e",
            revision: 1,
            checksum: "checksum_partial_e2e",
            approvalToken: "approval_partial_e2e"
          }
        });
      }
    },
    versionGroupExecutor: {
      async apply() {
        return ok({
          schemaVersion: "1.0",
          versionGroupId: "version_group_partial_e2e",
          runId: "run_partial_failure",
          transactionStatus: "partial_failure",
          writes: []
        });
      },
      async undoRun() {
        throw new Error("unused");
      }
    }
  } as unknown as JsonObject;
}

function startPreflight(kind: FixtureKind) {
  return {
    async resolveStart() {
      return ok({
        operationMode: "execution" as const,
        contextMode: "general_file" as const,
        writePolicy: "write_before_confirmation" as const,
        writePolicyAcknowledged: false,
        userRequest: fixtureTitle(kind),
        model: {
          profileId: "profile_demo",
          provider: "demo",
          modelName: "scripted-agent",
          capabilities: {
            streaming: true,
            toolCalling: true,
            structuredArguments: true,
            contextWindow: 128000
          },
          requiredContextTokens: 8000,
          reasoningStrength: { status: "hidden" as const, reason: "demo fixture" }
        },
        ...(kind === "context_stale"
          ? {
              initialContextSources: [
                {
                  refId: "file:notes/stale.md",
                  sourceKind: "disk_file" as const,
                  relativePath: "notes/stale.md",
                  content: "before",
                  dirty: false
                }
              ]
            }
          : {})
      });
    }
  };
}

function partialChangeSet(): JsonObject {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_partial_e2e",
    revision: 1,
    runId: "run_partial_failure",
    checkpointId: "checkpoint_partial_e2e",
    contextSnapshotId: "context_partial_e2e",
    status: "awaiting_approval",
    checksum: "checksum_partial_e2e",
    approvalToken: "approval_partial_e2e",
    files: [
      {
        relativePath: "notes/partial.md",
        assetType: "text",
        baseChecksum: "a".repeat(64),
        candidateChecksum: "b".repeat(64),
        baseContent: "before",
        candidateContent: "after",
        hunks: [],
        validation: { valid: true, issues: [] },
        selected: true
      }
    ]
  };
}

async function waitForSnapshot(
  repository: AgentRunFileRepository,
  runId: string,
  predicate: (snapshot: JsonObject) => boolean
): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const read = await repository.readSnapshot(runId);
    if (!read.ok) throw read.error;
    if (read.value !== undefined && predicate(read.value)) return read.value;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${runId}.`);
}

async function launchFixture(fixture: DiagnosticFixture): Promise<ElectronApplication> {
  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(fixture.tempRoot, "Bootstrap Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(fixture.tempRoot, "User Data")
    })
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const unbound = page.getByLabel("Agent 未绑定工作区");
  const view = page.getByLabel("Agent 会话主视图");
  await expect
    .poll(async () => (await unbound.isVisible()) || (await view.isVisible()), { timeout: 15_000 })
    .toBe(true);
  await queueDirectorySelection(electronApp, fixture.projectRoot);
  return electronApp;
}

async function openFixtureConversation(page: Page, title: string): Promise<void> {
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
  await page.getByRole("button", { name: "历史会话" }).click();
  const drawer = page.getByRole("dialog", { name: "历史会话抽屉" });
  await expect(drawer).toBeVisible();
  const select = drawer.getByRole("button", { name: `选择会话：${title}` });
  await expect(select).toBeVisible();
  await select.click();
  await drawer.getByRole("button", { name: "关闭历史会话" }).click();
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

async function readRun(page: Page, runId: string): Promise<{
  readonly snapshot: Record<string, unknown>;
  readonly events: Array<{ readonly type: string; readonly detail?: Record<string, unknown> }>;
  readonly diagnostic?: Record<string, unknown>;
}> {
  const result = await page.evaluate(async (boundRunId) => {
    return window.novelStudio?.agentRuns.read(boundRunId);
  }, runId);
  if (result?.ok !== true) throw new Error("Expected the persisted Agent run.");
  return result.value as never;
}

async function waitForRunStatus(page: Page, runId: string, status: string): Promise<void> {
  await expect
    .poll(async () => {
      const read = await readRun(page, runId);
      const actual = read.snapshot["status"];
      if (
        actual !== status &&
        (actual === "completed" || actual === "cancelled" || actual === "failed" || actual === "limit_reached")
      ) {
        throw new Error(
          JSON.stringify({
            snapshot: read.snapshot,
            events: read.events.slice(-6),
            diagnostic: read.diagnostic
          })
        );
      }
      return actual;
    })
    .toBe(status);
}

async function assertNoPermanentDiagnostics(page: Page): Promise<void> {
  const panel = page.getByLabel("AI 对话面板");
  await expect(panel.getByLabel("工作流运行历史")).toHaveCount(0);
  await expect(panel.getByLabel("AI 工作流运行观测")).toHaveCount(0);
  await expect(panel.getByLabel("诊断面板")).toHaveCount(0);
  await expect(panel.getByLabel("详细运行记录")).toHaveCount(0);
  await expect(panel).not.toContainText(/Token|成本|Context Trace|Workflow History|Observability/i);
}

async function prepareProject(projectRoot: string): Promise<void> {
  const chaptersRoot = join(projectRoot, "chapters");
  await mkdir(chaptersRoot, { recursive: true });
  await copyFile(join(fixtureRoot, "project.json"), join(projectRoot, "project.json"));
  await copyFile(join(fixtureRoot, "settings.json"), join(projectRoot, "settings.json"));
  await copyFile(
    join(fixtureRoot, "chapters", `${chapterId}.md`),
    join(chaptersRoot, `${chapterId}.md`)
  );
}

function fixtureTitle(kind: FixtureKind): string {
  switch (kind) {
    case "provider_disconnect":
      return "Provider disconnect diagnostic";
    case "tool_error":
      return "Retryable tool diagnostic";
    case "context_stale":
      return "Context stale diagnostic";
    case "partial_failure":
      return "Partial failure diagnostic";
  }
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
