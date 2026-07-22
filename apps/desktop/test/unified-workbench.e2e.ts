import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
    await expect(workbenchTrigger).toBeVisible();
    const projectStatusBox = await page.locator(".ns-project-status").boundingBox();
    const workbenchBox = await workbenchTrigger.boundingBox();
    expect(projectStatusBox).not.toBeNull();
    expect(workbenchBox).not.toBeNull();
    if (projectStatusBox !== null && workbenchBox !== null) {
      expect(workbenchBox.x - (projectStatusBox.x + projectStatusBox.width)).toBeGreaterThanOrEqual(
        24
      );
    }

    await workbenchTrigger.click();
    await page.getByRole("menuitemradio", { name: "工程工作台" }).click();

    await expect(page.getByRole("navigation", { name: "工程资源管理器" })).toBeVisible();
    await expect(page.getByRole("button", { name: "当前工作台：工程工作台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "搜索" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创作系统" })).toHaveCount(0);

    const projectFile = page.locator('button[aria-label^="打开文件：project.json"]');
    await expect(projectFile).toBeVisible();
    await projectFile.click();
    await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
    await expect(page.getByText(/只读：由 Novel Studio 管理的资产/)).toBeVisible();
    await expect(page.getByRole("button", { name: "保存当前文档" })).toHaveCount(0);

    await page.getByRole("button", { name: "当前工作台：工程工作台" }).click();
    await page.getByRole("menuitemradio", { name: "创作工作台" }).click();

    await expect(page.getByRole("tablist", { name: "创作导航模式" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "project.json" })).toBeVisible();
    await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
