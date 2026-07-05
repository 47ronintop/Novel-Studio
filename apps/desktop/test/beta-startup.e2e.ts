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
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const body = page.getByLabel("Chapter body");

    await expect(page.getByText("Minimal Chapter Project")).toBeVisible();
    await expect(body).toBeVisible();
    await expect(body).toHaveValue("原始章节正文。\n");

    await body.fill("安装版启动后可以编辑。\n");
    await expect(page.getByText("Unsaved").first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
