import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("generates an AI writing suggestion and applies it only after confirmation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-ai-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "AI Workflow Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const activityBar = page.getByLabel("活动栏");

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await body.fill("Opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByLabel("AI 写作指令").fill("Continue the active scene.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(page.getByText("Generated a local mock continuation for review.")).toBeVisible();
    await expect(page.getByLabel("AI 建议差异")).toContainText("AI continuation draft.");
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("章节正文")).toHaveValue(/Opening line\./);
    await expect(page.getByLabel("章节正文")).not.toHaveValue(/AI continuation draft\./);

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByRole("button", { name: "应用 AI 建议" }).click();

    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("章节正文")).toHaveValue(
      "Opening line.\nAI continuation draft.\n"
    );
    await expect(page.getByText("未保存").first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completes the core writing journey across save, close, reopen, and continued editing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-core-journey-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "Core Journey Smoke");

  const firstApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await firstApp.firstWindow();
    const activityBar = page.getByLabel("活动栏");

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await body.fill("Core journey opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByLabel("AI 写作指令").fill("Continue the current chapter for the core journey.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(page.getByLabel("AI 建议差异")).toContainText("AI continuation draft.");
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("章节正文")).toHaveValue("Core journey opening line.");

    await activityBar.getByRole("button", { name: "AI 工作流" }).click();
    await page.getByRole("button", { name: "应用 AI 建议" }).click();
    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("章节正文")).toHaveValue(
      "Core journey opening line.\nAI continuation draft.\n"
    );
    await expect(page.getByText("未保存").first()).toBeVisible();

    await page.getByRole("button", { name: "保存章节" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();
  } finally {
    await firstApp.close();
  }

  const chapterFiles = (await readdir(join(projectRoot, "chapters"))).filter((entry) =>
    entry.endsWith(".md")
  );
  expect(chapterFiles).toHaveLength(1);
  const [chapterFile] = chapterFiles;
  if (chapterFile === undefined) {
    throw new Error("Expected one chapter file after the first writing session.");
  }
  const chapterPath = join(projectRoot, "chapters", chapterFile);
  const savedAfterAi = await readFile(chapterPath, "utf8");
  expect(savedAfterAi).toContain("Core journey opening line.");
  expect(savedAfterAi).toContain("AI continuation draft.");

  const historyAssetDirs = await readdir(join(projectRoot, "history", "chapters"));
  expect(historyAssetDirs.length).toBeGreaterThan(0);

  const secondApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Second Default Project")
    }
  });

  try {
    const page = await secondApp.firstWindow();

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "打开项目" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toHaveValue("Core journey opening line.\nAI continuation draft.\n");
    await expect(page.getByLabel("版本历史")).toContainText("Before AI apply");

    await body.fill("Core journey opening line.\nAI continuation draft.\nContinued after reopen.");
    await expect(page.getByText("未保存").first()).toBeVisible();
    await page.getByRole("button", { name: "保存章节" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();
  } finally {
    await secondApp.close();
  }

  const savedAfterReopen = await readFile(chapterPath, "utf8");
  expect(savedAfterReopen).toContain("Continued after reopen.");

  await rm(tempRoot, { recursive: true, force: true });
});
