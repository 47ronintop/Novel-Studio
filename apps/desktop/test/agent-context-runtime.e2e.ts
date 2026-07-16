import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const electronMain = join(repositoryRoot, "apps", "desktop", "dist", "main", "index.js");
const projectId = "prj_minimal_chapter";

test("surfaces draft-backed context controls and round-trips a reference through real IPC", async () => {
  test.setTimeout(90_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-context-e2e-"));
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, { data: [{ id: "local-agent", context_window: 128000 }] });
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

  const electronApp = await electron.launch({
    args: [electronMain],
    env: electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: join(tempRoot, "Default Project"),
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  });

  try {
    const page = await electronApp.firstWindow();
    await configureLocalModel(page, baseUrl);
    await openAgentPanel(page);
    const composer = page.getByLabel("会话输入区");

    // The draft loaded through the real preload→main→application→repository path, so the composer
    // surfaces its server-authoritative model selector and the quiet context-status control.
    await expect(composer.getByLabel(/^模型：/)).toBeVisible();
    await expect(composer.locator(".ns-agent-context-trigger")).toBeVisible();

    const conversationId = await selectedConversationId(page);

    // Read the persisted draft through IPC; loadDraft already initialized it for this conversation.
    const draft = await readRunDraft(page, conversationId);
    expect(draft.runDraft.modelProfileId).toEqual(expect.any(String));
    const contextDraftId = draft.contextDraft.contextDraftId;
    const modelProfileId = draft.runDraft.modelProfileId;

    // A budget preview resolves the model facts server-side (context window from /v1/models).
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
    expect(reloaded.contextDraft.refs.some((ref) => ref.refId === "file:notes/e2e-context.md")).toBe(
      true
    );
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

interface RunDraftView {
  readonly runDraft: {
    readonly runDraftId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly modelProfileId: string;
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
  await page.getByLabel("活动栏").getByRole("button", { name: "AI 工作流" }).click();
  const createConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await createConversation.isVisible()) await createConversation.click();
  await expect(page.getByLabel("会话输入区")).toBeVisible();
}

async function configureLocalModel(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("活动栏").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByLabel("模型 Base URL").fill(baseUrl);
  await page.getByLabel("模型名称").fill("local-agent");
  await page.getByLabel("密钥引用").fill("local-context-e2e-key");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("模型配置已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator(".ns-project-feedback")).toContainText(
    "Connected to openai-compatible/local-agent"
  );
  await page.getByRole("button", { name: "关闭设置" }).click();
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
