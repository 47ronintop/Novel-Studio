import { expect, type Page } from "@playwright/test";

const WORKSPACE_READY_TIMEOUT = 60_000;

export async function expectCreativeWorkspaceReady(
  page: Page,
  options: { readonly requireWritingSurface?: boolean; readonly timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? WORKSPACE_READY_TIMEOUT;

  await expect(page.getByRole("dialog", { name: "新建创作项目" })).toHaveCount(0, { timeout });
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const state = await window.novelStudio?.getShellState();
          return state === undefined
            ? "unavailable"
            : `${state.workspaceContext.kind}:${state.workbenchMode}`;
        }),
      { timeout, intervals: [100, 250, 500] }
    )
    .toBe("creativeProject:creative");

  await expect(page.getByRole("button", { name: "当前工作台：创作工作台" })).toBeVisible({
    timeout
  });
  await expect(page.getByLabel("活动栏").getByRole("button", { name: "工作区" })).toHaveAttribute(
    "aria-current",
    "page",
    { timeout }
  );

  const navigator = page.getByRole("navigation", { name: "项目导航" });
  await expect(navigator).toBeVisible({ timeout });
  const modeTabs = page.getByRole("tablist", { name: "创作导航模式" });
  await expect(modeTabs).toBeVisible({ timeout });

  const writingTab = modeTabs.getByRole("tab", { name: "写作" });
  await expect(writingTab).toBeEnabled({ timeout });
  if (options.requireWritingSurface !== false) {
    if ((await writingTab.getAttribute("aria-selected")) !== "true") {
      await writingTab.click();
    }
    await expect(writingTab).toHaveAttribute("aria-selected", "true", { timeout });
    const createChapter = navigator.getByRole("button", { name: "新建章节" });
    await expect(createChapter).toBeVisible({ timeout });
    await expect(createChapter).toBeEnabled({ timeout });
  }
}

export async function selectCreativeWorkbench(page: Page, timeout = WORKSPACE_READY_TIMEOUT) {
  const creativeTrigger = page.getByRole("button", { name: "当前工作台：创作工作台" });
  if (!(await creativeTrigger.isVisible().catch(() => false))) {
    const trigger = page.getByRole("button", { name: /^当前工作台：/u });
    await expect(trigger).toBeVisible({ timeout });
    await trigger.click();
    const creativeOption = page.getByRole("menuitemradio", { name: "创作工作台" });
    await expect(creativeOption).toBeEnabled({ timeout });
    await creativeOption.click();
  }
  await expect(creativeTrigger).toBeVisible({ timeout });
}

export async function expectEngineeringWorkspaceReady(
  page: Page,
  timeout = WORKSPACE_READY_TIMEOUT
): Promise<void> {
  await expect
    .poll(
      async () => {
        const ready = page.getByRole("button", { name: "当前工作台：工程工作区" });
        if (await ready.isVisible().catch(() => false)) return "ready";
        const error = page.locator('.ns-project-feedback[data-kind="error"]');
        if (await error.isVisible().catch(() => false)) {
          return `error:${await error.innerText()}`;
        }
        return "pending";
      },
      { timeout, intervals: [100, 250, 500] }
    )
    .toBe("ready");
  await expect(page.getByRole("navigation", { name: "工程资源管理器" })).toBeVisible({ timeout });
}
