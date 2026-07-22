import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("starts with an editable bootstrapped beta project when no source fixtures are available", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-beta-startup-"));
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(projectRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const body = page.getByLabel("章节正文").locator(".cm-content");

    await expect(page.locator(".ns-project-title")).toHaveText("未命名长篇项目");
    await expect(page.getByText("尚未打开工作区")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建会话" }).first()).toBeEnabled();
    await expect(body).toBeVisible();
    await expect(body).toContainText("这是第一章的正文。你可以直接开始写作。");

    await body.fill("安装版启动后可以编辑。\n");
    await expect(page.getByRole("button", { name: "保存当前文档" })).toBeEnabled();
  } finally {
    await electronApp.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
