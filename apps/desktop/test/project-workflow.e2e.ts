import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

function chapterBody(page: Page) {
  return page.getByLabel("章节正文").locator(".cm-content");
}

async function replaceChapterBody(page: Page, body: string): Promise<void> {
  const editor = chapterBody(page);
  await editor.fill(body);
}

async function queueDirectorySelections(
  electronApp: ElectronApplication,
  paths: readonly string[]
): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPaths) => {
    const queue = [...selectedPaths];
    dialog.showOpenDialog = async () => {
      const selectedPath = queue.shift();
      return selectedPath === undefined
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [selectedPath] };
    };
  }, paths);
}

async function triggerFileMenuItem(
  electronApp: ElectronApplication,
  commandId: string
): Promise<void> {
  await electronApp.evaluate(({ Menu }, id) => {
    const appMenu = Menu.getApplicationMenu();
    const fileMenu = appMenu?.items.find((item) => item.label === "文件");
    const menuItem = (fileMenu?.submenu?.items ?? []).find((item) => item.id === id);
    menuItem?.click({ triggerAcceleratorIfAvailable: false } as never);
  }, commandId);
}

test("creates a project, creates a chapter, edits it, and saves through Electron", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const projectRoot = join(tempRoot, "Project Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelections(electronApp, [tempRoot]);

    await expect(page.getByLabel("工作区导航")).toBeVisible();

    // Open the create-project dialog via the native File menu.
    await triggerFileMenuItem(electronApp, "createCreativeProject");
    await expect(page.getByRole("dialog", { name: "新建创作项目" })).toBeVisible();

    await page.getByLabel("项目标题").fill("Project Smoke");
    await page.getByLabel("项目文件夹名称").fill("Project Smoke");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目" }).click();

    await expect(page.getByText("Project Smoke")).toBeVisible();

    await page.getByRole("button", { name: "新建章节" }).click();
    await expect(page.getByRole("tab", { name: "Untitled Chapter 1.md" })).toBeVisible();

    await expect(chapterBody(page)).toBeVisible();
    await replaceChapterBody(page, "E2E opening line.");

    const saveButton = page.getByRole("button", { name: "保存当前文档" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();

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
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();

    await expect(page.getByRole("region", { name: "快速开始" })).toHaveCount(0);
    // Project lifecycle commands are now in the native File menu, not the Navigator.
    await expect(page.getByRole("navigation", { name: "项目导航" })).toHaveCount(0);
    await expect(page.getByText("未命名长篇项目")).toBeVisible();
    await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible();
    await expect(chapterBody(page)).toContainText(/这是第一章的正文/);

    await page.getByRole("button", { name: "查找当前文档" }).click();
    const findOverlay = page.getByRole("region", { name: "查找替换", exact: true });
    await expect(findOverlay).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(findOverlay).toHaveCount(0);

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
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await firstApp.firstWindow();
    await queueDirectorySelections(firstApp, [tempRoot]);

    await triggerFileMenuItem(firstApp, "createCreativeProject");
    await expect(page.getByRole("dialog", { name: "新建创作项目" })).toBeVisible();

    await page.getByLabel("项目标题").fill("Recovery Smoke");
    await page.getByLabel("项目文件夹名称").fill("Recovery Smoke");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目" }).click();
    await expect(page.getByText("Recovery Smoke")).toBeVisible();
    await page.getByRole("button", { name: "新建章节" }).click();
    await expect(page.getByRole("tab", { name: "Untitled Chapter 1.md" })).toBeVisible();
    await expect(chapterBody(page)).toBeVisible();

    await replaceChapterBody(page, "Persisted baseline.");
    const saveButton = page.getByRole("button", { name: "保存当前文档" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
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
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Second Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "Second User Data")
    }
  });

  try {
    const page = await secondApp.firstWindow();
    await queueDirectorySelections(secondApp, [projectRoot]);

    await triggerFileMenuItem(secondApp, "openCreativeProject");

    await expect(page.getByLabel("Autosave recovery")).toBeVisible();
    await page.getByRole("button", { name: /预览恢复草稿/ }).click();
    await expect(page.getByLabel("恢复草稿预览")).toContainText("Recovered draft from autosave.");
    await page.getByRole("button", { name: /应用恢复草稿/ }).click();
    await expect(chapterBody(page)).toContainText(recoveredBody.trim());
    const saveButton = page.getByRole("button", { name: "保存当前文档" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();

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
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
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

    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.getByLabel("编辑区")).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
