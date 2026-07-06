import { expect, test, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("creates a project, creates a chapter, edits it, and saves through Electron", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "Project Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await electronApp.firstWindow();

    await expect(page.getByLabel("项目导航")).toBeVisible();

    await page.getByLabel("项目路径").fill(join(tempRoot, "Missing Project"));
    await page.getByRole("button", { name: "打开项目" }).click();
    await expect(page.getByText("project.json could not be read.")).toBeVisible();

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();

    await expect(page.getByText("Project Smoke")).toBeVisible();

    const projectNavigator = page.getByLabel("项目导航");
    await page.getByRole("button", { name: "新建章节" }).click();
    await expect(projectNavigator.getByRole("button", { name: /未命名章节 1/ })).toBeVisible();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await body.fill("E2E opening line.");

    await expect(page.getByText("未保存").first()).toBeVisible();
    await page.getByRole("button", { name: "保存章节" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();

    const chapterFiles = (await readdir(join(projectRoot, "chapters"))).filter((entry) =>
      entry.endsWith(".md")
    );
    expect(chapterFiles).toHaveLength(1);
    const [chapterFile] = chapterFiles;
    expect(chapterFile).toBeDefined();
    if (chapterFile === undefined) {
      throw new Error("Expected one saved chapter file.");
    }

    const savedChapter = await readFile(join(projectRoot, "chapters", chapterFile), "utf8");
    expect(savedChapter).toContain("E2E opening line.");
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("starts public install users in a ready default project without quick start", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-onboarding-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await electronApp.firstWindow();

    const projectNavigator = page.getByLabel("项目导航");
    await expect(page.getByRole("region", { name: "快速开始" })).toHaveCount(0);
    await expect(projectNavigator.getByRole("button", { name: "打开项目" })).toBeVisible();
    await expect(projectNavigator.getByRole("button", { name: "创建项目" })).toBeVisible();
    await expect(projectNavigator.getByRole("button", { name: "新建章节" })).toBeVisible();
    await expect(page.getByText("未命名长篇项目")).toBeVisible();
    await expect(page.getByRole("tab", { name: "第一章" })).toBeVisible();
    await expect(page.getByLabel("章节正文")).toHaveValue(/这是第一章的正文/);

    const chapterFiles = (await readdir(join(defaultProjectRoot, "chapters"))).filter((entry) =>
      entry.endsWith(".md")
    );
    expect(chapterFiles).toHaveLength(1);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("keeps quick start hidden after relaunch when a default project is ready", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-preferences-e2e-"));
  const userDataRoot = join(tempRoot, "User Data");
  const firstApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot
    }
  });

  try {
    const page = await firstApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await expect(page.getByRole("region", { name: "快速开始" })).toHaveCount(0);
  } finally {
    await firstApp.close();
  }

  const secondApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Second Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: userDataRoot
    }
  });

  try {
    const page = await secondApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await expect(page.getByRole("region", { name: "快速开始" })).toHaveCount(0);
  } finally {
    await secondApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("reviews and applies an autosave recovery draft from disk", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-recovery-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "Recovery Smoke");
  const firstApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await firstApp.firstWindow();

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await body.fill("Persisted baseline.");
    await page.getByRole("button", { name: "保存章节" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();
  } finally {
    await firstApp.close();
  }

  const projectMetadata = JSON.parse(await readFile(join(projectRoot, "project.json"), "utf8")) as {
    readonly projectId: string;
  };
  const chapterFiles = (await readdir(join(projectRoot, "chapters"))).filter((entry) =>
    entry.endsWith(".md")
  );
  const [chapterFile] = chapterFiles;
  if (chapterFile === undefined) {
    throw new Error("Expected one chapter file before writing recovery.");
  }
  const chapterPath = join(projectRoot, "chapters", chapterFile);
  const chapterMarkdown = await readFile(chapterPath, "utf8");
  const chapterId = /id:\s+['"]?([^'"\r\n]+)['"]?/.exec(chapterMarkdown)?.[1]?.trim();
  if (chapterId === undefined) {
    throw new Error("Expected chapter id in frontmatter.");
  }
  const sessionId = `session_${projectMetadata.projectId}_${chapterId}`;
  const recoveredBody = "Recovered draft from autosave.\n";
  await mkdir(join(projectRoot, "history", "recovery"), { recursive: true });
  await writeFile(
    join(projectRoot, "history", "recovery", `${sessionId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        sessionId,
        projectId: projectMetadata.projectId,
        openAssetId: chapterId,
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "inline",
          content: recoveredBody
        },
        updatedAt: "2026-07-06T00:05:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

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

    await expect(page.getByLabel("Autosave recovery")).toBeVisible();
    await page.getByRole("button", { name: /预览恢复草稿/ }).click();
    await expect(page.getByLabel("恢复草稿预览")).toContainText("Recovered draft from autosave.");
    await page.getByRole("button", { name: /应用恢复草稿/ }).click();
    await expect(page.getByLabel("章节正文")).toHaveValue(recoveredBody);
    await page.getByRole("button", { name: "保存章节" }).click();
    await expect(page.getByText("已保存").first()).toBeVisible();

    const savedChapter = await readFile(chapterPath, "utf8");
    expect(savedChapter).toContain("Recovered draft from autosave.");
    const recoveryRecord = JSON.parse(
      await readFile(join(projectRoot, "history", "recovery", `${sessionId}.json`), "utf8")
    ) as { readonly dirty: boolean };
    expect(recoveryRecord.dirty).toBe(false);
  } finally {
    await secondApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("switches visible beta activity views from the left activity bar", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-activity-e2e-"));
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const activityBar = page.getByLabel("活动栏");

    await activityBar.getByRole("button", { name: "搜索" }).click();
    await expect(page.getByRole("heading", { name: "搜索项目" })).toBeVisible();

    await activityBar.getByRole("button", { name: "时间线" }).click();
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();

    await activityBar.getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("编辑区")).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
