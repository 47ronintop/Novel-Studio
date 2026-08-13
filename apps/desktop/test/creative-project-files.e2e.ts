import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from "@playwright/test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectCreativeWorkspaceReady } from "./helpers/workspace-readiness.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("keeps creative project files inside the creative workbench through lifecycle and dirty guards", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-creative-files-e2e-"));
  const projectFolderName = "Creative Files Smoke";
  const projectRoot = join(tempRoot, projectFolderName);
  const sourcePath = "notes/draft.md";
  const renamedPath = "notes/renamed.md";
  const sourceFile = join(projectRoot, "notes", "draft.md");
  const renamedFile = join(projectRoot, "notes", "renamed.md");
  const savedContent = "A durable creative project file.\n";
  const electronApp = await electron.launch({
    args: [electronMain],
    env: createUnboundElectronEnv({
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelections(electronApp, [tempRoot]);
    await expect(page.getByLabel("工作区导航")).toBeVisible();
    await createCreativeProject(page, electronApp, {
      title: projectFolderName,
      folderName: projectFolderName
    });

    await expectCreativeWorkbench(page);
    const navigator = page.getByRole("navigation", { name: "项目导航" });
    const modeTabs = page.getByRole("tablist", { name: "创作导航模式" });
    await expect(modeTabs.getByRole("tab", { name: "写作" })).toBeVisible();
    await expect(modeTabs.getByRole("tab", { name: "故事资料" })).toBeVisible();
    await expect(modeTabs.getByRole("tab", { name: "项目文件" })).toHaveCount(0);

    const otherFiles = navigator.getByRole("button", { name: "其他文件" });
    await expect(otherFiles).toHaveAttribute("aria-expanded", "false");
    await otherFiles.click();
    await expect(
      navigator.getByLabel("其他文件列表").or(navigator.getByText("还没有其他文件"))
    ).toBeVisible();
    await expect(navigator.locator('[aria-label*="project.json"]')).toHaveCount(0);
    await expect(navigator.locator('[aria-label*="settings.json"]')).toHaveCount(0);
    await expect(navigator.locator('[aria-label*="chapters"]')).toHaveCount(0);
    await expectCreativeWorkbench(page);

    await acceptPromptFromClick(page, "notes", () =>
      navigator.getByRole("button", { name: "新建其他文件目录" }).click()
    );
    await expect(navigator.getByRole("button", { name: "展开目录：notes" })).toBeVisible();

    await acceptPromptFromClick(page, sourcePath, () =>
      navigator.getByRole("button", { name: "新建其他文件", exact: true }).click()
    );
    await navigator.getByRole("button", { name: "展开目录：notes" }).click();
    const sourceFileButton = navigator.getByRole("button", { name: "打开文件：draft.md" });
    await expect(sourceFileButton).toBeVisible();
    await sourceFileButton.click();

    const editor = page.getByRole("region", { name: "普通文件编辑器" });
    await expect(editor).toBeVisible();
    await replacePlainFileBody(page, savedContent);
    const saveButton = page.getByRole("button", { name: "保存当前文档" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect.poll(() => readFile(sourceFile, "utf8")).toBe(savedContent);
    await expectCreativeWorkbench(page);

    // Both navigator modes remain within the creative workbench, and opening a file preserves
    // the selected mode instead of routing through a dedicated files mode.
    await modeTabs.getByRole("tab", { name: "写作" }).click();
    await expect(modeTabs.getByRole("tab", { name: "写作" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expectCreativeWorkbench(page);
    await modeTabs.getByRole("tab", { name: "故事资料" }).click();
    await expect(modeTabs.getByRole("tab", { name: "故事资料" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expectCreativeWorkbench(page);

    await openProjectFile(page, navigator, "notes", "draft.md");
    await expect(modeTabs.getByRole("tab", { name: "故事资料" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await replacePlainFileBody(page, "Unsaved content must not be renamed.\n");
    await cancelDirtyRename(page, navigator, sourcePath, renamedPath);
    await expectNativeDialogCalls(page, [
      "prompt:输入要重命名的项目路径",
      "prompt:输入新的项目内路径",
      "confirm:当前项目文件尚未保存。是否先保存？",
      "confirm:是否放弃当前项目文件的未保存修改？"
    ]);
    await expect.poll(() => readFile(sourceFile, "utf8")).toBe(savedContent);
    await expect(pathExists(renamedFile)).resolves.toBe(false);
    await expect(navigator.getByRole("button", { name: "打开文件：draft.md" })).toBeVisible();

    await saveDirtyRename(page, navigator, sourcePath, renamedPath);
    await expectNativeDialogCalls(page, [
      "prompt:输入要重命名的项目路径",
      "prompt:输入新的项目内路径",
      "confirm:当前项目文件尚未保存。是否先保存？"
    ]);
    await expect.poll(() => pathExists(renamedFile)).toBe(true);
    await expect(pathExists(sourceFile)).resolves.toBe(false);
    await expect
      .poll(() => readFile(renamedFile, "utf8"))
      .toBe("Unsaved content must not be renamed.\n");

    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("普通文件正文")).toContainText(
      "Unsaved content must not be renamed."
    );
    await replacePlainFileBody(page, "Renamed content must remain editable.\n");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect
      .poll(() => readFile(renamedFile, "utf8"))
      .toBe("Renamed content must remain editable.\n");

    await confirmDelete(page, navigator, renamedPath);
    await expect.poll(() => pathExists(renamedFile)).toBe(false);
    await expect(navigator.getByRole("button", { name: "打开文件：renamed.md" })).toHaveCount(0);
    await expect(editor).toHaveCount(0);
    await expectCreativeWorkbench(page);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createUnboundElectronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["NOVEL_STUDIO_PROJECT_ROOT"];
  return { ...env, ...overrides };
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

async function createCreativeProject(
  page: Page,
  electronApp: ElectronApplication,
  input: { readonly title: string; readonly folderName: string }
): Promise<void> {
  await triggerFileMenuItem(electronApp, "createCreativeProject");
  await expect(page.getByRole("dialog", { name: "新建创作项目" })).toBeVisible();
  await page.getByLabel("项目标题").fill(input.title);
  await page.getByLabel("项目文件夹名称").fill(input.folderName);
  await page.getByRole("button", { name: "选择项目父文件夹" }).click();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
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

async function expectCreativeWorkbench(page: Page): Promise<void> {
  await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
  await expect(page.getByRole("navigation", { name: "工程资源管理器" })).toHaveCount(0);
}

async function acceptPromptFromClick(
  page: Page,
  value: string,
  click: () => Promise<void>
): Promise<void> {
  await setNativeDialogResponses(page, { prompts: [value] });
  await click();
}

async function openProjectFile(
  page: Page,
  navigator: Locator,
  directoryName: string,
  fileName: string
): Promise<void> {
  const expandDirectory = navigator.getByRole("button", {
    name: `展开目录：${directoryName}`
  });
  if (await expandDirectory.isVisible()) {
    const expanded = await expandDirectory.getAttribute("aria-expanded");
    if (expanded !== "true") await expandDirectory.click();
  }
  const file = navigator.getByRole("button", { name: `打开文件：${fileName}` });
  await expect(file).toBeVisible();
  await file.click();
  await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
}

async function replacePlainFileBody(page: Page, content: string): Promise<void> {
  const body = page.getByLabel("普通文件正文").locator('.cm-content[contenteditable="true"]');
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(content);
}

async function cancelDirtyRename(
  page: Page,
  navigator: Locator,
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await setNativeDialogResponses(page, {
    prompts: [sourcePath, targetPath],
    confirms: [false, false]
  });
  await beginPathAction(navigator, "重命名");
}

async function saveDirtyRename(
  page: Page,
  navigator: Locator,
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await setNativeDialogResponses(page, {
    prompts: [sourcePath, targetPath],
    confirms: [true]
  });
  await beginPathAction(navigator, "重命名");
}

async function beginPathAction(navigator: Locator, actionName: "重命名"): Promise<void> {
  await openProjectFileActionMenu(navigator);
  await navigator.getByRole("button", { name: actionName }).click();
}

async function confirmDelete(page: Page, navigator: Locator, path: string): Promise<void> {
  await setNativeDialogResponses(page, { prompts: [path], confirms: [true] });
  await openProjectFileActionMenu(navigator);
  await navigator.getByRole("button", { name: "删除" }).click();
}

async function openProjectFileActionMenu(navigator: Locator): Promise<void> {
  const menu = navigator.locator('[data-project-file-actions="true"]');
  if ((await menu.getAttribute("open")) !== "") {
    await navigator.getByLabel("其他文件更多操作").click();
  }
}

async function setNativeDialogResponses(
  page: Page,
  responses: {
    readonly prompts?: readonly string[];
    readonly confirms?: readonly boolean[];
  }
): Promise<void> {
  await page.evaluate(({ prompts = [], confirms = [] }) => {
    const remainingPrompts = [...prompts];
    const remainingConfirms = [...confirms];
    const dialogWindow = window as Window & { __creativeProjectFileDialogCalls?: string[] };
    const calls: string[] = [];
    dialogWindow.__creativeProjectFileDialogCalls = calls;
    window.prompt = (message) => {
      calls.push(`prompt:${message}`);
      return remainingPrompts.shift() ?? null;
    };
    window.confirm = (message) => {
      calls.push(`confirm:${message}`);
      return remainingConfirms.shift() ?? false;
    };
  }, responses);
}

async function expectNativeDialogCalls(page: Page, expected: readonly string[]): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __creativeProjectFileDialogCalls?: readonly string[] })
            .__creativeProjectFileDialogCalls ?? []
      )
    )
    .toEqual(expected);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
