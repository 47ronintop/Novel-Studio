import { expect, test, _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentRunFileRepository,
  AgentUsageFileRepository,
  RecoveryRepository,
  type AgentTransactionJournal,
  type RecoveryRecord
} from "@novel-studio/repository";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("shows private daily usage analytics and clears only usage data", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-usage-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  const userDataRoot = join(tempRoot, "User Data");
  const today = localDateToday();
  const repository = new AgentUsageFileRepository({ userDataRoot });
  const records = [
    usageRecord(today, {
      runId: "run_reported",
      roundId: "reported",
      finalSequence: 1,
      cachedTokens: 100,
      cacheReadTokens: 100,
      cacheEligibleInputTokens: 125,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "included_in_input",
      cacheMode: "automatic_prefix",
      cachePrefixChecksum: "a".repeat(64),
      usageStatus: "actual",
      precision: "reported",
      cost: { amount: 1.5, currency: "USD", status: "actual" }
    }),
    usageRecord(today, {
      runId: "run_estimated",
      roundId: "estimated",
      finalSequence: 2,
      model: "gpt-5.6-luna",
      cacheInputTokenSemantics: "included_in_input",
      cacheMode: "automatic_prefix",
      pricingVersion: "pricing-v1",
      unitPrices: { inputPerMillion: 100, outputPerMillion: 2000, currency: "EUR" },
      cost: { amount: 0.5, currency: "EUR", status: "estimated" }
    }),
    usageRecord(today, {
      runId: "run_unknown",
      roundId: "unknown",
      finalSequence: 3,
      model: "gpt-5.6-luna"
    })
  ];
  for (const record of records) {
    const written = await repository.writeFinal(record);
    expect(written, JSON.stringify(written)).toMatchObject({ ok: true });
  }

  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot
    })
  });
  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(1100, 780));
    const runRepository = new AgentRunFileRepository({ projectRoot });
    const recoveryRepository = new RecoveryRepository({ projectRoot });
    await seedProjectHistory(runRepository, recoveryRepository);
    await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
    const settingsCategories = page.locator(".model-settings-category-list");
    await settingsCategories.getByText("外观", { exact: true }).click();
    await page.getByRole("button", { name: "浅色主题" }).click();
    await expect(page.locator(".ns-shell")).toHaveAttribute("data-theme", "light");
    await settingsCategories.getByText("Agent 用量", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Agent 用量" })).toBeVisible();
    const dailyChart = page.locator('.agent-usage-chart[data-chart-kind="daily"]');
    await expect(dailyChart).toBeVisible();
    await expect(page.getByRole("img", { name: "每日 Agent Token 柱状图" })).toBeVisible();
    await expect(dailyChart.locator(".agent-usage-bar-column")).toHaveCount(1);
    await expect(dailyChart.locator(".agent-usage-legend li")).toHaveCount(2);
    await expectNoHorizontalOverflow(page.locator(".agent-usage-settings"));
    await expect(page.locator(".agent-usage-summary-card")).toHaveCount(6);
    await expect(page.getByLabel("Provider 筛选")).toBeVisible();
    await expect(page.getByLabel("Model 筛选")).toBeVisible();
    await expect(page.getByLabel("Project 筛选")).toBeVisible();
    await expect(page.getByText("查找用量")).toBeVisible();
    await expectUsesThemeInk(page.locator(".agent-usage-summary-card strong").first());
    await expect(
      page.locator('.agent-usage-summary-secondary[data-telemetry-status="partial"]')
    ).toHaveText("数据不完整");
    const dailySegmentColors = await dailyChart
      .locator(".agent-usage-bar-segment")
      .evaluateAll((segments) =>
        segments.map((segment) =>
          getComputedStyle(segment).getPropertyValue("--usage-color").trim()
        )
      );
    expect(new Set(dailySegmentColors).size).toBe(2);
    const daily = page.getByRole("table", { name: "每日 Agent 用量明细" });
    await expect(daily.locator("thead th")).toHaveCount(7);
    await expect(daily.locator("thead th")).toHaveText([
      "日期",
      "总 Token",
      "输入",
      "输出",
      "缓存读取",
      "缓存写入",
      "命中率"
    ]);
    await expect(page.locator(".agent-usage-settings")).not.toContainText(/费用|缓存节省|USD|EUR/);

    await page.getByRole("button", { name: "今日", exact: true }).press("Enter");
    const hourlyChart = page.locator('.agent-usage-chart[data-chart-kind="hourly"]');
    await expect(hourlyChart).toBeVisible();
    await expect(page.getByRole("img", { name: "每小时 Agent Token 柱状图" })).toBeVisible();
    await expect(hourlyChart.locator(".agent-usage-bar-column")).toHaveCount(24);
    await expect(hourlyChart.locator(".agent-usage-legend li")).toHaveCount(2);
    await expectNoHorizontalOverflow(hourlyChart.locator(".agent-usage-chart-body"));
    const runs = page.getByRole("list", { name: "所选日期 Agent 运行记录" });
    await expect(runs.getByRole("listitem")).toHaveCount(3);
    await expectNoHorizontalOverflow(runs);
    await expect(runs).toContainText("输入1,000");
    await expect(runs).toContainText("输出200");
    await expect(runs).toContainText("缓存读取100");
    await expect(runs).toContainText("缓存写入不可用");
    await expect(runs).toContainText("命中 · 命中率 80% · 读取 100");
    await expect(runs).toContainText("未提供缓存结果");
    await expect(runs).not.toContainText("未启用");
    await expect(runs).not.toContainText(/模式：|缓存用量：|输入口径：|Prefix：|可缓存输入/);
    await expect(runs).not.toContainText(/费用|USD|EUR/);
    await expect(runs).not.toContainText("run_reported");
    await expect(runs).not.toContainText("a".repeat(64));
    await expect(runs).not.toContainText(/prompt|request|正文内容|secret/i);

    await page.getByRole("button", { name: "清除所选范围用量" }).click();
    await expect(page.getByText("所选范围暂无 Agent 用量记录。")).toBeVisible();
    await expectProjectHistoryReadable(runRepository, recoveryRepository);

    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.getByRole("heading", { name: "Agent 用量" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(
      /Token 用量（按|实际费用|估算费用|Agent 运行记录/
    );
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function expectNoHorizontalOverflow(
  locator: import("@playwright/test").Locator
): Promise<void> {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectUsesThemeInk(locator: import("@playwright/test").Locator): Promise<void> {
  const colors = await locator.evaluate((element) => {
    const shell = element.closest(".ns-shell");
    return {
      actual: getComputedStyle(element).color,
      expected: shell === null ? "" : getComputedStyle(shell).color
    };
  });
  expect(colors.actual).toBe(colors.expected);
}

async function seedProjectHistory(
  runRepository: AgentRunFileRepository,
  recoveryRepository: RecoveryRepository
): Promise<void> {
  const snapshot = {
    schemaVersion: "1.0",
    runId: "run_usage_preserve",
    projectId: "project_01",
    status: "completed",
    runRevision: 1,
    lastSequence: 1
  };
  const changeSet = {
    schemaVersion: "1.0",
    changeSetId: "changes_usage_preserve",
    revision: 1,
    runId: snapshot.runId,
    projectId: snapshot.projectId,
    checkpointId: "checkpoint_usage_preserve",
    contextSnapshotId: "context_usage_preserve",
    status: "awaiting_approval",
    checksum: "c".repeat(64),
    approvalToken: "c".repeat(64),
    createdAt: "2026-07-17T08:00:00.000Z",
    files: []
  };
  const recovery: RecoveryRecord = {
    schemaVersion: "1.0",
    sessionId: "session_usage_preserve",
    projectId: snapshot.projectId,
    openAssetId: "ch_usage_preserve",
    assetType: "chapter",
    dirty: true,
    draftContentRef: { strategy: "inline", content: "recoverable draft" },
    updatedAt: "2026-07-17T08:00:00.000Z"
  };
  const applyJournal = transactionJournal("tx_usage_apply", "vg_usage_apply", "apply");
  const undoJournal: AgentTransactionJournal = {
    ...transactionJournal("tx_usage_undo", "vg_usage_undo", "run_undo"),
    runSequence: 2,
    changeSetId: "undo_run_usage_preserve",
    changeSetRevision: 0,
    undoOfVersionGroupIds: [applyJournal.versionGroupId]
  };

  expect(await runRepository.writeSnapshot(snapshot)).toMatchObject({ ok: true });
  expect(await runRepository.writeChangeSet(changeSet)).toMatchObject({ ok: true });
  expect(await recoveryRepository.writeRecoveryRecord(recovery)).toMatchObject({ ok: true });
  expect(await recoveryRepository.writeAgentTransactionJournal(applyJournal)).toMatchObject({
    ok: true
  });
  expect(await recoveryRepository.writeAgentTransactionJournal(undoJournal)).toMatchObject({
    ok: true
  });
}

async function expectProjectHistoryReadable(
  runRepository: AgentRunFileRepository,
  recoveryRepository: RecoveryRepository
): Promise<void> {
  expect(await runRepository.readSnapshot("run_usage_preserve")).toMatchObject({
    ok: true,
    value: { runId: "run_usage_preserve", status: "completed" }
  });
  expect(await runRepository.readChangeSet("changes_usage_preserve", 1)).toMatchObject({
    ok: true,
    value: { changeSetId: "changes_usage_preserve", revision: 1 }
  });
  expect(await recoveryRepository.listRecoveryRecords()).toMatchObject({
    ok: true,
    value: [{ sessionId: "session_usage_preserve", dirty: true }]
  });
  expect(await recoveryRepository.readAgentTransactionJournal("tx_usage_apply")).toMatchObject({
    ok: true,
    value: { versionGroupId: "vg_usage_apply", kind: "apply", transactionStatus: "applied" }
  });
  expect(await recoveryRepository.readAgentTransactionJournal("tx_usage_undo")).toMatchObject({
    ok: true,
    value: {
      versionGroupId: "vg_usage_undo",
      kind: "run_undo",
      transactionStatus: "applied",
      undoOfVersionGroupIds: ["vg_usage_apply"]
    }
  });
}

function transactionJournal(
  transactionId: string,
  versionGroupId: string,
  kind: "apply" | "run_undo"
): AgentTransactionJournal {
  const changeSetId = "changes_usage_preserve";
  const changeSetChecksum = "c".repeat(64);
  const common = {
    schemaVersion: "1.0" as const,
    transactionId,
    versionGroupId,
    kind,
    runId: "run_usage_preserve",
    runSequence: 1,
    checkpointId: "checkpoint_usage_preserve",
    changeSetId,
    changeSetRevision: 1,
    changeSetChecksum,
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-17T08:00:00.000Z",
    transactionStatus: "applied" as const,
    entries: []
  };
  if (kind !== "apply") return common;
  return {
    ...common,
    writePolicy: "write_before_confirmation",
    approvalSource: "human_confirmation",
    approvalToken: sha256(`${changeSetId}:1:${changeSetChecksum}`)
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function usageRecord(localDate: string, overrides: Record<string, unknown> = {}) {
  const timestamp = `${localDate}T08:00:00.000Z`;
  const base = {
    schemaVersion: "1.2",
    scope: {
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: "project_01"
    },
    usageId: "",
    runId: "run_base",
    conversationId: "conversation_01",
    roundId: "round_01",
    finalSequence: 1,
    provider: "openai",
    model: "gpt-5",
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    cacheOutcome: "unknown",
    cacheUsageStatus: "unavailable",
    cacheInputTokenSemantics: "unavailable",
    cacheMode: null,
    cachePrefixChecksum: null,
    usageStatus: "estimated",
    precision: "estimated",
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" },
    contextWindow: 128000,
    safeInputBudget: 117000,
    terminationReason: "compaction",
    timestamp,
    localDate,
    timezone: "Asia/Shanghai",
    utcOffsetMinutes: 480,
    ...overrides
  };
  return {
    ...base,
    usageId: `${String(base.runId)}:${String(base.roundId)}:${String(base.finalSequence)}`
  };
}

function localDateToday(): string {
  const current = new Date();
  return `${current.getFullYear().toString().padStart(4, "0")}-${(current.getMonth() + 1).toString().padStart(2, "0")}-${current.getDate().toString().padStart(2, "0")}`;
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
