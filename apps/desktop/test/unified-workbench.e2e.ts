import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectCreativeWorkspaceReady,
  expectEngineeringWorkspaceReady
} from "./helpers/workspace-readiness.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("switches a creative project into the engineering explorer without losing the file tab", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-workbench-e2e-"));
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
    const workbenchTrigger = page.getByRole("button", { name: "当前工作台：创作工作台" });
    await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
    const projectStatusBox = await page.locator(".ns-project-status").boundingBox();
    const titlebarBox = await page.locator(".ns-titlebar").boundingBox();
    const workbenchBox = await workbenchTrigger.boundingBox();
    expect(projectStatusBox).not.toBeNull();
    expect(titlebarBox).not.toBeNull();
    expect(workbenchBox).not.toBeNull();
    if (projectStatusBox !== null && workbenchBox !== null) {
      expect(workbenchBox.x - (projectStatusBox.x + projectStatusBox.width)).toBeGreaterThanOrEqual(
        24
      );
    }
    if (titlebarBox !== null && workbenchBox !== null) {
      const titlebarCenter = titlebarBox.x + titlebarBox.width / 2;
      const workbenchCenter = workbenchBox.x + workbenchBox.width / 2;
      expect(Math.abs(workbenchCenter - titlebarCenter)).toBeLessThanOrEqual(2);
    }

    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window) => window.setContentSize(1024, 900));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024);
    await expect(page.getByRole("navigation", { name: "项目导航" })).toBeVisible();

    await workbenchTrigger.click();
    await page.getByRole("menuitemradio", { name: "工程工作区" }).click();

    await expectEngineeringWorkspaceReady(page);
    await expect(page.getByRole("button", { name: "搜索" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创作系统" })).toHaveCount(0);

    const projectFile = page.locator('button[aria-label^="打开文件：project.json"]');
    await expect(projectFile).toBeVisible();
    await projectFile.click();
    await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
    await expect(page.getByText(/只读：由 Novel Studio 管理的资产/)).toBeVisible();
    await expect(page.getByRole("button", { name: "保存当前文档" })).toHaveCount(0);

    await page.getByRole("button", { name: "当前工作台：工程工作区" }).click();
    await page.getByRole("menuitemradio", { name: "创作工作台" }).click();

    await expect(page.getByRole("tablist", { name: "创作导航模式" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "project.json" })).toBeVisible();
    await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("opens a creative project from the engineering workspace", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-engineering-project-switch-e2e-"));
  const initialProjectRoot = join(tempRoot, "Initial Project");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: initialProjectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
    await page.getByRole("button", { name: "当前工作台：创作工作台" }).click();
    await page.getByRole("menuitemradio", { name: "工程工作区" }).click();
    await expectEngineeringWorkspaceReady(page);

    await queueDirectorySelection(electronApp, initialProjectRoot);
    await triggerFileMenuItem(electronApp, "openCreativeProject");
    await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
    await expect(page.locator(".ns-project-title")).toHaveText("未命名长篇项目");
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function queueDirectorySelection(
  electronApp: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function triggerFileMenuItem(
  electronApp: ElectronApplication,
  commandId: string
): Promise<void> {
  await electronApp.evaluate(({ Menu }, id) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === "文件");
    const menuItem = (fileMenu?.submenu?.items ?? []).find((item) => item.id === id);
    menuItem?.click({ triggerAcceleratorIfAvailable: false } as never);
  }, commandId);
}
