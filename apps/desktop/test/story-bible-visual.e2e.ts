import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const screenshotRoot = join(repositoryRoot, "test-results", "story-bible-visual");

const chapterOneId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const chapterTwoId = "ch_02JZ7P9QK2R6D4W8K3A1B5C9D1";
const foreshadowId = "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const timestamp = "2026-07-31T00:00:00.000Z";

const viewports = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "compact", width: 1024, height: 900 },
  { id: "narrow", width: 720, height: 640 }
] as const;

const themes = [
  { id: "dark", buttonName: "深色主题" },
  { id: "light", buttonName: "浅色主题" },
  { id: "ink-gold", buttonName: "水墨鎏金主题" }
] as const;

test("accepts Story Bible views, themes, responsive layouts, and keyboard workflows", async () => {
  test.setTimeout(300_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-visual-"));
  const projectRoot = join(tempRoot, "Story Bible Visual");
  const provider = await startForeshadowProvider();
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await seedStoryBibleProject(projectRoot, provider.baseUrl);
  await mkdir(screenshotRoot, { recursive: true });

  const electronApp = await electron.launch({
    args: [electronMain],
    env: createElectronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    await setWindowSize(browserWindow, 1440, 900);
    await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible({ timeout: 15_000 });

    await configureLocalProvider(page, provider.baseUrl);
    await exerciseKeyboardWorkflow(page);

    for (const theme of themes) {
      await setWindowSize(browserWindow, 1440, 900);
      await selectTheme(page, theme.id, theme.buttonName);

      for (const viewport of viewports) {
        await setWindowSize(browserWindow, viewport.width, viewport.height);
        await captureStoryViews(page, `${theme.id}-${viewport.id}`);
      }
    }
  } finally {
    await electronApp.close();
    await closeServer(provider.server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function exerciseKeyboardWorkflow(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "故事资料", exact: true }).click();
  const analysisReviewTrigger = page.getByRole("button", { name: "打开资料更新建议" });
  await expect(analysisReviewTrigger).toBeVisible({ timeout: 15_000 });
  await analysisReviewTrigger.click();
  await expect(page.getByRole("heading", { name: "资料更新建议", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭资料更新建议" }).click();
  await expect(page.getByLabel("人物列表")).toBeVisible();

  const storyActivity = page
    .getByLabel("活动栏")
    .getByRole("button", { name: "故事资料", exact: true });
  await storyActivity.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("故事圣经")).toBeVisible();

  const characterCategory = page.locator('[data-story-kind="character"]');
  await characterCategory.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("人物列表")).toBeVisible();

  const characterList = page.getByLabel("人物列表");
  const listBoxBefore = await characterList.boundingBox();
  const search = page.getByLabel("搜索人物");
  await search.focus();
  await page.keyboard.insertText("林砚");
  await expect(page.locator('[data-story-entry-id="chr_hero"]')).toBeVisible();
  expect(await characterList.boundingBox()).toEqual(listBoxBefore);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");

  const characterEntry = page.locator('[data-story-entry-id="chr_hero"]');
  await characterEntry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("人物姓名")).toBeVisible();

  const characterName = page.getByLabel("人物姓名");
  await characterName.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText("林砚（修订）");
  const save = page.getByRole("button", { name: "保存设定" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("故事圣经已保存。", { exact: true })).toBeVisible();

  const back = page.getByRole("button", { name: "返回人物列表" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("人物列表")).toBeVisible();

  const foreshadowCategory = page.locator('[data-story-kind="foreshadow"]');
  await foreshadowCategory.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("伏笔列表")).toBeVisible();

  const analysisTrigger = page.getByRole("button", { name: "AI 识别伏笔" });
  await analysisTrigger.focus();
  await page.keyboard.press("Enter");
  const chapterChoice = page.getByLabel("选择章节：第一章");
  await expect(chapterChoice).toBeChecked();
  await chapterChoice.focus();
  await page.keyboard.press("Space");
  await expect(chapterChoice).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(chapterChoice).toBeChecked();

  const start = page.getByRole("button", { name: "开始识别伏笔" });
  await start.focus();
  await page.keyboard.press("Enter");
  const review = page.getByLabel("伏笔识别候选审查");
  await expect(review).toBeVisible({ timeout: 20_000 });

  const candidate = page.getByLabel("选择候选：新伏笔 雨夜旧钥匙");
  await candidate.focus();
  await page.keyboard.press("Space");
  await expect(candidate).toBeChecked();
  const preview = page.getByRole("button", { name: "预览所选伏笔变更" });
  await preview.focus();
  await page.keyboard.press("Enter");

  const confirm = page.getByRole("button", { name: "确认保存伏笔变更" });
  await expect(confirm).toBeVisible();
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已保存 1 / 1 项变更", { exact: true })).toBeVisible({
    timeout: 15_000
  });

  const close = page.getByRole("button", { name: "关闭伏笔识别" });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("伏笔列表")).toBeVisible();
}

async function configureLocalProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  const modelName = page.getByLabel("模型名称");
  if (await modelName.isVisible()) await modelName.fill("story-bible-e2e-model");
  await page.getByLabel("密钥引用").fill("local-story-bible-e2e-key");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page
      .locator(".ns-project-feedback")
      .filter({ hasText: "Connected to openai-compatible/story-bible-e2e-model." })
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}

async function captureStoryViews(page: Page, prefix: string): Promise<void> {
  await openStoryActivity(page);

  await selectStoryKind(page, "character");
  await expect(page.getByLabel("人物列表")).toBeVisible();
  await captureAndAudit(page, `${prefix}-character-list.png`);

  await selectStoryKind(page, "world");
  await expectStoryHeadingOnOneLine(page, "世界观");
  await page.getByLabel("筛选世界观类型").selectOption("world.location");
  await expect(page.locator('[data-story-entry-id="loc_harbor"]')).toBeVisible();
  await captureAndAudit(page, `${prefix}-world-filter.png`);

  await selectStoryKind(page, "outline");
  await page.locator('[data-story-entry-id="outline_main"]').click();
  await expect(page.getByLabel("大纲卷章树")).toBeVisible();
  await captureAndAudit(page, `${prefix}-outline-tree.png`);

  await selectStoryKind(page, "foreshadow");
  await expectStoryHeadingOnOneLine(page, "伏笔");
  await expect(page.getByLabel("伏笔列表")).toBeVisible();
  await captureAndAudit(page, `${prefix}-foreshadow-list.png`);
  await page.locator(`[data-story-entry-id="${foreshadowId}"]`).click();
  await expect(page.getByLabel("伏笔原文证据")).toBeVisible();
  await captureAndAudit(page, `${prefix}-foreshadow-detail.png`);

  await selectStoryKind(page, "timeline");
  await expect(
    page.getByLabel("故事圣经").getByRole("heading", { name: "时间线", exact: true })
  ).toBeVisible();
  await captureAndAudit(page, `${prefix}-timeline.png`);
}

async function openStoryActivity(page: Page): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "故事资料", exact: true }).click();
  await expect(page.getByLabel("故事圣经")).toBeVisible();
}

async function selectStoryKind(
  page: Page,
  kind: "character" | "world" | "outline" | "foreshadow" | "timeline"
): Promise<void> {
  const responsiveSwitch = page.getByLabel("切换故事资料分类");
  if (await responsiveSwitch.isVisible()) {
    await responsiveSwitch.selectOption(kind);
  } else {
    await page.locator(`[data-story-kind="${kind}"]`).click();
  }
}

async function selectTheme(
  page: Page,
  theme: (typeof themes)[number]["id"],
  buttonName: string
): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await page.locator(".model-settings-category-list").getByText("外观", { exact: true }).click();
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await expect(page.locator(".ns-shell")).toHaveAttribute("data-theme", theme);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}

async function expectStoryHeadingOnOneLine(page: Page, title: string): Promise<void> {
  const heading = page.getByRole("heading", { name: title, exact: true });
  await expect(heading).toBeVisible();
  const metrics = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight)
    };
  });
  expect(metrics.height, `${title} should not collapse into a vertical title`).toBeLessThanOrEqual(
    metrics.lineHeight * 1.5
  );
}

async function captureAndAudit(page: Page, fileName: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".ns-workspace-grid");
    const editor = document.querySelector<HTMLElement>(".ns-editor-area");
    const surface = document.querySelector<HTMLElement>(".ns-story-editor, .ns-timeline-view");
    if (grid === null || editor === null || surface === null) return ["missing acceptance surface"];

    const problems: string[] = [];
    for (const [name, element] of [
      ["document", document.documentElement],
      ["workspace", grid],
      ["editor", editor],
      ["surface", surface]
    ] as const) {
      if (element.scrollWidth > element.clientWidth + 1) {
        problems.push(
          `${name} horizontally overflows (${element.scrollWidth}/${element.clientWidth})`
        );
      }
    }

    const gridBox = grid.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    if (
      Math.abs(editorBox.top - gridBox.top) > 1 ||
      Math.abs(editorBox.bottom - gridBox.bottom) > 1
    ) {
      problems.push(
        `editor does not fill workspace height (${Math.round(editorBox.top)}/${Math.round(editorBox.bottom)} vs ${Math.round(gridBox.top)}/${Math.round(gridBox.bottom)})`
      );
    }

    const navigator = grid.querySelector<HTMLElement>(".ns-navigator, .ns-navigator-context");
    if (
      window.innerWidth <= 1279 &&
      grid.dataset.agentConversation === "true" &&
      navigator !== null &&
      getComputedStyle(navigator).display !== "none"
    ) {
      problems.push("project navigator remains visible after its compact grid area is removed");
    }

    const visibleElements = Array.from(
      surface.querySelectorAll<HTMLElement>("button, input, select, textarea, h1, h2")
    ).filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0;
    });
    for (const element of visibleElements) {
      const box = element.getBoundingClientRect();
      if (box.left < editorBox.left - 1 || box.right > editorBox.right + 1) {
        problems.push(
          `${element.tagName.toLowerCase()} escapes editor bounds (${Math.round(box.left)}/${Math.round(box.right)})`
        );
      }
    }

    for (const button of visibleElements.filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && element.textContent?.trim().length === 0
    )) {
      if ((button.getAttribute("aria-label") ?? "").trim().length === 0) {
        problems.push("icon button is missing an accessible name");
      }
      if ((button.getAttribute("title") ?? "").trim().length === 0) {
        problems.push(
          `icon button ${button.getAttribute("aria-label") ?? "unknown"} is missing a tooltip`
        );
      }
    }

    for (const status of surface.querySelectorAll<HTMLElement>(
      ".ns-story-list-status, .ns-foreshadow-tracking-status"
    )) {
      if (getComputedStyle(status).display !== "none" && status.innerText.trim().length === 0) {
        problems.push("visible status relies on color alone");
      }
    }

    const overlapGroups = [
      surface.querySelector<HTMLElement>(".ns-story-editor-header"),
      surface.querySelector<HTMLElement>(".ns-story-title-group")
    ].filter((element): element is HTMLElement => element !== null);
    for (const group of overlapGroups) {
      const children = Array.from(group.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter((child) => {
          const box = child.getBoundingClientRect();
          return getComputedStyle(child).display !== "none" && box.width > 0 && box.height > 0;
        });
      for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
          const left = children[leftIndex]?.getBoundingClientRect();
          const right = children[rightIndex]?.getBoundingClientRect();
          if (left === undefined || right === undefined) continue;
          const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
          const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
          if (overlapWidth > 1 && overlapHeight > 1) problems.push("header controls overlap");
        }
      }
    }

    return problems;
  });
  expect(violations, fileName).toEqual([]);

  const screenshotPath = join(screenshotRoot, fileName);
  await page.screenshot({ path: screenshotPath });
  expect((await stat(screenshotPath)).size).toBeGreaterThan(0);
}

async function setWindowSize(
  browserWindow: Awaited<ReturnType<ElectronApplication["browserWindow"]>>,
  width: number,
  height: number
): Promise<void> {
  await browserWindow.evaluate((window, size) => window.setContentSize(size.width, size.height), {
    width,
    height
  });
  await expect
    .poll(() => browserWindow.evaluate((window) => window.getContentSize()))
    .toEqual([width, height]);
}

async function seedStoryBibleProject(projectRoot: string, baseUrl: string): Promise<void> {
  const settingsPath = join(projectRoot, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    models: {
      defaultProfileId: string;
      profiles: Array<Record<string, unknown>>;
    };
  };
  settings.models.profiles[0] = {
    ...settings.models.profiles[0],
    baseUrl,
    apiKeyRef: "secret://model_default/api_key",
    modelName: "story-bible-e2e-model",
    contextWindow: 128_000
  };
  await writeJson(settingsPath, settings);

  await mkdir(join(projectRoot, "chapters"), { recursive: true });
  await writeFile(
    join(projectRoot, "chapters", `${chapterTwoId}.md`),
    [
      "---",
      'schemaVersion: "1.0"',
      `id: "${chapterTwoId}"`,
      'type: "chapter"',
      'title: "第二章"',
      "order: 2",
      'status: "draft"',
      `createdAt: "${timestamp}"`,
      `updatedAt: "${timestamp}"`,
      "---",
      "",
      "旧钥匙打开了港口档案室的暗门。",
      ""
    ].join("\n"),
    "utf8"
  );

  for (const directory of ["characters", "world", "outline", "foreshadows", "timeline"]) {
    await mkdir(join(projectRoot, directory), { recursive: true });
  }

  await writeJson(join(projectRoot, "characters", "chr_hero.json"), {
    ...assetBase("chr_hero", "character", "林砚", "调查旧港失踪案的记者。"),
    aliases: ["阿砚"],
    details: {
      role: "调查记者",
      goals: ["查清旧港真相", "摆脱家族阴影"],
      conflicts: ["证人与档案相互矛盾"],
      arc: { start: "只相信书面证据", end: "学会相信同行者", turningPoints: ["目睹暗门开启"] },
      appearanceChapterIds: [chapterOneId, chapterTwoId]
    },
    relatedEntityIds: ["loc_harbor"]
  });

  const worldAssets = [
    {
      id: "loc_harbor",
      type: "world.location",
      title: "雾港",
      summary: "潮汐与旧档案共同塑造的港城。",
      details: { geography: "三面临海", atmosphere: "常年薄雾", sensoryAnchors: ["盐味", "汽笛"] }
    },
    {
      id: "fac_archive",
      type: "world.faction",
      title: "港务档案局",
      summary: "掌握旧港航运记录的保守机构。",
      details: { purpose: "维护航运档案", structure: "局长与三处科室", resources: ["封存卷宗"] }
    },
    {
      id: "rule_tide",
      type: "world.rule",
      title: "回声潮规则",
      summary: "每逢大潮，旧建筑会重现短暂声响。",
      details: {
        rule: "声音只重现一次",
        cost: "倾听者会失去当日一段记忆",
        exception: "退潮前离开不受影响"
      }
    },
    {
      id: "term_echo",
      type: "world.glossary",
      title: "回声潮",
      summary: "雾港居民对异常潮汐的通称。",
      details: { definition: "携带旧日声音的潮汐", usage: "地方口语", aliases: ["旧潮"] }
    }
  ];
  for (const asset of worldAssets) {
    await writeJson(join(projectRoot, "world", `${asset.id}.json`), {
      ...assetBase(asset.id, asset.type, asset.title, asset.summary),
      details: asset.details
    });
  }

  await writeJson(join(projectRoot, "outline", "outline.json"), {
    ...assetBase("outline_main", "outline", "旧港谜案主线", "两卷完成调查、推进与回收。"),
    details: {
      volumes: [
        {
          id: "vol_arrival",
          title: "第一卷：雾中来客",
          summary: "林砚抵达雾港并发现旧钥匙。",
          chapterIds: [chapterOneId]
        },
        {
          id: "vol_archive",
          title: "第二卷：暗门档案",
          summary: "钥匙打开暗门，旧案进入回收阶段。",
          chapterIds: [chapterTwoId]
        }
      ],
      chapterOutlines: [
        {
          chapterId: chapterOneId,
          goal: "发现旧钥匙",
          conflict: "线人失约",
          notes: "结尾留下潮声"
        },
        { chapterId: chapterTwoId, goal: "打开暗门", conflict: "档案局阻拦", notes: "确认钥匙来源" }
      ]
    }
  });

  const evidence = "他把生锈的钥匙收进袖口。";
  await writeJson(join(projectRoot, "foreshadows", `${foreshadowId}.json`), {
    ...assetBase(foreshadowId, "foreshadow", "袖口里的旧钥匙", "钥匙将在档案室暗门处完成回收。"),
    details: {
      trackingStatus: "ready-to-payoff",
      plantedChapterId: chapterOneId,
      plannedPayoffChapterId: chapterTwoId,
      sourceRefs: [
        {
          chapterId: chapterOneId,
          excerpt: evidence,
          excerptHash: createHash("sha256").update(evidence, "utf8").digest("hex")
        }
      ],
      origin: "manual",
      notes: "第二章暗门场景需要明确回收。"
    },
    relatedEntityIds: ["chr_hero", "loc_harbor"]
  });

  await writeJson(join(projectRoot, "timeline", "events.json"), {
    ...assetBase(
      "timeline_main",
      "timeline.events",
      "旧港事件线",
      "调查按照抵达、发现与开启推进。"
    ),
    details: {
      events: [
        {
          id: "evt_arrival",
          sequence: 10,
          title: "林砚抵达雾港",
          status: "active",
          timeLabel: "第一日清晨",
          summary: "林砚在码头与线人失联。",
          chapterIds: [chapterOneId],
          characterIds: ["chr_hero"],
          locationIds: ["loc_harbor"],
          causes: [],
          effects: ["evt_archive"]
        },
        {
          id: "evt_archive",
          sequence: 20,
          title: "暗门开启",
          status: "draft",
          timeLabel: "第二日午夜",
          summary: "旧钥匙打开档案室暗门。",
          chapterIds: [chapterTwoId],
          characterIds: ["chr_hero"],
          locationIds: ["loc_harbor"],
          causes: ["evt_arrival"],
          effects: []
        }
      ]
    }
  });
}

function assetBase(id: string, type: string, title: string, summary: string) {
  return {
    schemaVersion: "1.0",
    id,
    type,
    title,
    status: "active",
    summary,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function startForeshadowProvider(): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ data: [{ id: "story-bible-e2e-model", context_window: 128_000 }] })
      );
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    if (isConnectionProbe(body)) {
      sendConnectionProbe(response);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                candidates: [
                  {
                    kind: "new",
                    evidence: { chapterId: chapterOneId, excerpt: "原始章节正文。" },
                    reason: "旧钥匙被单独强调，适合作为后续暗门的线索。",
                    suggested: {
                      title: "雨夜旧钥匙",
                      summary: "钥匙将在港口档案室揭示用途。",
                      trackingStatus: "planted",
                      plantedChapterId: chapterOneId,
                      plannedPayoffChapterId: chapterTwoId,
                      notes: "与暗门事件呼应。",
                      relatedEntityIds: ["chr_hero", "loc_harbor"]
                    }
                  }
                ]
              })
            }
          }
        ],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address for the local Story Bible provider.");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, server };
}

function isConnectionProbe(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
  return body["stream"] === true && messages.some(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      !Array.isArray(message) &&
      (message as Record<string, unknown>)["role"] === "user" &&
      (message as Record<string, unknown>)["content"] === "ping"
  );
}

function sendConnectionProbe(response: import("node:http").ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function createElectronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}
