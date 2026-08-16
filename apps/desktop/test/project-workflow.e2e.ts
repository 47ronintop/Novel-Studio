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

import { expectCreativeWorkspaceReady } from "./helpers/workspace-readiness.js";
import { BRAINSTORMING_REQUEST } from "../src/renderer/brainstorming-entry.js";

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
  const projectRoot = join(tempRoot, "Project Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await queueDirectorySelections(electronApp, [tempRoot]);

    // Open the create-project dialog via the native File menu.
    await triggerFileMenuItem(electronApp, "createCreativeProject");
    await expect(page.getByRole("dialog", { name: "新建创作项目" })).toBeVisible();

    await page.getByLabel("项目标题").fill("Project Smoke");
    await page.getByLabel("项目文件夹名称").fill("Project Smoke");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expectCreativeWorkspaceReady(page);

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

    await expect
      .poll(() => readFile(join(projectRoot, "chapters", chapterFile), "utf8"))
      .toContain("E2E opening line.");
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("imports selected text files as naturally ordered chapters without changing the source", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-folder-import-e2e-"));
  const sourceRoot = join(tempRoot, "Imported Novel");
  const targetRoot = join(sourceRoot, ".shanhai");
  const sourceFiles = new Map([
    ["01-opening.txt", "Imported opening.\n"],
    ["02-middle.md", "Excluded middle.\n"],
    ["10-ending.txt", "Imported ending.\n"]
  ]);
  await mkdir(sourceRoot);
  await Promise.all(
    [...sourceFiles].map(([fileName, body]) => writeFile(join(sourceRoot, fileName), body, "utf8"))
  );
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await queueDirectorySelections(electronApp, [sourceRoot]);

    await triggerFileMenuItem(electronApp, "openCreativeProject");

    const dialog = page.getByRole("dialog", { name: "接入普通小说文件夹" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("当前文件夹内创建项目数据目录“.shanhai”");
    await expect(dialog).toContainText("源正文文件不会被修改");
    await dialog.getByRole("checkbox", { name: /02-middle/u }).uncheck();
    await dialog.getByRole("button", { name: "创建项目并导入 2 章" }).click();

    await expect(dialog).toHaveCount(0);
    await expectCreativeWorkspaceReady(page);
    await expect(page.locator(".ns-project-title")).toHaveText("Imported Novel");
    await expect(page.getByRole("tab", { name: "10-ending.md" })).toBeVisible();
    await expect(chapterBody(page)).toContainText("Imported ending.");
    await expect(
      page.getByText("项目数据已创建在 .shanhai，源正文文件未被修改。")
    ).toBeVisible();

    const chapterRows = page.getByLabel("章节列表").locator(".ns-creative-row-main");
    await expect(chapterRows).toHaveCount(2);
    const chapterRowText = await chapterRows.allTextContents();
    expect(chapterRowText[0]).toContain("01-opening");
    expect(chapterRowText[1]).toContain("10-ending");
    await expect(chapterRows.nth(1)).toHaveAttribute("aria-current", "page");

    expect((await readdir(sourceRoot)).sort()).toEqual([".shanhai", ...sourceFiles.keys()].sort());
    for (const [fileName, expectedBody] of sourceFiles) {
      expect(await readFile(join(sourceRoot, fileName), "utf8")).toBe(expectedBody);
    }
    const projectMetadata = JSON.parse(
      await readFile(join(targetRoot, "project.json"), "utf8")
    ) as {
      title?: string;
      language?: string;
      workspaceLayout?: string;
    };
    expect(projectMetadata).toMatchObject({
      title: "Imported Novel",
      language: "zh-CN",
      workspaceLayout: "nested-folder"
    });
    const chapterFiles = (await readdir(join(targetRoot, "chapters"))).filter((entry) =>
      entry.endsWith(".md")
    );
    expect(chapterFiles).toHaveLength(2);
    const chapterDocuments = await Promise.all(
      chapterFiles.map((fileName) => readFile(join(targetRoot, "chapters", fileName), "utf8"))
    );
    const orderedChapters = chapterDocuments
      .map((document) => ({
        document,
        order: Number(/\norder:\s+(\d+)/u.exec(document)?.[1] ?? Number.NaN),
        title: /\ntitle:\s+['"]?([^'"\r\n]+)['"]?/u.exec(document)?.[1]
      }))
      .sort((left, right) => left.order - right.order);
    expect(orderedChapters.map((chapter) => chapter.title)).toEqual(["01-opening", "10-ending"]);
    expect(orderedChapters[0]?.document).toContain("Imported opening.");
    expect(orderedChapters[1]?.document).toContain("Imported ending.");
    expect(chapterDocuments.join("\n")).not.toContain("Excluded middle.");
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("prefills and focuses brainstorming for an empty project without sending or replacing a draft", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-brainstorming-e2e-"));
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await queueDirectorySelections(electronApp, [tempRoot]);

    await triggerFileMenuItem(electronApp, "createCreativeProject");
    await page.getByLabel("项目标题").fill("Brainstorm Smoke");
    await page.getByLabel("项目文件夹名称").fill("Brainstorm Smoke");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expectCreativeWorkspaceReady(page);

    const startBrainstorming = page.getByRole("button", { name: "开始构思" });
    const request = page.getByLabel("Agent 请求");
    await expect(startBrainstorming).toBeEnabled();
    await request.fill("保留这份草稿");
    await expect(startBrainstorming).toBeDisabled();
    await expect(startBrainstorming).toHaveAttribute("title", "请先发送或清空当前 Agent 草稿。");
    await expect(request).toHaveValue("保留这份草稿");

    await request.fill("");
    await expect(startBrainstorming).toBeEnabled();
    await startBrainstorming.click();

    await expect(request).toHaveValue(BRAINSTORMING_REQUEST);
    await expect(request).toBeFocused();
    await expect(page.getByRole("button", { name: "停止 Agent 运行" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "启动 Agent 运行" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "空章节工作区" }).getByRole("button", { name: "新建第一章" })
    ).toBeVisible();
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
    await expect(page.getByRole("navigation", { name: "项目导航" })).toBeVisible();
    await expect(page.locator(".ns-project-title")).toHaveText("未命名长篇项目");
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
  const projectRoot = join(tempRoot, "Recovery Smoke");
  const firstApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await firstApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await queueDirectorySelections(firstApp, [tempRoot]);

    await triggerFileMenuItem(firstApp, "createCreativeProject");
    await expect(page.getByRole("dialog", { name: "新建创作项目" })).toBeVisible();

    await page.getByLabel("项目标题").fill("Recovery Smoke");
    await page.getByLabel("项目文件夹名称").fill("Recovery Smoke");
    await page.getByRole("button", { name: "选择项目父文件夹" }).click();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expectCreativeWorkspaceReady(page);
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
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "Second User Data")
    }
  });

  try {
    const page = await secondApp.firstWindow();
    await expect(page.getByLabel("编辑区")).toBeVisible();
    await queueDirectorySelections(secondApp, [projectRoot]);

    await triggerFileMenuItem(secondApp, "openCreativeProject");

    await expect(page.locator(".ns-project-title")).toHaveText("Recovery Smoke");
    const recoveryReview = page.getByLabel("章节恢复审阅");
    await expect(recoveryReview).toBeVisible();
    await recoveryReview.getByRole("button", { name: /预览恢复草稿/ }).click();
    await expect(page.getByLabel("恢复草稿预览")).toContainText("Recovered draft from autosave.");
    await recoveryReview.getByRole("button", { name: /应用恢复草稿/ }).click();
    await expect(chapterBody(page)).toContainText(recoveredBody.trim());
    const saveButton = page.getByRole("button", { name: "保存当前文档" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();

    await expect
      .poll(() => readFile(chapterPath, "utf8"))
      .toContain("Recovered draft from autosave.");
    await expect
      .poll(async () => {
        const recoveryRecord = JSON.parse(
          await readFile(join(projectRoot, "history", "recovery", `${sessionId}.json`), "utf8")
        ) as { readonly dirty: boolean };
        return recoveryRecord.dirty;
      })
      .toBe(false);
  } finally {
    await secondApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("switches visible beta activity views without a duplicate timeline activity", async () => {
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

    await expect(activityBar.getByRole("button", { name: "时间线" })).toHaveCount(0);
    await activityBar.getByRole("button", { name: "故事资料" }).click();
    await expect(page.getByLabel("故事圣经")).toBeVisible();
    await page
      .getByRole("tablist", { name: "创作导航模式" })
      .getByRole("tab", { name: "故事资料" })
      .click();
    const storyKinds = page.getByLabel("故事资料分类");
    await expect(storyKinds.getByRole("button", { name: /时间线/u })).toBeVisible();

    await activityBar.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("编辑区")).toBeVisible();

    await activityBar.getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.getByLabel("编辑区")).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
