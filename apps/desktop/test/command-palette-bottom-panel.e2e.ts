import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectEngineeringWorkspaceReady,
  expectCreativeWorkspaceReady
} from "./helpers/workspace-readiness.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("opens the task panel from the command palette", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-command-palette-e2e-"));
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
    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window) => window.setContentSize(1024, 820));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024);

    const taskPanel = page.locator('[data-region="bottom-panel"]');
    await expect(taskPanel).toHaveAttribute("data-visible", "false");
    await expect(taskPanel).toBeHidden();

    await page.getByRole("button", { name: "打开命令面板" }).click();
    const palette = page.getByRole("dialog", { name: "命令面板" });
    await expect(palette).toBeVisible();
    await palette.getByRole("textbox", { name: "搜索命令" }).fill("打开任务面板");
    await palette.getByRole("button", { name: "执行命令：打开任务面板" }).click();

    await expect(taskPanel).toHaveAttribute("data-visible", "true");
    await expect(taskPanel).toBeVisible();
    await expect(page.getByLabel("底部面板内容：工作流运行")).toBeVisible();
    const taskPanelBox = await taskPanel.boundingBox();
    expect(taskPanelBox).not.toBeNull();
    expect(taskPanelBox?.height ?? 0).toBeGreaterThanOrEqual(160);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("closes an engineering workspace without the recovery gate blocking teardown", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-close-engineering-e2e-"));
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
    await expectCreativeWorkspaceReady(page, { requireWritingSurface: false });
    await page.getByRole("button", { name: "当前工作台：创作工作台" }).click();
    await page.getByRole("menuitemradio", { name: "工程工作区" }).click();
    await expectEngineeringWorkspaceReady(page);

    await page.getByRole("button", { name: "打开命令面板" }).click();
    const palette = page.getByRole("dialog", { name: "命令面板" });
    await palette.getByRole("textbox", { name: "搜索命令" }).fill("关闭当前项目/工作区");
    await palette.getByRole("button", { name: "执行命令：关闭当前项目/工作区" }).click();

    await expect(page.locator(".ns-project-title")).toHaveText("未打开项目");
    await expect(
      page.getByText("Engineering recovery has not completed for this workspace.")
    ).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
