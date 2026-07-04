import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("generates an AI writing suggestion and applies it only after confirmation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-ai-e2e-"));
  const projectRoot = join(tempRoot, "AI Workflow Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(repositoryRoot, "fixtures", "projects", "minimal-chapter")
    }
  });

  try {
    const page = await electronApp.firstWindow();

    await page.getByLabel("Project path").fill(projectRoot);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("button", { name: "Create chapter" }).click();

    const body = page.getByLabel("Chapter body");
    await expect(body).toBeVisible();
    await body.fill("Opening line.");

    await page.getByLabel("AI writing instruction").fill("Continue the active scene.");
    await page.getByRole("button", { name: "Generate AI suggestion" }).click();

    await expect(page.getByText("Generated a local mock continuation for review.")).toBeVisible();
    await expect(page.getByLabel("AI suggestion diff")).toContainText("AI continuation draft.");
    await expect(body).toHaveValue(/Opening line\./);
    await expect(body).not.toHaveValue(/AI continuation draft\./);

    await page.getByRole("button", { name: "Apply AI suggestion" }).click();

    await expect(body).toHaveValue("Opening line.\nAI continuation draft.\n");
    await expect(page.getByText("Unsaved").first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
