import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
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

    await page.getByLabel("项目路径").fill(projectRoot);
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: "新建章节" }).click();

    const body = page.getByLabel("章节正文");
    await expect(body).toBeVisible();
    await body.fill("Opening line.");

    await page.getByLabel("AI 写作指令").fill("Continue the active scene.");
    await page.getByRole("button", { name: "生成 AI 建议" }).click();

    await expect(page.getByText("Generated a local mock continuation for review.")).toBeVisible();
    await expect(page.getByLabel("AI 建议差异")).toContainText("AI continuation draft.");
    await expect(body).toHaveValue(/Opening line\./);
    await expect(body).not.toHaveValue(/AI continuation draft\./);

    await page.getByRole("button", { name: "应用 AI 建议" }).click();

    await expect(body).toHaveValue("Opening line.\nAI continuation draft.\n");
    await expect(page.getByText("未保存").first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
