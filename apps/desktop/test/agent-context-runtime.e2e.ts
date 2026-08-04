import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const projectId = "prj_minimal_chapter";

test("surfaces draft-backed context controls and round-trips a reference through real IPC", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-context-e2e-"));
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, {
        data: [
          {
            id: "gpt-5.6-luna",
            context_window: 128000
          },
          {
            id: "gpt-5.6-sol",
            context_window: 128000
          }
        ]
      });
      return;
    }
    json(response, {
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });

  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await queueDirectorySelection(electronApp, projectRoot);
    await openAgentPanel(page);
    await configureLocalModel(page, baseUrl);
    const composer = page.getByLabel("会话输入区");

    // The draft loaded through the real preload→main→application→repository path, so the composer
    // surfaces its server-authoritative model and reasoning controls in one compact menu.
    const modelTrigger = composer.getByLabel(/^模型与推理：/);
    await expect(modelTrigger).toBeVisible();
    await modelTrigger.click();
    const modelMenu = page.getByRole("dialog", { name: "选择模型与推理强度" });
    await modelMenu.locator('[data-model-menu="model"]').click();
    const modelOptions = page.getByRole("listbox", { name: "模型", exact: true });
    await expect(modelOptions).toBeVisible();
    const lunaOption = modelOptions.getByRole("button", { name: /gpt-5\.6-luna/ });
    const solOption = modelOptions.getByRole("button", { name: /gpt-5\.6-sol/ });
    await expect(lunaOption).toBeVisible();
    await expect(solOption).toBeVisible();
    await solOption.click();
    await expect(modelTrigger).toHaveAccessibleName("模型与推理：gpt-5.6-sol · 中");

    await modelTrigger.click();
    await modelMenu.locator('[data-model-menu="reasoning"]').click();
    const reasoningOptions = page.getByRole("listbox", {
      name: "推理强度",
      exact: true
    });
    await expect(reasoningOptions.locator("[data-reasoning-option]")).toHaveText([
      "低",
      "中",
      "高",
      "最大",
      "超高"
    ]);
    await reasoningOptions.getByRole("button", { name: "最大", exact: true }).click();
    await expect(modelTrigger).toHaveAccessibleName("模型与推理：gpt-5.6-sol · 最大");

    await modelTrigger.click();
    await modelMenu.locator('[data-model-menu="model"]').click();
    await modelOptions.getByRole("button", { name: /gpt-5\.6-luna/ }).click();
    await expect(modelTrigger).toHaveAccessibleName("模型与推理：gpt-5.6-luna · 中");

    await modelTrigger.click();
    await modelMenu.locator('[data-model-menu="reasoning"]').click();
    await expect(reasoningOptions).toBeVisible();
    await expect(reasoningOptions.locator("[data-reasoning-option]")).toHaveText([
      "低",
      "中",
      "高"
    ]);
    await expect(reasoningOptions.locator('[data-reasoning-option="max"]')).toHaveCount(0);
    await expect(reasoningOptions.locator('[data-reasoning-option="ultra"]')).toHaveCount(0);
    await reasoningOptions.getByRole("button", { name: "高", exact: true }).click();
    await expect(modelTrigger).toHaveAccessibleName("模型与推理：gpt-5.6-luna · 高");

    await selectOperationMode(page, composer, "execution");
    await composer.getByLabel("添加引用与执行审批").click();
    const addMenu = page.getByRole("dialog", { name: "添加引用与执行审批" });
    await expect(addMenu.getByRole("radio", { name: "请求批准" })).toBeVisible();
    await expect(addMenu.getByRole("radio", { name: "替我审批" })).toBeVisible();
    await addMenu.press("Escape");

    const conversationId = await selectedConversationId(page);

    // Read the persisted draft through IPC; loadDraft already initialized it for this conversation.
    const draft = await readRunDraft(page, conversationId);
    expect(draft.runDraft.modelProfileId).toEqual(expect.any(String));
    expect(draft.runDraft.modelName).toBe("gpt-5.6-luna");
    expect(draft.runDraft.reasoningEffort).toBe("high");
    const contextDraftId = draft.contextDraft.contextDraftId;
    const modelProfileId = draft.runDraft.modelProfileId;

    // The explicit window leaves room for C4's provider-specific tool and system reserves.
    const budget = await previewBudget(page, conversationId, draft.runDraft);
    expect(budget.contextWindow).toBe(128000);
    expect(budget.contextWindowSemantics).toBe("shared_input_output_window");

    // Adding a context reference round-trips through updateContextDraft and persists a new revision.
    const added = await addProjectFileRef(
      page,
      conversationId,
      contextDraftId,
      draft.contextDraft.revision
    );
    expect(added.contextDraft.refs.some((ref) => ref.refId === "file:notes/e2e-context.md")).toBe(
      true
    );
    // The run draft was re-pointed at the new context revision (checksum stays consistent).
    expect(added.runDraft.contextDraftRevision).toBe(added.contextDraft.revision);
    expect(added.runDraft.modelProfileId).toBe(modelProfileId);

    // Reloading the draft returns the persisted post-mutation state (recovery after reopen).
    const reloaded = await readRunDraft(page, conversationId);
    expect(
      reloaded.contextDraft.refs.some((ref) => ref.refId === "file:notes/e2e-context.md")
    ).toBe(true);
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sends profile-specific conventions and outlines in real workspace provider payloads", async () => {
  test.setTimeout(180_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-workspace-context-e2e-"));
  const canonicalTempRoot = await realpath(tempRoot);
  const engineeringRoot = join(tempRoot, "Engineering Workspace");
  const creativeRoot = join(tempRoot, "Creative Project");
  const modelRequests: Record<string, unknown>[] = [];

  await mkdir(join(engineeringRoot, "src"), { recursive: true });
  await writeFile(join(engineeringRoot, "src", "main.ts"), "export {};\n", "utf8");

  await cp(fixtureRoot, creativeRoot, { recursive: true });
  await mkdir(join(creativeRoot, "conventions"), { recursive: true });
  await mkdir(join(creativeRoot, "notes"), { recursive: true });
  await mkdir(join(creativeRoot, "characters"), { recursive: true });
  await writeFile(
    join(creativeRoot, "conventions", "writing.md"),
    "CREATIVE_E2E_CONVENTION",
    "utf8"
  );
  await writeFile(join(creativeRoot, "notes", "brief.md"), "Creative user file body.\n", "utf8");
  await writeFile(
    join(creativeRoot, ".novel-studio", "internal-e2e.md"),
    "INTERNAL_FILE_SHOULD_NOT_APPEAR_IN_CREATIVE_OUTLINE\n",
    "utf8"
  );
  await writeFile(
    join(creativeRoot, "chapters", "ch_outline_e2e.md"),
    [
      "---",
      'schemaVersion: "1.0"',
      "id: ch_outline_e2e",
      "type: chapter",
      "title: Outline Chapter",
      "order: 1",
      "status: draft",
      "wordCount: 321",
      'createdAt: "2026-01-01T00:00:00.000Z"',
      'updatedAt: "2026-01-01T00:00:00.000Z"',
      "---",
      "WRITING_CHAPTER_BODY_SECRET"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(creativeRoot, "characters", "asset-outline-e2e.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id: "asset-outline-e2e",
      type: "character",
      title: "Outline Character",
      aliases: ["The Cartographer"],
      status: "active",
      summary: "WRITING_STORY_BIBLE_BODY_SECRET",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }),
    "utf8"
  );

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, {
        data: [
          {
            id: "gpt-5.6-luna",
            context_window: 128_000,
            capabilities: {
              streaming: true,
              tool_calling: true,
              structured_arguments: true
            }
          }
        ]
      });
      return;
    }

    const body = await readJsonBody(request);
    if (request.method !== "POST" || body["stream"] !== true) {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }

    modelRequests.push(body);
    const userRequest = lastUserRequest(body);
    if (userRequest === "CREATIVE_GENERAL_CONTEXT_E2E_REQUEST") {
      sendTextCompletion(response, `Completed ${userRequest}`);
      return;
    }
    sendToolCall(response, `finish-${String(modelRequests.length)}`, "finish", {
      summary: `Completed ${userRequest}`
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  let engineeringApp: ElectronApplication | undefined;
  let creativeApp: ElectronApplication | undefined;
  try {
    engineeringApp = await electron.launch({
      args: [electronMain],
      env: unboundElectronEnv({
        NOVEL_STUDIO_USER_DATA_ROOT: join(canonicalTempRoot, "Engineering User Data")
      })
    });
    let page = await engineeringApp.firstWindow();
    await queueDirectorySelection(engineeringApp, engineeringRoot);
    await openQueuedEngineeringWorkspace(page);
    await chooseWorkspaceModelSharing(page);
    await ensureAgentConversation(page);
    await configureLocalModel(page, baseUrl);
    const sourceTrigger = page.getByLabel("会话输入区").getByTitle("查看上下文");
    await sourceTrigger.click();
    const sourcePanel = page.getByRole("dialog", { name: "上下文用量" });
    await sourcePanel.getByRole("button", { name: "创建约定文件" }).click();
    await expect(sourcePanel).toContainText("已创建");
    expect(await readFile(join(engineeringRoot, "AGENTS.md"), "utf8")).toBe(
      "# Project conventions\n\n"
    );
    await writeFile(join(engineeringRoot, "AGENTS.md"), "ENGINEERING_E2E_CONVENTION", "utf8");
    await sourcePanel.press("Escape");
    const engineeringRequest = "ENGINEERING_CONTEXT_E2E_REQUEST";
    await selectOperationMode(page, page.getByLabel("会话输入区"), "execution");
    await sendProviderRequest(page, engineeringRequest);
    await expect
      .poll(() => matchingProviderRequests(modelRequests, engineeringRequest).length)
      .toBe(1);
    await expect(page.getByText(`Completed ${engineeringRequest}`, { exact: true })).toBeVisible();

    const engineeringPayload = providerRequestFor(modelRequests, engineeringRequest);
    const engineeringPrefix = expectWorkspaceProjectPrefix(engineeringPayload, {
      conventionMarker: "ENGINEERING_E2E_CONVENTION",
      outlineMarker: 'file "src/main.ts"',
      userRequest: engineeringRequest
    });
    expect(engineeringPrefix.outline.data).toContain("Workspace outline (engineering).");
    await expectWorkspaceSourcePanel(page, {
      conventionsLabel: "AGENTS.md",
      outlineLabel: "Workspace outline (engineering)"
    });

    await engineeringApp.close();
    engineeringApp = undefined;

    creativeApp = await electron.launch({
      args: [electronMain],
      env: unboundElectronEnv({
        NOVEL_STUDIO_USER_DATA_ROOT: join(canonicalTempRoot, "Creative User Data")
      })
    });
    page = await creativeApp.firstWindow();
    await queueDirectorySelection(creativeApp, creativeRoot);
    await openAgentPanel(page);
    await chooseWorkspaceModelSharing(page);
    await configureLocalModel(page, baseUrl);
    const creativeSourceTrigger = page.getByLabel("会话输入区").getByTitle("查看上下文");
    await creativeSourceTrigger.click();
    const creativeSourcePanel = page.getByRole("dialog", { name: "上下文用量" });
    await creativeSourcePanel.getByRole("button", { name: "创建约定文件" }).click();
    await expect(creativeSourcePanel).toContainText("已存在");
    expect(await readFile(join(creativeRoot, "conventions", "writing.md"), "utf8")).toBe(
      "CREATIVE_E2E_CONVENTION"
    );
    await creativeSourcePanel.press("Escape");

    const writingComposer = page.getByLabel("会话输入区");
    await writingComposer
      .getByLabel("Agent 请求")
      .fill("Ask The Cartographer to verify the route.");
    const suggestedReferences = writingComposer.getByLabel("建议引用");
    await expect(suggestedReferences).toContainText("Outline Character");
    await expect(writingComposer.getByLabel("已选引用")).not.toContainText("Outline Character");
    const providerRequestCountBeforeSuggestion = modelRequests.length;
    await suggestedReferences
      .locator('[data-suggested-reference="story_bible:asset-outline-e2e"]')
      .click();
    await expect(writingComposer.getByLabel("已选引用")).toContainText("Outline Character");
    expect(modelRequests).toHaveLength(providerRequestCountBeforeSuggestion);

    const writingRequest = "WRITING_CONTEXT_E2E_REQUEST";
    await selectOperationMode(page, page.getByLabel("会话输入区"), "execution");
    await sendProviderRequest(page, writingRequest);
    await expect.poll(() => matchingProviderRequests(modelRequests, writingRequest).length).toBe(1);
    await expect(page.getByText(`Completed ${writingRequest}`, { exact: true })).toBeVisible();

    const writingPayload = providerRequestFor(modelRequests, writingRequest);
    const writingPrefix = expectWorkspaceProjectPrefix(writingPayload, {
      conventionMarker: "CREATIVE_E2E_CONVENTION",
      outlineMarker: 'chapter id="ch_outline_e2e"',
      userRequest: writingRequest
    });
    expect(writingPrefix.outline.data).toContain('title="Outline Chapter"');
    expect(writingPrefix.outline.data).toContain("wordCount=321");
    expect(writingPrefix.outline.data).toContain('story_bible_asset id="asset-outline-e2e"');
    expect(writingPrefix.outline.data).toContain('title="Outline Character"');
    expect(writingPrefix.outline.data).toContain('type="character"');
    expect(writingPrefix.outline.data).not.toContain("WRITING_CHAPTER_BODY_SECRET");
    expect(writingPrefix.outline.data).not.toContain("WRITING_STORY_BIBLE_BODY_SECRET");

    const navigator = page.getByRole("navigation", { name: "项目导航" });
    const modeTabs = page.getByRole("tablist", { name: "创作导航模式" });
    await modeTabs.getByRole("tab", { name: "项目文件" }).click();
    const notesToggle = navigator.getByRole("button", { name: "展开目录：notes" });
    await expect(notesToggle).toBeVisible();
    if ((await notesToggle.getAttribute("aria-expanded")) !== "true") await notesToggle.click();
    await navigator.getByRole("button", { name: "打开文件：brief.md" }).click();
    await expect(page.getByRole("region", { name: "普通文件编辑器" })).toBeVisible();
    await page.getByRole("button", { name: "新建会话" }).first().click();
    await expect(page.getByLabel("会话输入区")).toBeVisible();

    const creativeRequest = "CREATIVE_GENERAL_CONTEXT_E2E_REQUEST";
    await selectOperationMode(page, page.getByLabel("会话输入区"), "execution");
    await sendProviderRequest(page, creativeRequest);
    await expect
      .poll(() => matchingProviderRequests(modelRequests, creativeRequest).length)
      .toBe(1);
    await expect(page.getByText(`Completed ${creativeRequest}`, { exact: true })).toBeVisible();

    const creativePayload = providerRequestFor(modelRequests, creativeRequest);
    const creativePrefix = expectWorkspaceProjectPrefix(creativePayload, {
      conventionMarker: "CREATIVE_E2E_CONVENTION",
      outlineMarker: 'file "notes/brief.md"',
      userRequest: creativeRequest
    });
    expect(creativePrefix.outline.data).toContain("Workspace outline (creative_general).");
    expect(creativePrefix.outline.data).not.toContain("chapters/ch_outline_e2e.md");
    expect(creativePrefix.outline.data).not.toContain(".novel-studio/internal-e2e.md");
  } finally {
    await engineeringApp?.close();
    await creativeApp?.close();
    await closeServer(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

interface RunDraftView {
  readonly runDraft: {
    readonly runDraftId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly modelProfileId: string;
    readonly modelName?: string;
    readonly reasoningEffort?: string;
    readonly contextDraftRevision: number;
  };
  readonly contextDraft: {
    readonly contextDraftId: string;
    readonly revision: number;
    readonly refs: readonly { readonly refId: string }[];
  };
}

async function selectedConversationId(page: Page): Promise<string> {
  const conversationId = await page.evaluate(async (boundProjectId) => {
    const listed = await window.novelStudio?.agentConversations.list({
      projectId: boundProjectId,
      includeArchived: false,
      limit: 30
    });
    return listed?.ok === true ? listed.value.items[0]?.conversationId : undefined;
  }, projectId);
  if (conversationId === undefined) throw new Error("Expected a selected conversation");
  return conversationId;
}

async function readRunDraft(page: Page, conversationId: string): Promise<RunDraftView> {
  const result = await page.evaluate(
    async ({ boundProjectId, boundConversationId }) =>
      window.novelStudio?.agentRuns.readRunDraft({
        projectId: boundProjectId,
        conversationId: boundConversationId,
        // The renderer already initialized the draft; these defaults are ignored when one exists.
        initialize: {
          modelProfileId: "profile-e2e-placeholder",
          operationMode: "planning",
          contextMode: "writing",
          writePolicy: "write_before_confirmation"
        }
      }),
    { boundProjectId: projectId, boundConversationId: conversationId }
  );
  if (result?.ok !== true) throw new Error("readRunDraft failed");
  return result.value as unknown as RunDraftView;
}

async function previewBudget(
  page: Page,
  conversationId: string,
  runDraft: RunDraftView["runDraft"]
): Promise<{ contextWindow: number; contextWindowSemantics: string }> {
  const result = await page.evaluate(
    async ({ boundProjectId, boundConversationId, draftId, revision, checksum }) =>
      window.novelStudio?.agentRuns.previewContextBudget({
        projectId: boundProjectId,
        conversationId: boundConversationId,
        commandId: `preview_${Date.now().toString(36)}`,
        runDraftId: draftId,
        expectedDraftRevision: revision,
        runDraftChecksum: checksum
      }),
    {
      boundProjectId: projectId,
      boundConversationId: conversationId,
      draftId: runDraft.runDraftId,
      revision: runDraft.revision,
      checksum: runDraft.checksum
    }
  );
  if (result?.ok !== true) throw new Error("previewContextBudget failed");
  return result.value as unknown as { contextWindow: number; contextWindowSemantics: string };
}

async function addProjectFileRef(
  page: Page,
  conversationId: string,
  contextDraftId: string,
  expectedDraftRevision: number
): Promise<RunDraftView> {
  const result = await page.evaluate(
    async ({ boundProjectId, boundConversationId, draftId, revision }) =>
      window.novelStudio?.agentRuns.updateContextDraft({
        projectId: boundProjectId,
        conversationId: boundConversationId,
        commandId: `add_ref_${Date.now().toString(36)}`,
        contextDraftId: draftId,
        expectedDraftRevision: revision,
        mutation: {
          kind: "add_ref",
          ref: {
            kind: "project_file",
            refId: "file:notes/e2e-context.md",
            relativePath: "notes/e2e-context.md",
            label: "e2e-context.md"
          }
        }
      }),
    {
      boundProjectId: projectId,
      boundConversationId: conversationId,
      draftId: contextDraftId,
      revision: expectedDraftRevision
    }
  );
  if (result?.ok !== true) throw new Error("updateContextDraft add_ref failed");
  return result.value as unknown as RunDraftView;
}

async function openAgentPanel(page: Page): Promise<void> {
  const unbound = page.getByLabel("Agent 未绑定工作区");
  const view = page.getByLabel("Agent 会话主视图");
  await expect
    .poll(async () => (await unbound.isVisible()) || (await view.isVisible()), { timeout: 15_000 })
    .toBe(true);
  const workspaceKind = await page.evaluate(
    async () => (await window.novelStudio?.getShellState())?.workspaceContext.kind
  );
  if (workspaceKind === "none") {
    const opened = await page.evaluate(async () => {
      const selected = await window.novelStudio?.project.chooseOpenCreativeDirectory();
      if (selected?.ok !== true || selected.value.selectionId === undefined) return selected;
      return window.novelStudio?.project.openCreativeProject(selected.value.selectionId);
    });
    if (opened?.ok !== true) {
      throw new Error(`Creative project activation failed: ${JSON.stringify(opened)}`);
    }
    await page.reload();
  }
  await ensureAgentConversation(page);
}

async function openQueuedEngineeringWorkspace(page: Page): Promise<void> {
  const opened = await page.evaluate(async () => {
    const selected = await window.novelStudio?.workspace.chooseEngineeringDirectory();
    if (selected?.ok !== true || selected.value.selectionId === undefined) return selected;
    return window.novelStudio?.workspace.openEngineeringWorkspace(selected.value.selectionId);
  });
  if (opened?.ok !== true) {
    throw new Error(`Engineering workspace activation failed: ${JSON.stringify(opened)}`);
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "当前工作台：工程工作台" })).toBeVisible({
    timeout: 15_000
  });
}

async function ensureAgentConversation(page: Page): Promise<void> {
  await expect(page.getByLabel("Agent 会话主视图")).toBeVisible({ timeout: 15_000 });
  const createConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await createConversation.isVisible()) await createConversation.click();
  await expect(page.getByLabel("会话输入区")).toBeVisible();
}

async function queueDirectorySelection(
  electronApp: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("gpt-5.6-luna");
  await page.getByLabel("密钥引用").fill("local-context-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator('.ns-project-feedback[role="status"]')).toHaveText(
    "Connected to openai-compatible/gpt-5.6-luna."
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

async function selectOperationMode(
  page: Page,
  composer: ReturnType<Page["getByLabel"]>,
  mode: "planning" | "execution"
): Promise<void> {
  const expected = mode === "planning" ? "计划" : "执行";
  const trigger = composer.getByTitle("选择计划或执行模式");
  if ((await trigger.getAttribute("aria-label")) === expected) return;
  await trigger.click();
  await page.getByLabel("计划或执行模式").getByRole("button", { name: expected }).click();
}

async function sendProviderRequest(page: Page, request: string): Promise<void> {
  const composer = page.getByLabel("会话输入区");
  await composer.getByLabel("Agent 请求").fill(request);
  await composer.getByRole("button", { name: "启动 Agent 运行" }).click();
  await expect(
    page
      .getByLabel("Agent 会话主视图")
      .locator('.ns-agent-conversation-user-message[data-speaker="user"]')
      .filter({ hasText: request })
  ).toBeVisible();
  await composer.getByTitle("查看上下文").click();
  await page.getByRole("tab", { name: "实际发送预览" }).click();
  await expect(page.getByLabel("实际发送预览")).toBeVisible();
  await composer.getByRole("button", { name: "启动 Agent 运行" }).click();
}

async function chooseWorkspaceModelSharing(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as {
      novelStudio?: {
        workspace?: {
          updateContextPolicy?: (update: unknown) => Promise<{ readonly ok: boolean }>;
        };
      };
    }).novelStudio;
    return api?.workspace?.updateContextPolicy?.({
      action: "set_sharing_defaults",
      defaults: {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "allow",
        toolReadResults: "allow"
      }
    });
  });
  expect(result).toMatchObject({ ok: true });
}

interface ProviderMessage {
  readonly index: number;
  readonly role: string;
  readonly content: string;
}

interface ProviderProjectDataSource {
  readonly index: number;
  readonly message: ProviderMessage;
  readonly data: string;
}

function matchingProviderRequests(
  requests: readonly Record<string, unknown>[],
  userRequest: string
): readonly Record<string, unknown>[] {
  return requests.filter((request) => lastUserRequest(request) === userRequest);
}

function providerRequestFor(
  requests: readonly Record<string, unknown>[],
  userRequest: string
): Record<string, unknown> {
  const matching = matchingProviderRequests(requests, userRequest);
  if (matching.length !== 1) {
    throw new Error(
      `Expected exactly one provider request for ${userRequest}, received ${matching.length}.`
    );
  }
  return matching[0];
}

function expectWorkspaceProjectPrefix(
  request: Record<string, unknown>,
  input: {
    readonly conventionMarker: string;
    readonly outlineMarker: string;
    readonly userRequest: string;
  }
): {
  readonly conventions: ProviderProjectDataSource;
  readonly outline: ProviderProjectDataSource;
} {
  const messages = providerMessages(request);
  const conventions = projectDataSource(messages, "project_conventions");
  const outline = projectDataSource(messages, "workspace_outline");
  const requestMessage = messages.find((message) => message.content === input.userRequest);
  if (requestMessage === undefined) {
    throw new Error(`The provider payload did not contain user request ${input.userRequest}.`);
  }

  for (const source of [conventions, outline]) {
    expect(source.message.role).toBe("user");
    expect(source.index).toBeLessThan(requestMessage.index);
  }
  expect(conventions.index).toBeLessThan(outline.index);
  expect(conventions.data).toContain(input.conventionMarker);
  expect(outline.data).toContain(input.outlineMarker);

  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  expect(systemMessages).not.toContain(input.conventionMarker);
  expect(systemMessages).not.toContain(input.outlineMarker);

  return { conventions, outline };
}

function providerMessages(request: Record<string, unknown>): readonly ProviderMessage[] {
  const rawMessages = request["messages"];
  if (!Array.isArray(rawMessages)) throw new Error("Expected provider payload messages.");
  return rawMessages.map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value["role"] !== "string" ||
      typeof value["content"] !== "string"
    ) {
      throw new Error(`Expected a string provider message at index ${index}.`);
    }
    return { index, role: value["role"], content: value["content"] };
  });
}

function projectDataSource(
  messages: readonly ProviderMessage[],
  expectedSourceKind: "project_conventions" | "workspace_outline"
): ProviderProjectDataSource {
  const matching = messages.flatMap((message) => {
    const payload = parseJsonObject(message.content);
    const source = payload === undefined ? undefined : payload["source"];
    if (
      payload?.["kind"] !== "untrusted_project_data" ||
      !isRecord(source) ||
      source["sourceKind"] !== expectedSourceKind ||
      typeof payload["data"] !== "string"
    ) {
      return [];
    }
    return [{ index: message.index, message, data: payload["data"] }];
  });
  if (matching.length !== 1) {
    throw new Error(
      `Expected one ${expectedSourceKind} data message, received ${matching.length}.`
    );
  }
  return matching[0];
}

async function expectWorkspaceSourcePanel(
  page: Page,
  input: { readonly conventionsLabel: string; readonly outlineLabel: string }
): Promise<void> {
  const trigger = page.getByLabel("会话输入区").getByTitle("查看上下文");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "上下文用量" });
  await panel.getByRole("tab", { name: "来源" }).click();
  const sources = panel.getByLabel("上下文来源");
  await expect(sources).toContainText(input.conventionsLabel);
  await expect(sources).toContainText(input.outlineLabel);
  await expect(sources).toContainText("project_conventions");
  await expect(sources).toContainText("workspace_outline");
  await expect(sources).toContainText("约定层");
  await expect(sources).toContainText("工作区定向块");
  await expect(sources).toContainText("受信任工作区");
  await expect(sources).toContainText("内容仅作为数据");
  await expect(sources).toContainText("tokens");
  await panel.press("Escape");
}

function unboundElectronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = electronEnv(overrides);
  delete env["NOVEL_STUDIO_PROJECT_ROOT"];
  return env;
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  );
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return isRecord(parsed) ? parsed : {};
}

function lastUserRequest(request: Record<string, unknown>): string {
  const messages = providerMessages(request);
  return (
    messages
      .filter((message) => message.role === "user")
      .findLast(
        (message) =>
          typeof parseJsonObject(message.content)?.["instructionPolicy"] !== "string"
      )?.content ?? ""
  );
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  args: Record<string, unknown>
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}

function sendTextCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}
