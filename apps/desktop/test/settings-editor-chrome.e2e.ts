import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const screenshotRoot = join(repositoryRoot, "test-results", "settings-editor-chrome");

test("accepts settings and editor chrome across desktop and narrow Electron windows", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-chrome-e2e-"));
  await mkdir(screenshotRoot, { recursive: true });
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
    await browserWindow.evaluate((window) => window.setSize(1440, 900));
    await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible();

    const documentTabs = page.getByRole("tablist", { name: "文档标签" });
    const editorPanes = page.locator(".ns-editor-panes");
    const editorSurface = page.locator(".ns-editor-surface");
    await expect(documentTabs.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "查找替换", exact: true })).toHaveCount(0);
    await expectElementContrast(documentTabs.getByRole("tab").first());
    await expectEditorFillsSurface(page);
    await capture(page, "desktop-workspace.png");

    const panesTopBefore = (await editorPanes.boundingBox())?.y;
    await page.getByLabel("章节正文").locator(".cm-content").press("ControlOrMeta+H");
    const overlay = page.getByRole("region", { name: "查找替换", exact: true });
    await expect(overlay).toBeVisible();
    await expectInside(overlay, editorSurface);
    expect((await editorPanes.boundingBox())?.y).toBe(panesTopBefore);
    await capture(page, "desktop-replace-overlay.png");
    await page.keyboard.press("Escape");

    const semanticBefore = await readSemanticTokens(page);
    await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    // Chrome regions stay mounted even during settings mode (VS Code-style architecture).
    await expect(page.locator('[data-region="editor-area"]')).toHaveCount(1);
    await expect(page.locator('[data-region="ai-panel"]')).toHaveCount(1);
    await expect(page.locator('[data-region="status-bar"]')).toHaveCount(1);
    await capture(page, "desktop-settings.png");

    await page
      .locator(".model-settings-category-list")
      .getByText("外观", { exact: true })
      .click();
    await page.getByRole("button", { name: "浅色主题" }).click();
    const blueAccent = page.getByRole("button", { name: "强调色 蓝色" });
    await blueAccent.click();
    const shell = page.locator(".ns-shell");
    await expect(shell).toHaveAttribute("data-theme", "light");
    await expect(shell).toHaveAttribute("data-accent", "blue");
    const semanticAfter = await readSemanticTokens(page);
    expect(semanticAfter).toHaveLength(semanticBefore.length);
    expect(semanticAfter.every((token) => token.length > 0)).toBe(true);
    await expectFunctionalContrast(page);
    await expectElementContrast(page.locator('.model-settings-category-item[aria-current="page"]'));
    await blueAccent.focus();
    await expect(blueAccent).toBeFocused();
    await expectElementContrast(blueAccent);
    const swatchColors = await page.locator(".model-settings-swatch").evaluateAll((swatches) =>
      swatches.map((swatch) => getComputedStyle(swatch).backgroundColor)
    );
    expect(new Set(swatchColors).size).toBe(3);
    expect(swatchColors.every((color) => color !== "rgba(0, 0, 0, 0)")).toBe(true);
    await capture(page, "desktop-light-blue.png");

    await page.getByRole("button", { name: "关闭设置" }).click();
    await browserWindow.evaluate((window) => window.setSize(760, 720));
    expect(await browserWindow.evaluate((window) => window.getSize()[0])).toBe(760);
    await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible();
    await expectEditorFillsSurface(page);
    await page.getByRole("button", { name: "查找当前文档" }).click();
    await expect(overlay).toBeVisible();
    await expectInside(page.getByRole("tab", { name: "第一章.md" }), page.locator(".ns-editor-area"));
    await expectInside(overlay, editorSurface);
    await capture(page, "narrow-workspace.png");
    await page.keyboard.press("Escape");

    await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
    const categoryList = page.locator(".model-settings-category-list");
    const settingsMain = page.locator(".model-settings-main");
    await expect(categoryList).toBeVisible();
    expect((await categoryList.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    expect((await settingsMain.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    const categoryButtons = await categoryList.getByRole("listitem").all();
    const firstCategoryBox = await categoryButtons[0]?.boundingBox();
    const secondCategoryBox = await categoryButtons[1]?.boundingBox();
    expect(firstCategoryBox?.y).toBe(secondCategoryBox?.y);
    await capture(page, "narrow-settings.png");

    for (const fileName of [
      "desktop-workspace.png",
      "desktop-replace-overlay.png",
      "desktop-settings.png",
      "desktop-light-blue.png",
      "narrow-workspace.png",
      "narrow-settings.png"
    ]) {
      expect((await stat(join(screenshotRoot, fileName))).size).toBeGreaterThan(0);
    }
  } finally {
    await electronApp.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function capture(page: Page, fileName: string): Promise<void> {
  await page.screenshot({ path: join(screenshotRoot, fileName), fullPage: true });
}

async function expectInside(child: Locator, parent: Locator): Promise<void> {
  const childBox = await child.boundingBox();
  const parentBox = await parent.boundingBox();
  expect(childBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  if (childBox === null || parentBox === null) {
    return;
  }

  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height + 1);
}

async function expectEditorFillsSurface(page: Page): Promise<void> {
  const surfaceBox = await page.locator(".ns-editor-surface").boundingBox();
  const bodyBox = await page.locator(".ns-editor-body").boundingBox();
  const mountBox = await page.locator(".ns-editor-codemirror").boundingBox();
  const editorBox = await page.locator(".ns-editor-codemirror .cm-editor").boundingBox();
  const panelsBox = await page.locator(".ns-editor-panels").boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(mountBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(panelsBox).not.toBeNull();
  if (
    surfaceBox === null ||
    bodyBox === null ||
    mountBox === null ||
    editorBox === null ||
    panelsBox === null
  ) {
    return;
  }

  const surfaceBottom = surfaceBox.y + surfaceBox.height;
  const bodyBottom = bodyBox.y + bodyBox.height;
  const metrics = JSON.stringify({ surfaceBox, bodyBox, mountBox, editorBox, panelsBox });
  expect(panelsBox.y - bodyBottom, metrics).toBeLessThanOrEqual(9);
  expect(Math.abs(panelsBox.y + panelsBox.height - surfaceBottom), metrics).toBeLessThanOrEqual(2);
  expect(Math.abs(mountBox.y + mountBox.height - bodyBottom), metrics).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.y + editorBox.height - bodyBottom), metrics).toBeLessThanOrEqual(2);
  expect(bodyBox.height / surfaceBox.height, metrics).toBeGreaterThan(0.85);
}

async function readSemanticTokens(page: Page): Promise<readonly string[]> {
  return page.locator(".ns-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return ["--ns-danger", "--ns-warning", "--ns-success", "--ns-info"].map((token) =>
      style.getPropertyValue(token).trim()
    );
  });
}

async function expectFunctionalContrast(page: Page): Promise<void> {
  const colors = await page.locator(".ns-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    const resolve = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      background: resolve(style.getPropertyValue("--ns-bg")),
      ink: resolve(style.getPropertyValue("--ns-ink")),
      muted: resolve(style.getPropertyValue("--ns-muted")),
      raised: resolve(style.getPropertyValue("--ns-surface-raised"))
    };
  });

  expect(contrastRatio(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.ink, colors.raised)).toBeGreaterThanOrEqual(4.5);
}

async function expectElementContrast(element: Locator): Promise<void> {
  const colors = await element.evaluate((node) => {
    const foreground = getComputedStyle(node).color;
    let backgroundNode: Element | null = node;
    let background = "";
    while (backgroundNode !== null) {
      const candidate = getComputedStyle(backgroundNode).backgroundColor;
      if (candidate !== "rgba(0, 0, 0, 0)") {
        background = candidate;
        break;
      }
      backgroundNode = backgroundNode.parentElement;
    }
    return { background, foreground };
  });

  expect(colors.background).not.toBe("");
  expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  if (color.startsWith("oklch(")) {
    const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (values === undefined || values.length !== 3) {
      throw new Error(`Expected an OKLCH color, received: ${color}`);
    }

    const [lightness = 0, chroma = 0, hue = 0] = values;
    const hueRadians = (hue * Math.PI) / 180;
    const a = chroma * Math.cos(hueRadians);
    const b = chroma * Math.sin(hueRadians);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linearRed = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const linearGreen = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const linearBlue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return (
      0.2126 * clampChannel(linearRed) +
      0.7152 * clampChannel(linearGreen) +
      0.0722 * clampChannel(linearBlue)
    );
  }

  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received: ${color}`);
  }

  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function clampChannel(channel: number): number {
  return Math.max(0, Math.min(1, channel));
}
