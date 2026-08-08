import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import type { EngineeringWorkspaceAccessSession } from "@novel-studio/repository";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createDesktopAgentRuntime } from "../src/main/agent-run-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  );
});

describe("engineering Agent current-file context", () => {
  test("reads manual and active project files from the B6 session rather than pathname data", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-engineering-context-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "manual.md"), "PATHNAME_MANUAL_DECOY\n", "utf8");
    await writeFile(join(projectRoot, "notes", "active.md"), "PATHNAME_ACTIVE_DECOY\n", "utf8");
    const manualContent = "B6_SESSION_MANUAL_CONTEXT\n";
    const activeContent = "B6_SESSION_ACTIVE_CONTEXT\n";
    const runtime = createRuntime(
      projectRoot,
      testingSession({ "notes/manual.md": manualContent, "notes/active.md": activeContent })
    );

    const preview = await previewContext(runtime, {
      commandId: "session-context",
      contextRefs: [projectFileRef("notes/manual.md", "Manual")],
      activeResourceRef: {
        ...projectFileRef("notes/active.md", "Active"),
        expectedChecksum: sha256(activeContent)
      }
    });

    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    const contents = preview.value.blocks.map((block) => block.content).join("\n");
    expect(contents).toContain(manualContent);
    expect(contents).toContain(activeContent);
    expect(contents).not.toContain("PATHNAME_MANUAL_DECOY");
    expect(contents).not.toContain("PATHNAME_ACTIVE_DECOY");
  });

  test("fails closed when the B6 session is absent or its current-file read is unavailable", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-engineering-context-closed-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    const pathnameDecoy = "PATHNAME_CURRENT_FILE_DECOY\n";
    await writeFile(join(projectRoot, "notes", "current.md"), pathnameDecoy, "utf8");
    const activeResourceRef = {
      ...projectFileRef("notes/current.md", "Current"),
      expectedChecksum: sha256(pathnameDecoy)
    };

    const withoutSession = await previewContext(createRuntime(projectRoot), {
      commandId: "no-session",
      contextRefs: [],
      activeResourceRef
    });
    expect(withoutSession).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROJECT_FILE_NOT_FOUND" }
    });

    const unavailableSession = testingSession({}, "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE");
    const withUnavailableSession = await previewContext(
      createRuntime(projectRoot, unavailableSession),
      {
        commandId: "unavailable-session",
        contextRefs: [],
        activeResourceRef
      }
    );
    expect(withUnavailableSession).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
  });

  test("shares a nonempty dirty manual engineering buffer only for planning context", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-engineering-dirty-manual-"));
    roots.push(projectRoot);
    const savedContent = "B6_SAVED_MANUAL_CONTEXT\n";
    const dirtyContent = "B6_DIRTY_MANUAL_CONTEXT\n";
    const runtime = createRuntime(
      projectRoot,
      testingSession({ "notes/manual.md": savedContent }),
      async (relativePath) =>
        relativePath === "notes/manual.md"
          ? {
              status: "known",
              dirty: true,
              content: dirtyContent,
              rendererRevision: 17
            }
          : undefined
    );

    const preview = await previewContext(runtime, {
      commandId: "dirty-manual-planning",
      operationMode: "planning",
      contextRefs: [projectFileRef("notes/manual.md", "Manual")]
    });

    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    expect(preview.value.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refId: "editor_buffer:engineering:notes/manual.md",
          sourceKind: "editor_buffer",
          relativePath: "notes/manual.md",
          sourceRevision: 17
        })
      ])
    );
    expect(preview.value.blocks.map((block) => block.content).join("\n")).toContain(dirtyContent);
  });

  test("fails closed for dirty manual execution context and unknown or dirty active editor state", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-engineering-dirty-closed-"));
    roots.push(projectRoot);
    const savedContent = "B6_SAVED_CONTEXT\n";
    const manualDirty = await previewContext(
      createRuntime(projectRoot, testingSession({ "notes/manual.md": savedContent }), async () => ({
        status: "known",
        dirty: true,
        content: "B6_DIRTY_MANUAL\n"
      })),
      {
        commandId: "dirty-manual-execution",
        contextRefs: [projectFileRef("notes/manual.md", "Manual")]
      }
    );
    expect(manualDirty).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" }
    });

    for (const [name, state] of [
      ["unknown", { status: "unknown" as const, dirty: false, content: "" }],
      ["dirty", { status: "known" as const, dirty: true, content: "B6_DIRTY_ACTIVE\n" }]
    ] as const) {
      const activeState = await previewContext(
        createRuntime(
          projectRoot,
          testingSession({ "notes/active.md": savedContent }),
          async () => state
        ),
        {
          commandId: `active-${name}`,
          contextRefs: [],
          activeResourceRef: {
            ...projectFileRef("notes/active.md", "Active"),
            expectedChecksum: sha256(savedContent)
          }
        }
      );
      expect(activeState).toMatchObject({
        ok: false,
        error: { code: "AGENT_CONTEXT_STALE" }
      });
    }
  });
});

function createRuntime(
  projectRoot: string,
  engineeringWorkspaceAccessSession?: EngineeringWorkspaceAccessSession,
  readEditorState?: (relativePath: string) => Promise<EngineeringEditorState | undefined>
) {
  return createDesktopAgentRuntime({
    workspaceKind: "engineeringWorkspace",
    projectId: "project-01",
    contentRoot: projectRoot,
    stateRoot: projectRoot,
    ...(engineeringWorkspaceAccessSession === undefined
      ? {}
      : { engineeringWorkspaceAccessSession }),
    ...(readEditorState === undefined ? {} : { readEditorState }),
    resolveModelStartFacts: async (profileId) => ({
      profileId,
      provider: "demo",
      modelName: "engineering-context-test-model",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128000
      },
      requiredContextTokens: 8000,
      reasoningStrength: { status: "hidden" as const, reason: "test model" }
    })
  });
}

async function previewContext(
  runtime: ReturnType<typeof createDesktopAgentRuntime>,
  input: {
    readonly commandId: string;
    readonly operationMode?: "planning" | "execution" | "conversation";
    readonly contextRefs: readonly ReturnType<typeof projectFileRef>[];
    readonly activeResourceRef?: ReturnType<typeof projectFileRef> & {
      readonly expectedChecksum: string;
    };
  }
) {
  const conversation = await runtime.agentConversationSession.createConversation({
    projectId: runtime.workspaceId,
    commandId: `create-${input.commandId}-conversation`
  });
  if (!conversation.ok) return conversation;
  const draft = await runtime.agentRunDraftSession.syncStartDraft({
    projectId: runtime.workspaceId,
    conversationId: conversation.value.conversationId,
    commandId: `prepare-${input.commandId}`,
    userRequest: "Use the current engineering file.",
    operationMode: input.operationMode ?? "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    modelProfileId: `profile-${input.commandId}`,
    contextRefs: input.contextRefs,
    ...(input.activeResourceRef === undefined ? {} : { activeResourceRef: input.activeResourceRef })
  });
  if (!draft.ok) return draft;
  return runtime.agentContextSession.previewPackedContext({
    projectId: runtime.workspaceId,
    conversationId: conversation.value.conversationId,
    commandId: `preview-${input.commandId}`,
    runDraftId: draft.value.runDraft.runDraftId,
    expectedDraftRevision: draft.value.runDraft.revision,
    runDraftChecksum: draft.value.runDraft.checksum
  });
}

type EngineeringEditorState = {
  readonly status?: "known" | "unknown";
  readonly dirty: boolean;
  readonly content: string;
  readonly rendererRevision?: number;
};

function projectFileRef(relativePath: string, label: string) {
  return {
    kind: "project_file" as const,
    refId: `file:${relativePath}`,
    relativePath,
    label
  };
}

function testingSession(
  files: Readonly<Record<string, string>>,
  unavailableCode?: string
): EngineeringWorkspaceAccessSession {
  const binding = { rootBindingId: "engineering-test-root", pathPolicyRevision: "policy-test-v1" };
  return {
    binding,
    async listDirectory() {
      return ok({ entries: [] });
    },
    async readTextFile(input) {
      if (unavailableCode !== undefined) return err(testError(unavailableCode));
      const relativeIdentity =
        input !== null && typeof input === "object"
          ? (input as { readonly relativeIdentity?: unknown }).relativeIdentity
          : undefined;
      const content = typeof relativeIdentity === "string" ? files[relativeIdentity] : undefined;
      return content === undefined
        ? err(testError("ENGINEERING_TEST_FILE_NOT_FOUND"))
        : ok({
            relativeIdentity,
            content,
            byteLength: Buffer.byteLength(content, "utf8"),
            sha256: sha256(content),
            encoding: "utf-8" as const,
            bom: "none" as const,
            binding,
            refChecksum: sha256(`snapshot:${relativeIdentity}`)
          });
    },
    async searchText() {
      return ok({ matches: [], truncated: false });
    },
    async buildIndex() {
      return ok({ files: [], truncated: false });
    },
    async close() {
      return ok({ closed: true });
    }
  };
}

function testError(code: string) {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry.",
    traceId: "engineering-agent-context-native-access-test"
  });
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
