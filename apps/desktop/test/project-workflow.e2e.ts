import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

    const chapterFiles = await readdir(join(projectRoot, "chapters"));
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

test("creates an example project from the onboarding quick start", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-onboarding-e2e-"));
  const defaultProjectRoot = join(tempRoot, "Default Project");
  const exampleRoot = join(tempRoot, "Example Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: defaultProjectRoot
    }
  });

  try {
    const page = await electronApp.firstWindow();

    await expect(page.getByRole("region", { name: "快速开始" })).toBeVisible();
    await page.getByLabel("项目路径").fill(exampleRoot);
    await page.getByRole("button", { name: "创建示例项目" }).click();

    const projectNavigator = page.getByLabel("项目导航");
    await expect(page.getByText("示例小说项目")).toBeVisible();
    await expect(projectNavigator.getByRole("button", { name: /示例章节/ })).toBeVisible();
    await expect(page.getByLabel("章节正文")).toHaveValue(/这是一个本地示例章节/);

    const chapterFiles = await readdir(join(exampleRoot, "chapters"));
    expect(chapterFiles).toHaveLength(1);
    const [chapterFile] = chapterFiles;
    if (chapterFile === undefined) {
      throw new Error("Expected one example chapter file.");
    }
    const savedChapter = await readFile(join(exampleRoot, "chapters", chapterFile), "utf8");
    expect(savedChapter).toContain("这是一个本地示例章节");
  } finally {
    await electronApp.close();
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

    await page.getByRole("button", { name: "搜索" }).click();
    await expect(page.getByRole("heading", { name: "搜索项目" })).toBeVisible();

    await page.getByRole("button", { name: "时间线" }).click();
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();

    await page.getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await page.getByRole("button", { name: "工作区" }).click();
    await expect(page.getByLabel("编辑区")).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
