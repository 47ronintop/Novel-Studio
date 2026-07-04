import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");

test("creates a project, creates a chapter, edits it, and saves through Electron", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-e2e-"));
  const projectRoot = join(tempRoot, "Project Smoke");
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NOVEL_STUDIO_PROJECT_ROOT: join(repositoryRoot, "fixtures", "projects", "minimal-chapter")
    }
  });

  try {
    const page = await electronApp.firstWindow();

    await expect(page.getByLabel("Project Navigator")).toBeVisible();

    await page.getByLabel("Project path").fill(projectRoot);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page.getByText("Project Smoke")).toBeVisible();

    await page.getByRole("button", { name: "Create chapter" }).click();
    await expect(page.getByRole("button", { name: /Untitled Chapter 1/ })).toBeVisible();

    const body = page.getByLabel("Chapter body");
    await expect(body).toBeVisible();
    await body.fill("E2E opening line.");

    await expect(page.getByText("Unsaved").first()).toBeVisible();
    await page.getByRole("button", { name: "Save chapter" }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();

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
