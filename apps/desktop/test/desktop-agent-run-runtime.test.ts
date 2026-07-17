import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectLockFileRepository } from "@novel-studio/repository";

import * as runtimeExports from "../src/main/agent-run-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
});

describe("desktop Agent Run runtime", () => {
  test("binds strict Conversation and Run persistence to the selected project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-conversation-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
    await writeFile(
      join(projectRoot, "chapters", `${chapterId}.md`),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-14T00:00:00.000Z"\nupdatedAt: "2026-07-14T00:00:00.000Z"\n---\n\nChapter body.\n`,
      "utf8"
    );
    const runtime = runtimeExports.createDesktopAgentRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      createRunId: () => "run-strict-conversation"
    });

    const created = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-strict-conversation"
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const conversationId = created.value.conversationId;
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand(conversationId, "start-strict-conversation")
      )
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-strict-conversation")).toMatchObject({
        ok: true,
        value: { snapshot: { conversationId, status: "plan_ready" } }
      });
    });
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "conversations", conversationId, "conversation.json"),
          "utf8"
        )
      )
    ).toMatchObject({ projectId: "project-01", conversationId });
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "agent-runs", "run-strict-conversation", "run.json"),
          "utf8"
        )
      )
    ).toMatchObject({ projectId: "project-01", conversationId });

    const archived = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-archived-conversation"
    });
    expect(archived).toMatchObject({ ok: true });
    if (!archived.ok) return;
    expect(
      await runtime.agentConversationSession.archiveConversation({
        projectId: "project-01",
        conversationId: archived.value.conversationId,
        commandId: "archive-strict-conversation",
        expectedConversationRevision: archived.value.revision
      })
    ).toMatchObject({ ok: true, value: { status: "archived" } });
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand(archived.value.conversationId, "start-archived-conversation")
      )
    ).toMatchObject({ ok: false });
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand("conversation-missing", "start-missing-conversation")
      )
    ).toMatchObject({ ok: false });
  });

  test("treats a saved active editor as disk context during draft preflight", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-saved-editor-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D2";
    const relativePath = `chapters/${chapterId}.md`;
    const body = "Original saved chapter body.\n";
    await writeFile(
      join(projectRoot, relativePath),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Saved editor\norder: 1\nstatus: draft\ncreatedAt: "2026-07-17T00:00:00.000Z"\nupdatedAt: "2026-07-17T00:00:00.000Z"\n---\n\n${body}`,
      "utf8"
    );
    let round = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      createRunId: () => "run-saved-editor-preflight",
      readEditorBuffer: async (refId) =>
        refId === `chapter:${chapterId}` ? body : undefined,
      readEditorState: async (path) =>
        path === relativePath ? { dirty: false, content: body } : undefined,
      resolveModelStartFacts: async () => ({
        profileId: "profile-saved-editor",
        provider: "demo",
        modelName: "saved-editor-model",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: { status: "hidden", reason: "test model" }
      }),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-saved-editor", "propose_chapter_write", {
              chapterId,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-saved-editor", "finish", { summary: "Finished." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-saved-editor-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-saved-editor-run",
      userRequest: "Revise the saved active chapter.",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-saved-editor",
      contextRefs: [
        {
          kind: "chapter",
          refId: `chapter:${chapterId}`,
          chapterId,
          label: "Saved editor"
        }
      ]
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;

    const started = await runtime.agentRunSession.startAgentRun({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "start-saved-editor-run",
      expectedRunRevision: 0,
      runDraftId: prepared.value.runDraft.runDraftId,
      runDraftRevision: prepared.value.runDraft.revision,
      runDraftChecksum: prepared.value.runDraft.checksum
    });
    expect(started).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun("run-saved-editor-preflight");
      expect(read).not.toMatchObject({
        value: {
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                message: "Save and refresh the dirty editor target before creating a Change Set."
              })
            })
          ])
        }
      });
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: { files: [{ relativePath }] }
        }
      });
    });
  });

  test("injects and indexes persisted context from earlier runs in the same conversation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-context-"));
    roots.push(projectRoot);
    const runIds = ["run-context-first", "run-context-second"];
    const roundMessages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
    let round = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: "chapter-unused",
      createRunId: () => runIds.shift() ?? "run-context-extra",
      modelDriver: {
        async *streamRound(input: {
          readonly messages: readonly { readonly role: string; readonly content: string }[];
        }) {
          round += 1;
          roundMessages.push(input.messages);
          yield { type: "assistant_text_delta", delta: `Answer ${String(round)}` };
          yield runtimeToolCall(`finish-context-${String(round)}`, "finish", {
            summary: `Context summary ${String(round)}`
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const created = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-context-conversation"
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: created.value.conversationId,
      commandId: "start-context-first",
      userRequest: "Remember the lantern clue."
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-context-first")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: created.value.conversationId,
      commandId: "start-context-second",
      userRequest: "Continue from the clue."
    });
    await vi.waitFor(() => expect(roundMessages).toHaveLength(2), { timeout: 5_000 });

    expect(roundMessages[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Untrusted conversation context")
        })
      ])
    );
    expect(roundMessages[1]?.map((message) => message.content).join("\n")).toContain(
      "Remember the lantern clue."
    );

    const searched = await runtime.agentConversationSession.searchConversations({
      projectId: "project-01",
      query: "lantern"
    });
    expect(searched).toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ conversationId: created.value.conversationId })] }
    });
  });

  test("stages a chapter proposal using the exact content and checksum returned by read_chapter", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-read-propose-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D2";
    const body = "Original chapter body.\n";
    await writeFile(
      join(projectRoot, "chapters", `${chapterId}.md`),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`,
      "utf8"
    );
    let round = 0;
    const session = createDesktopRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      createRunId: () => "run-desktop-read-propose",
      modelDriver: {
        async *streamRound(input: {
          messages: readonly { readonly role: string; readonly content: string }[];
        }) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("read-before-proposal", "read_chapter", { chapterId });
          } else if (round === 2) {
            const toolMessage = input.messages.findLast((message) => message.role === "tool");
            if (toolMessage === undefined) throw new Error("Expected read_chapter tool output.");
            const envelope = JSON.parse(toolMessage.content) as {
              data: { content: string; checksum: string };
            };
            expect(envelope.data.content).toBe(body);
            expect(envelope.data.checksum).toBe(sha256(body));
            yield runtimeToolCall("proposal-from-read", "propose_chapter_write", {
              chapterId,
              baseHash: envelope.data.checksum,
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-after-proposal", "finish", { summary: "Unexpected." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-read-propose")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
    });
  });

  test("uses project-root-bound real reads and finishes a read-only planning run", async () => {
    const createRuntime = (runtimeExports as unknown as Record<string, unknown>)[
      "createDesktopAgentRunSession"
    ];
    expect(typeof createRuntime).toBe("function");
    if (typeof createRuntime !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-run-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D3";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\nChapter body.\n`;
    await writeFile(chapterPath, original, "utf8");

    const session = (
      createRuntime as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      createRunId: () => "run-desktop-plan"
    });
    await session.startAgentRun({
      projectId: "project-01",
      conversationId: "conv-desktop-plan",
      commandId: "start-desktop-plan",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "检查章节并制定修订计划。",
      providerCapabilitySnapshot: {
        profileId: "demo-agent",
        provider: "demo",
        modelName: "desktop-scripted-agent",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128000,
        requiredContextTokens: 8000
      }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-plan")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "plan_ready" },
          events: expect.arrayContaining([
            expect.objectContaining({ type: "assistant_text_delta" }),
            expect.objectContaining({
              type: "tool_completed",
              detail: expect.objectContaining({ toolName: "list_project_entries" })
            }),
            expect.objectContaining({
              type: "tool_completed",
              detail: expect.objectContaining({ toolName: "read_chapter" })
            }),
            expect.objectContaining({ type: "plan_ready" })
          ])
        }
      });
    });
    expect(await readFile(chapterPath, "utf8")).toBe(original);
    await vi.waitFor(async () => {
      expect(
        JSON.parse(
          await readFile(
            join(projectRoot, "history", "agent-runs", "run-desktop-plan", "run.json"),
            "utf8"
          )
        )
      ).toMatchObject({ runId: "run-desktop-plan", status: "plan_ready" });
    });
  });

  test("stages a chapter-body proposal without writing, then applies it through one Version Group", async () => {
    const createRuntime = (runtimeExports as unknown as Record<string, unknown>)[
      "createDesktopAgentRunSession"
    ];
    expect(typeof createRuntime).toBe("function");
    if (typeof createRuntime !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-write-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const body = "Original chapter body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-write-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    const operations: string[] = [];
    let recoveryGroup: Record<string, unknown> | undefined;
    let round = 0;
    const session = (
      createRuntime as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-write",
      pauseAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`pause:${relativePaths.join(",")}`);
        expect(await readFile(chapterPath, "utf8")).toBe(original);
      },
      resumeAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`resume:${relativePaths.join(",")}`);
      },
      syncSavedEditor: async (relativePath: string) => {
        operations.push(`sync:${relativePath}`);
        expect(await readFile(chapterPath, "utf8")).toContain("Revised chapter body.");
        throw new Error("dirty editor became visible during synchronization");
      },
      surfaceTransactionRecoveryReview: async (group: Record<string, unknown>) => {
        operations.push("recovery-review");
        recoveryGroup = group;
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-01", "propose_chapter_write", {
              chapterId,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-01", "finish", { summary: "Applied and verified." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-write");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = (
        read as { value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> } }
      ).value;
      awaitingRevision = value.snapshot.runRevision;
      changeSet = value.changeSet;
    });
    expect(await readFile(chapterPath, "utf8")).toBe(original);
    if (changeSet === undefined) throw new Error("Expected a staged Change Set.");

    await session.decideChangeSet({
      runId: "run-desktop-write",
      projectId: "project-01",
      commandId: "apply-desktop-write",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-write")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const applied = await readFile(chapterPath, "utf8");
    expect(applied).toContain(`id: ${chapterId}`);
    expect(applied).toContain("Revised chapter body.");
    expect(await readdir(join(projectRoot, "history", "agent-transactions"))).toHaveLength(1);
    expect(operations).toEqual([
      `pause:chapters/${chapterId}.md`,
      `sync:chapters/${chapterId}.md`,
      `resume:chapters/${chapterId}.md`,
      "recovery-review"
    ]);
    expect(recoveryGroup).toMatchObject({
      transactionStatus: "applied",
      synchronization: {
        status: "recovery_required",
        failedHooks: ["syncSavedEditor"]
      }
    });
  });

  test("preserves dirty buffers and resumes autosave when the target changes before apply", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-conflict-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const body = "Original chapter body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-conflict-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    const operations: string[] = [];
    let round = 0;
    const session = createDesktopRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-conflict",
      pauseAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`pause:${relativePaths.join(",")}`);
      },
      preserveDirtyBuffers: async (relativePaths: readonly string[]) => {
        operations.push(`preserve:${relativePaths.join(",")}`);
      },
      resumeAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`resume:${relativePaths.join(",")}`);
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-conflict", "propose_chapter_write", {
              chapterId,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-conflict");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = (
        read as {
          value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
        }
      ).value;
      awaitingRevision = value.snapshot.runRevision;
      changeSet = value.changeSet;
    });
    if (changeSet === undefined) throw new Error("Expected a staged Change Set.");
    await writeFile(
      chapterPath,
      original.replace(body, "Externally changed chapter body.\n"),
      "utf8"
    );

    const result = await session.decideChangeSet({
      runId: "run-desktop-conflict",
      projectId: "project-01",
      commandId: "apply-desktop-conflict",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });

    expect(result).toMatchObject({ ok: false });
    expect(operations).toEqual([
      `pause:chapters/${chapterId}.md`,
      `preserve:chapters/${chapterId}.md`,
      `resume:chapters/${chapterId}.md`
    ]);
    expect(await readFile(chapterPath, "utf8")).toContain("Externally changed chapter body.");
  });

  test("opens rollback review before restoring a chapter with a dirty active editor", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-dirty-undo-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D6";
    const relativePath = `chapters/${chapterId}.md`;
    const chapterPath = join(projectRoot, relativePath);
    const body = "Original chapter body.\n";
    const dirtyBody = "Unsaved user body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-dirty-undo-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    let editorDirty = false;
    const editorReads: boolean[] = [];
    const syncOptions: (string | undefined)[] = [];
    let round = 0;
    const session = createDesktopRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-dirty-undo",
      readEditorState: async (path: string) => {
        editorReads.push(editorDirty);
        return path === relativePath
          ? { dirty: editorDirty, content: editorDirty ? dirtyBody : body }
          : undefined;
      },
      syncSavedEditor: async (
        path: string,
        options?: { readonly expectedDirtyChecksum?: string }
      ) => {
        if (path === relativePath) {
          syncOptions.push(options?.expectedDirtyChecksum);
          editorDirty = false;
        }
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-dirty-undo", "propose_chapter_write", {
              chapterId,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-dirty-undo", "finish", { summary: "Applied." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand());
    let changeSet: Record<string, unknown> | undefined;
    let revision = 0;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-dirty-undo");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = read as {
        value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
      };
      revision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
    });
    if (changeSet === undefined) throw new Error("Expected Change Set.");
    await session.decideChangeSet({
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "apply-desktop-dirty-undo",
      expectedRunRevision: revision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-dirty-undo")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const agentFile = await readFile(chapterPath, "utf8");
    expect(agentFile).toContain("Revised chapter body.");
    editorDirty = true;
    const completed = (await session.readAgentRun("run-desktop-dirty-undo")) as {
      value: { snapshot: { runRevision: number } };
    };

    const undoRequested = await session.undoRun({
      action: "request",
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "undo-desktop-dirty-undo",
      expectedRunRevision: completed.value.snapshot.runRevision
    });
    expect(undoRequested).toMatchObject({ ok: true });
    expect(editorReads).toContain(true);

    const reviewed = await session.readAgentRun("run-desktop-dirty-undo");
    expect(reviewed).toMatchObject({
      ok: true,
      value: {
        rollbackReview: {
          files: [
            expect.objectContaining({
              relativePath,
              reviewedCurrentHistoryContent: dirtyBody,
              status: "conflict"
            })
          ]
        }
      }
    });
    expect(await readFile(chapterPath, "utf8")).toBe(agentFile);
    const reviewValue = reviewed as {
      value: {
        snapshot: { runRevision: number };
        rollbackReview: { reviewId: string };
      };
    };

    await session.undoRun({
      action: "resolve",
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "restore-desktop-dirty-undo",
      expectedRunRevision: reviewValue.value.snapshot.runRevision,
      reviewId: reviewValue.value.rollbackReview.reviewId,
      decisions: [{ relativePath, decision: "restore_baseline" }]
    });

    expect(await readFile(chapterPath, "utf8")).toBe(original);
    expect(syncOptions).toContain(sha256(dirtyBody));
    expect(editorDirty).toBe(false);
  });

  test("does not claim external schema validation for an ordinary text proposal", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-text-"));
    roots.push(projectRoot);
    const notesPath = join(projectRoot, "notes.txt");
    const notes = "Original notes.\n";
    await writeFile(notesPath, notes, "utf8");
    let round = 0;
    const session = createDesktopRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-text-validation",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-text", "propose_file_write", {
              path: "notes.txt",
              baseHash: sha256(notes),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));

    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-text-validation");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            files: [
              {
                validation: {
                  schema: { status: "not_applicable" },
                  asset: { status: "not_applicable" }
                }
              }
            ]
          }
        }
      });
    });
    expect(await readFile(notesPath, "utf8")).toBe(notes);
  });

  test("rejects a syntax-valid settings candidate that fails the existing settings schema", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-schema-"));
    roots.push(projectRoot);
    const settingsPath = join(projectRoot, "settings.json");
    const settings = "{}\n";
    const invalidCandidate = '{"schemaVersion":"1.0"}\n';
    await writeFile(settingsPath, settings, "utf8");
    let round = 0;
    const session = createDesktopRuntime({
      projectRoot,
      projectId: "project-01",
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-settings-schema",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-settings", "propose_file_write", {
              path: "settings.json",
              baseHash: sha256(settings),
              range: { unit: "character", start: 0, end: settings.length },
              replacement: invalidCandidate
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-settings-schema")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            files: [
              {
                relativePath: "settings.json",
                validation: {
                  valid: false,
                  syntax: { status: "valid" },
                  schema: { status: "invalid" }
                }
              }
            ]
          }
        }
      });
    });
    expect(await readFile(settingsPath, "utf8")).toBe(settings);
  });
});

function createDesktopRuntime(options: Record<string, unknown>) {
  return (
    runtimeExports.createDesktopAgentRunSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    }
  )(options);
}

function runtimeToolCall(toolCallId: string, name: string, value: Record<string, unknown>) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(value)
  };
}

function executionCommand(
  contextMode: "writing" | "general_file" = "writing"
): Record<string, unknown> {
  return {
    projectId: "project-01",
    conversationId: "conv-desktop",
    commandId: "start-desktop-write",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode,
    writePolicy: "write_before_confirmation",
    userRequest: "Revise the active chapter.",
    providerCapabilitySnapshot: {
      profileId: "demo-agent",
      provider: "demo",
      modelName: "desktop-scripted-agent",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000,
      requiredContextTokens: 8000
    }
  };
}

function strictPlanningCommand(conversationId: string, commandId: string) {
  return {
    ...executionCommand(),
    conversationId,
    commandId,
    operationMode: "planning" as const,
    userRequest: "Review the active chapter and prepare a plan."
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
