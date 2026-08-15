import { expect, test, _electron as electron, type Locator } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectCreativeWorkspaceReady } from "./helpers/workspace-readiness.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const screenshotRoot = join(repositoryRoot, "test-results", "conversation-panel-layout");

test("cycles the conversation panel and adapts expanded content", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-conversation-layout-e2e-"));
  await mkdir(screenshotRoot, { recursive: true });
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const electronApp = await electron.launch({
    args: [electronMain],
    env: {
      ...env,
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(1440, 900));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1400);
    await expectCreativeWorkspaceReady(page);

    const grid = page.locator(".ns-workspace-grid");
    const editor = page.locator('[data-region="editor-area"]');
    const conversationPanel = page.getByLabel("AI 对话面板");
    const resizeHandle = page.getByLabel("AI panel resize handle");
    await expect(page.getByLabel("Agent 会话主视图")).toBeVisible();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "docked");
    await expect(editor).toBeVisible();
    await expect(conversationPanel).toBeVisible();
    await expect(resizeHandle).toBeVisible();
    const dockedPanelBox = await requiredBox(conversationPanel);
    const dockedEditorBox = await requiredBox(editor);
    expect(dockedPanelBox.width).toBeLessThan(dockedEditorBox.width);
    await page.screenshot({ path: join(screenshotRoot, "docked-before.png") });

    await expect(page.getByRole("button", { name: "展开会话面板" })).toBeVisible();
    await page.getByRole("button", { name: "展开会话面板" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "expanded");
    await expect(editor).toBeHidden();
    await page.getByRole("button", { name: "恢复停靠会话面板布局" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "docked");

    await page.getByRole("button", { name: "收起会话面板并展开布局" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "collapsed");
    await expect(conversationPanel).toBeHidden();
    await expect(resizeHandle).toHaveCount(0);
    await expect(editor).toBeVisible();

    await page.getByRole("button", { name: "恢复会话面板并展开布局" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "docked");
    await expect(conversationPanel).toBeVisible();
    await expect(editor).toBeVisible();

    await page.getByRole("button", { name: "选择会话面板布局" }).click();
    await page.getByRole("menuitemradio", { name: "展开" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "expanded");
    await expect(editor).toBeHidden();
    await expect(editor).toHaveCount(1);
    await expect(conversationPanel).toBeVisible();
    await expect(resizeHandle).toHaveCount(1);
    await expect(resizeHandle).toBeHidden();
    const expandedPanelBox = await requiredBox(conversationPanel);
    expect(expandedPanelBox.width).toBeGreaterThan(dockedPanelBox.width * 2);
    await assertViewportContainment(page);
    await page.screenshot({ path: join(screenshotRoot, "expanded-after.png") });

    const transcript = page.locator(
      ".ns-agent-conversation-turns, .ns-agent-conversation-turns-empty"
    );
    const composerSurface = page.locator(
      ".ns-agent-conversation-composer .ns-agent-composer-surface"
    );
    await expect(transcript).toBeVisible();
    await expect(composerSurface).toBeVisible();
    const transcriptBox = await requiredBox(transcript);
    const composerBox = await requiredBox(composerSurface);
    const modelBox = await requiredBox(page.getByLabel(/^模型与推理：/));
    const sendBox = await requiredBox(
      page.getByRole("button", { name: /启动 Agent 运行|停止 Agent 运行/ })
    );
    expect(transcriptBox.width).toBeLessThanOrEqual(901);
    expect(composerBox.width).toBeLessThanOrEqual(961);
    expect(sendBox.x - (modelBox.x + modelBox.width)).toBeGreaterThanOrEqual(2);
    expect(sendBox.x - (modelBox.x + modelBox.width)).toBeLessThanOrEqual(6);
    expectCentered(transcriptBox, expandedPanelBox);
    expectCentered(composerBox, expandedPanelBox);

    await page.getByRole("button", { name: "历史会话" }).click();
    const drawer = page.getByRole("dialog", { name: "历史会话抽屉" });
    const drawerContent = drawer.locator(".ns-agent-history-drawer-content");
    await expect(drawer).toBeVisible();
    const drawerBox = await requiredBox(drawerContent);
    expect(drawerBox.width).toBeGreaterThanOrEqual(320);
    expect(drawerBox.width).toBeLessThanOrEqual(400);
    expect(
      Math.abs(drawerBox.x + drawerBox.width - (expandedPanelBox.x + expandedPanelBox.width))
    ).toBe(0);
    await drawer.getByRole("button", { name: "关闭历史会话" }).click();

    await page.getByRole("button", { name: "恢复停靠会话面板布局" }).click();
    await expect(grid).toHaveAttribute("data-conversation-panel-mode", "docked");
    await expect(editor).toBeVisible();
    await expect(conversationPanel).toBeVisible();
    await expect(resizeHandle).toBeVisible();
    const restoredPanelBox = await requiredBox(conversationPanel);
    expect(Math.abs(restoredPanelBox.width - dockedPanelBox.width)).toBeLessThanOrEqual(1);
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a visible element with a bounding box");
  return box;
}

function expectCentered(
  child: { readonly x: number; readonly width: number },
  parent: { readonly x: number; readonly width: number }
): void {
  const childCenter = child.x + child.width / 2;
  const parentCenter = parent.x + parent.width / 2;
  expect(Math.abs(childCenter - parentCenter)).toBeLessThanOrEqual(2);
}

async function assertViewportContainment(page: import("@playwright/test").Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".ns-shell")?.getBoundingClientRect();
    const status = document
      .querySelector<HTMLElement>('[data-region="status-bar"]')
      ?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      shellBottom: shell === undefined ? undefined : shell.bottom,
      statusBottom: status === undefined ? undefined : status.bottom
    };
  });
  expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.shellBottom ?? 0).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.statusBottom ?? 0).toBeLessThanOrEqual(metrics.viewportHeight + 1);
}
