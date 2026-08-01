import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import * as applicationExports from "../src/index.js";
import { packAgentContext } from "../src/agent-prompt-materializer.js";

describe("AgentRunSession Stage 2 integration", () => {
  test("stages a proposal without writing and pauses on the persisted Change Set", async () => {
    const createSession = requireCreateSession();
    const proposalCalls: Record<string, unknown>[] = [];
    let toolsShownToModel: string[] = [];
    let round = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_proposal" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          round += 1;
          toolsShownToModel = input.tools.map((tool) => tool.name);
          if (round === 1) {
            yield toolCall("propose_notes", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_after_proposal", "finish", { summary: "unexpected resume" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite(input: Record<string, unknown>) {
          proposalCalls.push(input);
          return { ok: true, value: pendingChangeSet("run_stage2_proposal") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_stage2_proposal")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "awaiting_write_approval",
            pendingChangeSetId: "changes_stage2",
            pendingChangeSetRevision: 1,
            pendingChangeSetChecksum: "checksum_revision_1"
          },
          changeSet: {
            changeSetId: "changes_stage2",
            revision: 1,
            status: "awaiting_approval"
          }
        }
      });
    });

    expect(toolsShownToModel).toContain("propose_file_write");
    expect(proposalCalls).toHaveLength(1);
    expect(round).toBe(1);
    const read = await session.readAgentRun("run_stage2_proposal");
    expect(JSON.stringify(read)).not.toContain("unexpected resume");
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).toContain("change_set_ready");
  });

  test("auto-approves an acknowledged execution run through the same Version Group path", async () => {
    const createSession = requireCreateSession();
    let round = 0;
    let applyCount = 0;
    let proposalToolResult: Record<string, unknown> | undefined;
    const durableRepository = memoryRepository();
    const receiptCommandIds: string[] = [];
    const repository = {
      ...durableRepository,
      async readCommandReceipt(runId: string, commandId: string) {
        receiptCommandIds.push(commandId);
        return /^[A-Za-z0-9_-]+$/.test(commandId)
          ? durableRepository.readCommandReceipt(runId, commandId)
          : { ok: false as const, error: storageError("AGENT_RUN_RECEIPT_INVALID") };
      },
      async writeCommandReceipt(
        runId: string,
        commandId: string,
        receipt: Record<string, unknown>
      ) {
        receiptCommandIds.push(commandId);
        return /^[A-Za-z0-9_-]+$/.test(commandId)
          ? durableRepository.writeCommandReceipt(runId, commandId, receipt)
          : { ok: false as const, error: storageError("AGENT_RUN_RECEIPT_INVALID") };
      }
    };
    const changeSetSession = applicationExports.createChangeSetSession({
      port: {
        async readChapterTarget() {
          throw new Error("unused");
        },
        async readFileTarget() {
          return {
            ok: true as const,
            value: {
              relativePath: "notes/outline.md",
              assetType: "text" as const,
              content: "before\n",
              checksum: sha256("before\n"),
              dirty: false,
              supported: true
            }
          };
        },
        async validateCandidate() {
          return { ok: true as const, value: {} };
        },
        async persistChangeSet(changeSet) {
          return { ok: true as const, value: changeSet };
        }
      },
      createChangeSetId: () => "changes_stage3_auto",
      createHunkId: () => "hunk_stage3_auto",
      now: () => "2026-07-13T00:00:00.000Z"
    });
    const versionGroupSession = applicationExports.createVersionGroupSession({
      transaction: {
        async listIncompleteTransactionPaths() {
          return { ok: true as const, value: [] };
        },
        async apply(input) {
          applyCount += 1;
          expect(input).toMatchObject({
            writePolicy: "user_preapproved_run",
            approvalSource: "user_preapproved_run"
          });
          return {
            ok: true as const,
            value: {
              schemaVersion: "1.0" as const,
              versionGroupId: "versions_stage3_auto",
              runId: input.runId,
              checkpointId: input.checkpointId,
              changeSetId: input.changeSetId,
              changeSetRevision: input.revision,
              changeSetChecksum: input.checksum,
              writePolicy: input.writePolicy,
              approvalSource: input.approvalSource,
              createdAt: "2026-07-13T00:01:00.000Z",
              transactionStatus: "applied" as const,
              undoStatus: "available" as const,
              writes: [],
              baselineByPath: {},
              undoMetadata: {
                runId: input.runId,
                versionGroupId: "versions_stage3_auto",
                baselineVersionIds: {},
                lastWriteChecksums: {}
              }
            }
          };
        },
        async recoverIncompleteTransactions() {
          return { ok: true as const, value: [] };
        },
        async undoVersionGroup() {
          throw new Error("unused");
        },
        async undoWrite() {
          throw new Error("unused");
        },
        async undoRun() {
          throw new Error("unused");
        }
      },
      hooks: {
        async pauseAutosave() {},
        async resumeAutosave() {},
        async syncSavedEditor() {},
        async preserveDirtyBuffers() {},
        async markRecoveryClean() {},
        async surfaceTransactionRecoveryReview() {}
      }
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_auto" },
      repository,
      modelDriver: {
        async *streamRound(input: {
          readonly messages: readonly {
            readonly role: string;
            readonly content: string;
            readonly toolCallId?: string;
          }[];
        }) {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_auto", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          proposalToolResult = JSON.parse(
            input.messages.find(
              (message) => message.role === "tool" && message.toolCallId === "propose_auto"
            )?.content ?? "{}"
          ) as Record<string, unknown>;
          yield toolCall("finish_auto", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: {
        async apply(
          input: Parameters<typeof versionGroupSession.applyApproved>[0]
        ): Promise<Record<string, unknown>> {
          return (await versionGroupSession.applyApproved(input)) as unknown as Record<
            string,
            unknown
          >;
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    const started = await session.startAgentRun({
      ...startCommand(),
      commandId: "start-stage3-auto",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    expect(started).toMatchObject({ ok: true, value: { writePolicy: "user_preapproved_run" } });
    await waitForStatus(session, "run_stage3_auto", "completed");

    const read = await session.readAgentRun("run_stage3_auto");
    expect(applyCount).toBe(1);
    expect(receiptCommandIds).toContain("auto_approve_changes_stage3_auto_1");
    expect(proposalToolResult).toMatchObject({ status: "awaiting_approval" });
    expect(read).toMatchObject({
      ok: true,
      value: {
        changeSet: { status: "applied" },
        snapshot: { versionGroupId: "versions_stage3_auto" }
      }
    });
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).toEqual(
      expect.arrayContaining([
        "change_set_ready",
        "change_set_auto_approved",
        "approval_resolved",
        "write_started",
        "write_applied"
      ])
    );
    const eventTypes = (read as { value: { events: { type: string }[] } }).value.events.map(
      (event) => event.type
    );
    expect(eventTypes.indexOf("change_set_ready")).toBeLessThan(
      eventTypes.indexOf("change_set_auto_approved")
    );
    expect(eventTypes.indexOf("change_set_auto_approved")).toBeLessThan(
      eventTypes.indexOf("approval_resolved")
    );
    expect(eventTypes.indexOf("approval_resolved")).toBeLessThan(
      eventTypes.indexOf("write_started")
    );
  });

  test("does not emit auto approval when approval validation fails", async () => {
    const createSession = requireCreateSession();
    let decisionCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_invalid_auto" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return {
            ok: true,
            value: pendingChangeSet("run_stage3_invalid_auto", "user_preapproved_run")
          };
        },
        ...unusedChangeSetMethods(),
        async decide() {
          decisionCount += 1;
          return { ok: false, error: storageError("CHANGE_SET_INVALID") };
        }
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun({
      ...startCommand(),
      commandId: "start-invalid-auto",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    await vi.waitFor(() => expect(decisionCount).toBe(1));

    const read = await session.readAgentRun("run_stage3_invalid_auto");
    expect(read).toMatchObject({
      ok: true,
      value: { snapshot: { status: "awaiting_write_approval" } }
    });
    const eventTypes = (read as { value: { events: { type: string }[] } }).value.events.map(
      (event) => event.type
    );
    expect(eventTypes).not.toContain("change_set_auto_approved");
    expect(eventTypes).not.toContain("approval_resolved");
    expect(eventTypes).not.toContain("write_started");
  });

  test("keeps automatic approval source internal to the run session", async () => {
    const createSession = requireCreateSession();
    let observedApprovalSource: unknown;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_external_source" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_external_source") };
        },
        ...unusedChangeSetMethods(),
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "apply_selected",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-13T00:00:00.000Z",
              binding: {
                changeSetId: "changes_stage2",
                revision: 1,
                checksum: "checksum_revision_1",
                approvalToken: "approval_stage2"
              }
            }
          };
        }
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          observedApprovalSource = (input["approval"] as Record<string, unknown> | undefined)?.[
            "approvalSource"
          ];
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_external_source",
              runId: "run_external_source",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
              writes: []
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(session, "run_external_source", "awaiting_write_approval");
    const command = {
      action: "request" as const,
      projectId: "project-01",
      runId: "run_external_source",
      commandId: "external-source-injection",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };

    await Reflect.apply(session.decideChangeSet, session, [command, "user_preapproved_run"]);

    expect(observedApprovalSource).toBe("human_confirmation");
  });

  test("downgrades a persisted automatic policy before a restored run can write", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    const seededSession = createSession({
      repository,
      coordinatorOptions: { createRunId: () => "run_forged_auto" },
      modelDriver: {
        async *streamRound() {
          await new Promise<void>(() => undefined);
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor()
    });
    expect(await seededSession.startAgentRun(startCommand())).toMatchObject({ ok: true });
    const persisted = await repository.readSnapshot("run_forged_auto");
    expect(persisted.value).toBeDefined();
    if (persisted.value === undefined) return;
    await repository.writeSnapshot({
      ...persisted.value,
      writePolicy: "user_preapproved_run"
    });
    let applyCount = 0;
    const session = createSession({
      repository,
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_forged_auto") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_forged_auto",
              runId: "run_forged_auto",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
              writes: []
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    expect(await session.readAgentRun("run_forged_auto")).toMatchObject({
      ok: true,
      value: { snapshot: { writePolicy: "write_before_confirmation" } }
    });
    await session.resumeAgentRun({
      runId: "run_forged_auto",
      projectId: "project-01",
      commandId: "resume-forged-auto",
      expectedRunRevision: Number(persisted.value["runRevision"])
    });
    await waitForStatus(session, "run_forged_auto", "awaiting_write_approval");

    const read = await session.readAgentRun("run_forged_auto");
    expect(applyCount).toBe(0);
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).not.toContain("change_set_auto_approved");
  });

  test("applies an approved revision through Version Group once when the command is replayed", async () => {
    const createSession = requireCreateSession();
    let applyCount = 0;
    let round = 0;
    let currentContext = "before\n";
    const beforeOutline = workspaceOutlineSource("chapters:r1", "story:r1", [
      {
        kind: "file",
        id: "notes/outline.md",
        label: "before",
        relativePath: "notes/outline.md"
      }
    ]);
    const afterOutline = workspaceOutlineSource("chapters:r1", "story:r1", [
      {
        kind: "file",
        id: "notes/outline.md",
        label: "before",
        relativePath: "notes/outline.md"
      }
    ]);
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let releaseVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_apply" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_apply", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await verificationGate;
          yield toolCall("finish_apply", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      contextSourceReader: {
        async readCurrentSources(input: {
          readonly purpose: "staleness" | "refresh";
          readonly sources: readonly { readonly refId: string; readonly sourceKind: string }[];
        }) {
          return {
            ok: true,
            value: input.sources.map((source) => {
              if (source.sourceKind !== "workspace_outline") {
                return { refId: source.refId, content: currentContext };
              }
              const outline = currentContext === "before\n" ? beforeOutline : afterOutline;
              const materialization = outline.materialization;
              return {
                refId: source.refId,
                comparisonChecksum:
                  materialization?.kind === "workspace_outline"
                    ? materialization.dependencyRevisionChecksum
                    : undefined,
                ...(input.purpose === "refresh" ? { source: outline } : {})
              };
            })
          };
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_apply") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          applyCount += 1;
          expect(input).toMatchObject({
            changeSet: {
              changeSetId: "changes_stage2",
              revision: 1,
              checksum: "checksum_revision_1"
            },
            approval: {
              approvalSource: "human_confirmation",
              binding: {
                changeSetId: "changes_stage2",
                revision: 1,
                checksum: "checksum_revision_1"
              }
            }
          });
          await applyGate;
          currentContext = "after\n";
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_stage2",
              runId: "run_stage2_apply",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
              synchronization: {
                status: "recovery_required",
                failedHooks: ["markRecoveryClean"]
              },
              writes: [
                {
                  relativePath: "notes/outline.md",
                  afterChecksum: sha256("after\n"),
                  status: "applied"
                }
              ]
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/outline.md",
          sourceKind: "disk_file",
          relativePath: "notes/outline.md",
          content: currentContext,
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(session, "run_stage2_apply", "awaiting_write_approval");
    const command = {
      projectId: "project-01",
      runId: "run_stage2_apply",
      commandId: "apply-stage2-01",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };

    const firstPending = session.decideChangeSet(command);
    await vi.waitFor(() => expect(applyCount).toBe(1));
    const duplicatePending = session.decideChangeSet(command);
    releaseApply();
    const [first, duplicate] = await Promise.all([firstPending, duplicatePending]);

    expect(duplicate).toEqual(first);
    expect(applyCount).toBe(1);
    const duringVerification = await session.readAgentRun("run_stage2_apply");
    const eventTypes = (
      duringVerification as { value: { events: { type: string }[] } }
    ).value.events.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["approval_resolved", "write_started", "write_applied"])
    );
    expect(
      (
        duringVerification as {
          value: { events: { type: string; detail?: Record<string, unknown> }[] };
        }
      ).value.events.find((event) => event.type === "write_applied")
    ).toMatchObject({
      detail: {
        versionGroupId: "versions_stage2",
        relativePaths: ["notes/outline.md"],
        synchronizationStatus: "recovery_required",
        synchronizationFailedHooks: ["markRecoveryClean"]
      }
    });
    releaseVerification();
    await waitForStatus(session, "run_stage2_apply", "completed");
    expect(await session.readAgentRun("run_stage2_apply")).toMatchObject({
      ok: true,
      value: {
        changeSet: { changeSetId: "changes_stage2", status: "applied" },
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "write_applied",
            detail: expect.objectContaining({
              refreshedContextSourceRefs: ["file:notes/outline.md"]
            })
          })
        ])
      }
    });
  });

  test.each([
    {
      label: "the touched path was externally overwritten",
      entries: [
        {
          kind: "story_bible_asset" as const,
          id: "chr_one",
          label: "角色一（外部覆盖）",
          relativePath: "characters/chr_one.json"
        },
        {
          kind: "story_bible_asset" as const,
          id: "chr_two",
          label: "角色二",
          relativePath: "characters/chr_two.json"
        }
      ],
      expectedStatus: "awaiting_context_refresh" as const
    },
    {
      label: "another asset in the same bucket changed",
      entries: [
        {
          kind: "story_bible_asset" as const,
          id: "chr_one",
          label: "角色一（本次写入）",
          relativePath: "characters/chr_one.json"
        },
        {
          kind: "story_bible_asset" as const,
          id: "chr_two",
          label: "角色二（外部修改）",
          relativePath: "characters/chr_two.json"
        }
      ],
      expectedStatus: "awaiting_context_refresh" as const
    },
    {
      label: "an untouched chapter bucket changed",
      afterChapterRevision: "chapters:external",
      entries: [
        {
          kind: "story_bible_asset" as const,
          id: "chr_one",
          label: "角色一（本次写入）",
          relativePath: "characters/chr_one.json"
        },
        {
          kind: "story_bible_asset" as const,
          id: "chr_two",
          label: "角色二",
          relativePath: "characters/chr_two.json"
        }
      ],
      expectedStatus: "awaiting_context_refresh" as const
    },
    {
      label: "an untouched chapter degradation changed",
      afterChapterRevision: "chapters:missing",
      afterDegradedDependencies: ["chapters"] as const,
      entries: [
        {
          kind: "story_bible_asset" as const,
          id: "chr_one",
          label: "角色一（本次写入）",
          relativePath: "characters/chr_one.json"
        },
        {
          kind: "story_bible_asset" as const,
          id: "chr_two",
          label: "角色二",
          relativePath: "characters/chr_two.json"
        }
      ],
      expectedStatus: "awaiting_context_refresh" as const
    },
    {
      label: "only max_tokens truncated the materialized text",
      truncationReasons: ["max_tokens"] as const,
      entries: [
        {
          kind: "story_bible_asset" as const,
          id: "chr_one",
          label: "角色一（本次写入）",
          relativePath: "characters/chr_one.json"
        },
        {
          kind: "story_bible_asset" as const,
          id: "chr_two",
          label: "角色二",
          relativePath: "characters/chr_two.json"
        }
      ],
      expectedStatus: "completed" as const
    }
  ])(
    "handles an own-write outline safely when $label",
    async ({
      entries,
      expectedStatus,
      afterChapterRevision,
      afterDegradedDependencies,
      truncationReasons
    }) => {
      const createSession = requireCreateSession();
      const runId = "run_stage2_own_write_outline_external";
      const beforeOutline = workspaceOutlineSource(
        "chapters:r1",
        "story:r1",
        [
          {
            kind: "story_bible_asset",
            id: "chr_one",
            label: "角色一",
            relativePath: "characters/chr_one.json"
          },
          {
            kind: "story_bible_asset",
            id: "chr_two",
            label: "角色二",
            relativePath: "characters/chr_two.json"
          }
        ],
        { ...(truncationReasons === undefined ? {} : { truncationReasons }) }
      );
      const afterOutline = workspaceOutlineSource(
        afterChapterRevision ?? "chapters:r1",
        "story:own-plus-external",
        entries,
        {
          ...(truncationReasons === undefined ? {} : { truncationReasons }),
          ...(afterDegradedDependencies === undefined
            ? {}
            : { degradedDependencies: afterDegradedDependencies })
        }
      );
      const candidateContent = JSON.stringify({
        id: "chr_one",
        title: "角色一（本次写入）",
        type: "character"
      });
      let applied = false;
      let rounds = 0;
      const baseChangeSet = pendingChangeSet(runId) as unknown as {
        readonly files: readonly Record<string, unknown>[];
      } & Record<string, unknown>;
      const changeSet = {
        ...baseChangeSet,
        files: [
          {
            ...baseChangeSet.files[0],
            relativePath: "characters/chr_one.json",
            candidateContent,
            candidateChecksum: sha256(candidateContent)
          }
        ]
      };
      const session = createSession({
        newRunToolFacadeVersion: "v2",
        coordinatorOptions: { createRunId: () => runId },
        repository: memoryRepository(),
        modelDriver: {
          async *streamRound() {
            rounds += 1;
            if (rounds === 1) {
              yield toolCall("propose_outline_refresh", "edit_text", {
                ref: "story_bible:chr_one",
                baseHash: sha256("before\n"),
                range: { unit: "character", start: 0, end: 7 },
                replacement: candidateContent
              });
              yield { type: "round_completed", finishReason: "tool_calls" };
            } else {
              yield toolCall("finish_outline_refresh", "finish", { summary: "done" });
              yield { type: "round_completed", finishReason: "tool_calls" };
            }
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: unusedReadExecutor(),
        contextSourceReader: {
          async readCurrentSources(input: {
            readonly purpose: "staleness" | "refresh";
            readonly sources: readonly {
              readonly refId: string;
              readonly sourceKind: string;
            }[];
          }) {
            return {
              ok: true,
              value: input.sources.map((source) => {
                if (source.sourceKind !== "workspace_outline") {
                  return { refId: source.refId, content: applied ? candidateContent : "before\n" };
                }
                const outline = applied ? afterOutline : beforeOutline;
                const materialization = outline.materialization as unknown as Record<
                  string,
                  unknown
                >;
                return {
                  refId: source.refId,
                  comparisonChecksum: materialization["dependencyRevisionChecksum"],
                  ...(input.purpose === "refresh" ? { source: outline } : {})
                };
              })
            };
          }
        },
        changeSetSession: {
          async proposeStoryBibleWrite() {
            return { ok: true, value: changeSet };
          },
          async proposeFileWrite() {
            throw new Error("unused");
          },
          ...unusedChangeSetMethods()
        },
        versionGroupExecutor: {
          async apply() {
            applied = true;
            return {
              ok: true,
              value: {
                versionGroupId: "versions_outline_external",
                transactionStatus: "applied",
                writes: [
                  {
                    relativePath: "characters/chr_one.json",
                    afterChecksum: sha256(candidateContent),
                    status: "applied"
                  }
                ]
              }
            };
          },
          async undoRun() {
            throw new Error("unused");
          }
        }
      });

      const started = await session.startAgentRun({
        ...startCommand(),
        contextMode: "writing",
        initialContextSources: [
          beforeOutline,
          {
            refId: "story_bible:chr_one",
            sourceKind: "story_bible_asset",
            relativePath: "characters/chr_one.json",
            assetId: "chr_one",
            content: "before\n",
            dirty: false
          }
        ]
      });
      if (!started.ok) throw new Error(JSON.stringify(started.error));
      const awaiting = await waitForStatus(session, runId, "awaiting_write_approval");
      await session.decideChangeSet({
        projectId: "project-01",
        runId,
        commandId: "apply-outline-external",
        expectedRunRevision: awaiting.runRevision,
        changeSetId: "changes_stage2",
        revision: 1,
        checksum: "checksum_revision_1",
        decision: "apply_selected"
      });

      await waitForStatus(session, runId, expectedStatus);
      expect(rounds).toBe(expectedStatus === "completed" ? 2 : 1);
    }
  );

  test("does not cache a successful apply when its command receipt cannot be persisted", async () => {
    const createSession = requireCreateSession();
    const durableRepository = memoryRepository();
    let failReceiptWrites = false;
    let applyCount = 0;
    const repository = {
      ...durableRepository,
      async writeCommandReceipt(
        runId: string,
        commandId: string,
        receipt: Record<string, unknown>
      ) {
        if (failReceiptWrites) {
          return {
            ok: false as const,
            error: storageError("AGENT_RUN_RECEIPT_WRITE_FAILED")
          };
        }
        return durableRepository.writeCommandReceipt(runId, commandId, receipt);
      }
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_receipt_failure" },
      repository,
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_receipt_failure") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "versions_receipt_failure" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_receipt_failure",
      "awaiting_write_approval"
    );
    const command = {
      projectId: "project-01",
      runId: "run_stage2_receipt_failure",
      commandId: "apply-stage2-receipt-failure",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };
    failReceiptWrites = true;

    expect(await session.decideChangeSet(command)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RECEIPT_WRITE_FAILED" },
      latestSnapshot: { versionGroupId: "versions_receipt_failure" }
    });
    expect(await session.decideChangeSet(command)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_REVISION_CONFLICT" }
    });
    expect(applyCount).toBe(1);
  });

  test("reports base conflicts and per-file rollback state without emitting write_applied", async () => {
    const createSession = requireCreateSession();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_conflict" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_conflict") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: false as const,
            error: {
              schemaVersion: "1.0",
              errorId: "err_stage2_conflict",
              code: "AGENT_WRITE_BASE_CONFLICT",
              category: "ValidationError",
              message: "The target changed.",
              recoverability: "user-action",
              suggestedAction: "Refresh the Change Set.",
              traceId: "stage2-test",
              createdAt: "2026-07-13T00:00:00.000Z",
              redactedDetail: {
                baseHashConflictPaths: ["notes/outline.md"],
                writes: [
                  {
                    relativePath: "notes/outline.md",
                    status: "pending",
                    errorCode: "AGENT_WRITE_BASE_CONFLICT"
                  }
                ]
              }
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(session, "run_stage2_conflict", "awaiting_write_approval");
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_conflict",
      commandId: "apply-stage2-conflict",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    const read = await session.readAgentRun("run_stage2_conflict");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "failed" } } });
    const events = (read as { value: { events: { type: string; detail?: unknown }[] } }).value
      .events;
    expect(events.find((event) => event.type === "write_failed")).toMatchObject({
      detail: {
        code: "AGENT_WRITE_BASE_CONFLICT",
        baseHashConflictPaths: ["notes/outline.md"],
        writes: [
          {
            relativePath: "notes/outline.md",
            status: "pending",
            errorCode: "AGENT_WRITE_BASE_CONFLICT"
          }
        ]
      }
    });
    expect(events.some((event) => event.type === "write_applied")).toBe(false);
  });

  test("creates and binds a new immutable revision when the file or hunk selection changes", async () => {
    const createSession = requireCreateSession();
    let selectCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_selection" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_selection") };
        },
        ...unusedChangeSetMethods(),
        async selectRevision(input: Record<string, unknown>) {
          selectCount += 1;
          expect(input).toMatchObject({
            changeSetId: "changes_stage2",
            revision: 1,
            files: [{ relativePath: "notes/outline.md", selected: false }]
          });
          return {
            ok: true,
            value: {
              ...pendingChangeSet("run_stage2_selection"),
              revision: 2,
              checksum: "checksum_revision_2",
              approvalToken: "approval_revision_2",
              files: []
            }
          };
        }
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_selection",
      "awaiting_write_approval"
    );
    const command = {
      projectId: "project-01",
      runId: "run_stage2_selection",
      commandId: "select-stage2-01",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "update_selection",
      files: [{ relativePath: "notes/outline.md", selected: false }]
    };
    const first = await session.decideChangeSet(command);
    const duplicate = await session.decideChangeSet(command);

    expect(duplicate).toEqual(first);
    expect(selectCount).toBe(1);
    expect(await session.readAgentRun("run_stage2_selection")).toMatchObject({
      value: {
        snapshot: {
          status: "awaiting_write_approval",
          pendingChangeSetRevision: 2,
          pendingChangeSetChecksum: "checksum_revision_2"
        },
        changeSet: { revision: 2, checksum: "checksum_revision_2" }
      }
    });
  });

  test("replays run-level undo without repeating the Version Group compensation", async () => {
    const createSession = requireCreateSession();
    let undoCount = 0;
    let round = 0;
    let releaseUndo!: () => void;
    const undoGate = new Promise<void>((resolve) => {
      releaseUndo = resolve;
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_undo" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_undo") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage2_undo", transactionStatus: "applied" }
          };
        },
        async undoRun() {
          undoCount += 1;
          await undoGate;
          return {
            ok: true,
            value: {
              versionGroupId: "versions_stage2_undo",
              transactionStatus: "applied",
              undoStatus: "completed",
              undoMetadata: {
                runId: "run_stage2_undo",
                undoOfVersionGroupIds: ["versions_stage2_undo"]
              },
              writes: [{ relativePath: "notes/outline.md" }]
            }
          };
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(session, "run_stage2_undo", "awaiting_write_approval");
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_undo",
      commandId: "apply-stage2-undo",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage2_undo", "completed");
    const command = {
      projectId: "project-01",
      runId: "run_stage2_undo",
      commandId: "undo-stage2-01",
      expectedRunRevision: completed.runRevision
    };
    const firstPending = session.undoRun(command);
    await vi.waitFor(() => expect(undoCount).toBe(1));
    const duplicatePending = session.undoRun(command);
    releaseUndo();
    const [first, duplicate] = await Promise.all([firstPending, duplicatePending]);

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        runRevision: completed.runRevision + 2,
        lastSequence: completed.lastSequence + 2
      }
    });
    expect(undoCount).toBe(1);
    const read = await session.readAgentRun("run_stage2_undo");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "completed" } } });
    const events = (read as { value: { events: readonly Record<string, unknown>[] } }).value.events;
    expect(events.slice(-2)).toMatchObject([
      {
        type: "run_undo_started",
        detail: { commandId: "undo-stage2-01" }
      },
      {
        type: "run_undone",
        detail: {
          versionGroupId: "versions_stage2_undo",
          relativePaths: ["notes/outline.md"],
          versionGroup: {
            versionGroupId: "versions_stage2_undo",
            transactionStatus: "applied",
            undoStatus: "completed",
            undoMetadata: {
              runId: "run_stage2_undo",
              undoOfVersionGroupIds: ["versions_stage2_undo"]
            }
          }
        }
      }
    ]);
  });

  test("rejects run undo for planning before writing audit events or calling the executor", async () => {
    const createSession = requireCreateSession();
    let undoCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_planning_undo" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("finish_planning_undo", "finish_plan", {
            planId: "plan-planning-undo",
            goal: "Plan without writing files.",
            successCriteria: ["The plan remains read-only."],
            nonGoals: ["Do not modify project files."],
            facts: ["Planning mode is active."],
            assumptions: [],
            openQuestions: [],
            targetRefs: [{ refId: "notes:outline", intent: "Review the outline." }],
            steps: [{ stepId: "step-01", title: "Review", verification: "Read again." }],
            risks: [],
            verification: ["Confirm no write occurred."],
            sourceRefs: ["notes:outline"]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      versionGroupExecutor: {
        async apply() {
          throw new Error("Planning must not apply a Version Group.");
        },
        async undoRun() {
          undoCount += 1;
          return {
            ok: true,
            value: { versionGroupId: "unexpected", transactionStatus: "applied" }
          };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    const ready = await waitForStatus(session, "run_stage3_planning_undo", "plan_ready");
    const cancelled = await session.decidePlan({
      projectId: "project-01",
      runId: "run_stage3_planning_undo",
      commandId: "reject-planning-01",
      expectedRunRevision: ready.runRevision,
      planId: "plan-planning-undo",
      planRevision: 1,
      decision: "reject"
    });
    expect(cancelled).toMatchObject({ ok: true, value: { status: "completed" } });
    const cancelledRevision = (cancelled as { value: { runRevision: number } }).value.runRevision;
    const before = await session.readAgentRun("run_stage3_planning_undo");
    const beforeEvents = (before as { value: { events: readonly unknown[] } }).value.events.length;

    const rejected = await session.undoRun({
      action: "request",
      projectId: "project-01",
      runId: "run_stage3_planning_undo",
      commandId: "undo-planning-01",
      expectedRunRevision: cancelledRevision
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_UNDO_NOT_ALLOWED" }
    });
    expect(undoCount).toBe(0);
    const after = await session.readAgentRun("run_stage3_planning_undo");
    expect((after as { value: { events: readonly unknown[] } }).value.events).toHaveLength(
      beforeEvents
    );
  });

  test("keeps a conflict-aware undo interactive until reviewed decisions complete it", async () => {
    const createSession = requireCreateSession();
    const undoInputs: Record<string, unknown>[] = [];
    let round = 0;
    const rollbackReview = {
      schemaVersion: "1.0",
      reviewId: "rollback_review_01",
      runId: "run_stage3_undo_review",
      status: "pending",
      sourceVersionGroupIds: ["versions_stage3_undo_review"],
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      processedCommandIds: [],
      files: [
        {
          relativePath: "notes/outline.md",
          assetType: "text",
          baselineContent: "before\n",
          baselineChecksum: sha256("before\n"),
          baselineVersionId: "ver_before",
          runLastWriteContent: "after\n",
          runLastWriteChecksum: sha256("after\n"),
          reviewedCurrentContent: "user edit\n",
          reviewedCurrentChecksum: sha256("user edit\n"),
          diff: {
            currentToLastWrite: "current -> ai",
            currentToBaseline: "current -> baseline",
            lastWriteToBaseline: "ai -> baseline"
          },
          status: "conflict"
        }
      ]
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_undo_review" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo_review", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo_review", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage3_undo_review") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage3_undo_review", transactionStatus: "applied" }
          };
        },
        async undoRun(input: Record<string, unknown>) {
          undoInputs.push(input);
          return input["action"] === "resolve"
            ? {
                ok: true,
                value: {
                  versionGroupId: "rollback_review_01",
                  transactionStatus: "applied",
                  undoStatus: "completed",
                  rollbackReview: { ...rollbackReview, status: "completed" }
                }
              }
            : {
                ok: true,
                value: {
                  versionGroupId: "rollback_review_01",
                  transactionStatus: "awaiting_review",
                  undoStatus: "review_required",
                  rollbackReview
                }
              };
        },
        async readRollbackReview() {
          return { ok: true, value: rollbackReview };
        }
      }
    });
    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage3_undo_review",
      "awaiting_write_approval"
    );
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "apply-stage3-undo-review",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage3_undo_review", "completed");

    const requested = await session.undoRun({
      action: "request",
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "undo-review-request",
      expectedRunRevision: completed.runRevision
    });

    if (!requested.ok) throw new Error(JSON.stringify(requested));
    const pendingRead = await session.readAgentRun("run_stage3_undo_review");
    expect(pendingRead).toMatchObject({
      ok: true,
      value: {
        rollbackReview: { reviewId: "rollback_review_01", status: "pending" }
      }
    });
    expect(
      (pendingRead as { value: { events: readonly Record<string, unknown>[] } }).value.events
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "run_undo_review_required" })])
    );
    const resolved = await session.undoRun({
      action: "resolve",
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "undo-review-resolve",
      expectedRunRevision: (requested.value as { runRevision: number }).runRevision,
      reviewId: "rollback_review_01",
      decisions: [{ relativePath: "notes/outline.md", decision: "keep_current" }]
    });

    expect(resolved.ok).toBe(true);
    expect(undoInputs).toMatchObject([
      { action: "request", commandId: "undo-review-request" },
      {
        action: "resolve",
        commandId: "undo-review-resolve",
        reviewId: "rollback_review_01",
        decisions: [{ relativePath: "notes/outline.md", decision: "keep_current" }]
      }
    ]);
    const resolvedRead = await session.readAgentRun("run_stage3_undo_review");
    expect(resolvedRead.ok).toBe(true);
    expect(
      (resolvedRead as { value: { events: readonly Record<string, unknown>[] } }).value.events
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "run_undone" })]));
  });

  test("records a failed run-level undo without changing the completed terminal status", async () => {
    const createSession = requireCreateSession();
    let round = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_undo_failure" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo_failure", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo_failure", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_undo_failure") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage2_undo_failure", transactionStatus: "applied" }
          };
        },
        async undoRun() {
          return {
            ok: false as const,
            error: {
              schemaVersion: "1.0",
              errorId: "err_stage2_undo_failure",
              code: "AGENT_RUN_UNDO_FAILED",
              category: "StorageError",
              message: "The run undo failed.",
              recoverability: "retryable",
              suggestedAction: "Retry the failed undo.",
              traceId: "stage2-test",
              createdAt: "2026-07-13T00:00:00.000Z",
              redactedDetail: {
                versionGroupId: "versions_stage2_undo_failure",
                failureKind: "undo_failure",
                writes: [{ relativePath: "notes/outline.md", status: "rollback_failed" }]
              }
            }
          };
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_undo_failure",
      "awaiting_write_approval"
    );
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_undo_failure",
      commandId: "apply-stage2-undo-failure",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage2_undo_failure", "completed");
    const result = await session.undoRun({
      action: "request",
      projectId: "project-01",
      runId: "run_stage2_undo_failure",
      commandId: "undo-stage2-failure",
      expectedRunRevision: completed.runRevision
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_UNDO_FAILED" },
      latestSnapshot: {
        status: "completed",
        runRevision: completed.runRevision + 2,
        lastSequence: completed.lastSequence + 2
      }
    });
    const read = await session.readAgentRun("run_stage2_undo_failure");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "completed" } } });
    const events = (read as { value: { events: readonly Record<string, unknown>[] } }).value.events;
    expect(events.slice(-2)).toMatchObject([
      { type: "run_undo_started", detail: { commandId: "undo-stage2-failure" } },
      {
        type: "run_undo_failed",
        detail: {
          code: "AGENT_RUN_UNDO_FAILED",
          versionGroupId: "versions_stage2_undo_failure",
          failureKind: "undo_failure",
          writes: [{ relativePath: "notes/outline.md", status: "rollback_failed" }]
        }
      }
    ]);
  });

  test("does not let the generic resume command bypass pending write approval", async () => {
    const createSession = requireCreateSession();
    let rounds = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_resume_gate" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          yield toolCall("propose_resume_gate", "propose_file_write", {
            path: "notes/outline.md",
            baseHash: sha256("before\n"),
            range: { unit: "character", start: 0, end: 7 },
            replacement: "after\n"
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_resume_gate") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_resume_gate",
      "awaiting_write_approval"
    );
    const resumed = await session.resumeAgentRun({
      projectId: "project-01",
      runId: "run_stage2_resume_gate",
      commandId: "resume-stage2-gate",
      expectedRunRevision: awaiting.runRevision
    });

    expect(resumed).toMatchObject({
      ok: false,
      error: { code: "AGENT_CHANGE_SET_DECISION_REQUIRED" }
    });
    expect(rounds).toBe(1);
  });

  test("invalidates a pending Change Set when a bound context source changes before apply", async () => {
    const createSession = requireCreateSession();
    let currentContext = "supporting context before";
    let applyCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_stale_context" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      contextSourceReader: {
        async readCurrentSources(input: {
          readonly sources: readonly { readonly refId: string }[];
        }) {
          return {
            ok: true,
            value: input.sources.map((source) => ({
              refId: source.refId,
              content: currentContext
            }))
          };
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_stale_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: currentContext,
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      session,
      "run_stage2_stale_context",
      "awaiting_write_approval"
    );
    currentContext = "supporting context changed";

    const result = await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_stale_context",
      commandId: "apply-stage2-stale-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" },
      latestSnapshot: { status: "awaiting_context_refresh" }
    });
    expect(applyCount).toBe(0);
    expect(await session.readAgentRun("run_stage2_stale_context")).toMatchObject({
      value: { changeSet: { status: "stale" } }
    });
  });

  test("rebuilds historical Packed Context after reload and reports stale or legacy history", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    const source = {
      refId: "file:notes/supporting.md",
      sourceKind: "disk_file" as const,
      relativePath: "notes/supporting.md",
      content: "frozen supporting context",
      dirty: false,
      sourceRevision: 4,
      selectionReason: "Explicit context reference",
      selectionPolicy: "pinned" as const,
      preferenceScope: "run" as const,
      priority: 70
    };
    const profile = applicationExports.resolveAgentContextProfile(
      {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      "execution",
      "general_file"
    );
    const packedContext = packAgentContext({
      profile,
      contextSources: [source],
      modelProfileId: "profile-stage2",
      usedTokens: 20,
      safeInputBudget: 10_000,
      remainingTokens: 9_980,
      precision: "estimated",
      createdAt: "2026-07-31T00:00:00.000Z"
    });
    const basePreflight = echoStartPreflight();
    const sharedOptions = {
      repository,
      modelDriver: {
        async *streamRound() {
          yield toolCall("finish-packed-history", "finish", { summary: "done" });
          yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
        }
      },
      startPreflight: {
        async resolveStart(command: Record<string, unknown>) {
          const resolved = await basePreflight.resolveStart(command);
          return {
            ...resolved,
            value: { ...resolved.value, packedContext }
          };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: { ...unusedChangeSetMethods() },
      versionGroupExecutor: unusedVersionGroupExecutor()
    };
    const firstSession = createSession({
      ...sharedOptions,
      coordinatorOptions: { createRunId: () => "run_packed_history" }
    });

    await firstSession.startAgentRun({ ...startCommand(), initialContextSources: [source] });
    await waitForStatus(firstSession, "run_packed_history", "completed");

    const reloaded = createSession({
      ...sharedOptions,
      contextSourceReader: {
        async readCurrentSources() {
          throw new Error("Historical Packed Context must not read current project files");
        }
      }
    });
    const historical = await reloaded.readAgentRun("run_packed_history");
    expect(historical).toMatchObject({
      ok: true,
      value: {
        packedContextHistory: {
          status: "available",
          packedContext: {
            packedContextId: packedContext.packedContextId,
            payloadChecksum: packedContext.payloadChecksum
          }
        }
      }
    });
    const packedHistory = (
      historical as {
        readonly ok: boolean;
        readonly value?: {
          readonly packedContextHistory?: {
            readonly status: string;
            readonly packedContext?: {
              readonly blocks: readonly { readonly sourceKind: string }[];
            };
          };
        };
      }
    ).value?.packedContextHistory;
    if (packedHistory?.status !== "available" || packedHistory.packedContext === undefined) {
      throw new Error("Expected historical Packed Context to be available.");
    }
    expect(
      packedHistory.packedContext.blocks.every((block) => block.sourceKind !== "system_guidance")
    ).toBe(true);

    const staleRepository = {
      ...repository,
      async readContextSnapshot(runId: string, contextSnapshotId: string) {
        const read = await repository.readContextSnapshot(runId, contextSnapshotId);
        const value = structuredClone(read.value) as Record<string, unknown>;
        const manifest = value["packedContextManifest"] as Record<string, unknown>;
        const blocks = structuredClone(manifest["blocks"]) as Record<string, unknown>[];
        blocks[0] = {
          ...blocks[0],
          checksum: "f".repeat(64),
          blockId: `context_block_${"f".repeat(24)}_0`
        };
        manifest["blocks"] = blocks;
        return { ok: true as const, value };
      }
    };
    const staleSession = createSession({ ...sharedOptions, repository: staleRepository });
    expect(await staleSession.readAgentRun("run_packed_history")).toMatchObject({
      ok: true,
      value: {
        packedContextHistory: { status: "stale", reason: "manifest_invalid" }
      }
    });

    const legacyRepository = {
      ...repository,
      async readContextSnapshot(runId: string, contextSnapshotId: string) {
        const read = await repository.readContextSnapshot(runId, contextSnapshotId);
        const value = structuredClone(read.value) as Record<string, unknown>;
        const current = value["packedContextManifest"] as Record<string, unknown>;
        value["packedContextManifest"] = {
          schemaVersion: "1.0",
          packedContextId: current["packedContextId"],
          payloadChecksum: current["payloadChecksum"],
          blocks: current["blocks"],
          tokenStats: current["tokenStats"]
        };
        return { ok: true as const, value };
      }
    };
    const legacySession = createSession({ ...sharedOptions, repository: legacyRepository });
    expect(await legacySession.readAgentRun("run_packed_history")).toMatchObject({
      ok: true,
      value: {
        packedContextHistory: { status: "unavailable", reason: "legacy_manifest" }
      }
    });
  });

  test("restores the bound context snapshot before approving a reloaded Change Set", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    let currentContext = "persisted context before";
    let applyCount = 0;
    const createOptions = () => ({
      repository,
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      contextSourceReader: {
        async readCurrentSources(input: {
          readonly sources: readonly { readonly refId: string }[];
        }) {
          return {
            ok: true,
            value: input.sources.map((source) => ({
              refId: source.refId,
              content: currentContext
            }))
          };
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_reloaded_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply_after_reload" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });
    const firstSession = createSession({
      ...createOptions(),
      coordinatorOptions: { createRunId: () => "run_stage2_reloaded_context" }
    });

    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: currentContext,
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      firstSession,
      "run_stage2_reloaded_context",
      "awaiting_write_approval"
    );
    currentContext = "persisted context changed";

    const reloadedSession = createSession(createOptions());
    const result = await reloadedSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_reloaded_context",
      commandId: "apply-stage2-reloaded-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" },
      latestSnapshot: { status: "awaiting_context_refresh" }
    });
    expect(applyCount).toBe(0);
  });

  test("fails closed when a reloaded Change Set has no restorable context snapshot", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    let applyCount = 0;
    const sharedOptions = {
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_missing_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply_without_context" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    };
    const firstSession = createSession({
      ...sharedOptions,
      repository,
      coordinatorOptions: { createRunId: () => "run_stage2_missing_context" }
    });
    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: "persist me",
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      firstSession,
      "run_stage2_missing_context",
      "awaiting_write_approval"
    );

    const reloadedSession = createSession({
      ...sharedOptions,
      repository: {
        ...repository,
        async readContextSnapshot() {
          return { ok: true, value: undefined };
        }
      }
    });
    const result = await reloadedSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_missing_context",
      commandId: "apply-stage2-missing-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_SNAPSHOT_UNAVAILABLE" },
      latestSnapshot: { status: "awaiting_write_approval" }
    });
    expect(applyCount).toBe(0);
  });

  test("allocates a new proposal checkpoint after apply, reload, and resume", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    const checkpointIds: string[] = [];
    const changeSetSession = {
      async proposeFileWrite(input: { readonly checkpointId: string }) {
        checkpointIds.push(input.checkpointId);
        return { ok: true, value: pendingChangeSet("run_stage2_checkpoint_reload") };
      },
      ...unusedChangeSetMethods()
    };
    let firstRound = 0;
    const firstSession = createSession({
      repository,
      coordinatorOptions: { createRunId: () => "run_stage2_checkpoint_reload" },
      modelDriver: {
        async *streamRound() {
          firstRound += 1;
          if (firstRound === 1) {
            yield toolCall("proposal-before-reload", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
          } else {
            yield toolCall("pause-before-reload", "request_user_input", {
              questionId: "question_checkpoint_reload",
              prompt: "Continue?",
              reason: "Verify durable checkpoint allocation.",
              options: [
                { id: "continue", label: "Continue" },
                { id: "stop", label: "Stop" }
              ]
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: {
        async apply() {
          return { ok: true, value: { versionGroupId: "vg_checkpoint_reload" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await firstSession.startAgentRun(startCommand());
    const awaitingApproval = await waitForStatus(
      firstSession,
      "run_stage2_checkpoint_reload",
      "awaiting_write_approval"
    );
    await firstSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_checkpoint_reload",
      commandId: "apply-checkpoint-reload",
      expectedRunRevision: awaitingApproval.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const paused = await waitForStatus(
      firstSession,
      "run_stage2_checkpoint_reload",
      "awaiting_user_input"
    );

    const reloadedSession = createSession({
      repository,
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: unusedVersionGroupExecutor()
    });
    await reloadedSession.answerUserInput({
      projectId: "project-01",
      runId: "run_stage2_checkpoint_reload",
      commandId: "answer-checkpoint-reload",
      expectedRunRevision: paused.runRevision,
      questionId: "question_checkpoint_reload",
      answer: "Continue"
    });
    await waitForStatus(reloadedSession, "run_stage2_checkpoint_reload", "awaiting_write_approval");

    expect(checkpointIds).toHaveLength(2);
    expect(checkpointIds[1]).not.toBe(checkpointIds[0]);
  });

  test("restores rejected and abandoned Change Sets as final after reload", async () => {
    const createSession = requireCreateSession();

    for (const terminalDecision of ["rejected", "abandoned"] as const) {
      const runId = `run_stage2_${terminalDecision}`;
      const repository = memoryRepository();
      let round = 0;
      const changeSetSession = {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet(runId) };
        },
        ...unusedChangeSetMethods(),
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "reject_all",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-13T00:00:00.000Z",
              binding: {
                changeSetId: "changes_stage2",
                revision: 1,
                checksum: "checksum_revision_1",
                approvalToken: "approval_stage2"
              }
            }
          };
        }
      };
      const session = createSession({
        repository,
        coordinatorOptions: { createRunId: () => runId },
        modelDriver: {
          async *streamRound() {
            round += 1;
            if (round === 1) {
              yield toolCall("proposal-final-state", "propose_file_write", {
                path: "notes/outline.md",
                baseHash: sha256("before\n"),
                range: { unit: "character", start: 0, end: 7 },
                replacement: "after\n"
              });
            } else {
              yield toolCall("finish-final-state", "finish", { summary: "Rejected." });
            }
            yield { type: "round_completed", finishReason: "tool_calls" };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: unusedVersionGroupExecutor()
      });
      await session.startAgentRun(startCommand());
      const awaiting = await waitForStatus(session, runId, "awaiting_write_approval");
      if (terminalDecision === "rejected") {
        await session.decideChangeSet({
          projectId: "project-01",
          runId,
          commandId: "reject-final-state",
          expectedRunRevision: awaiting.runRevision,
          changeSetId: "changes_stage2",
          revision: 1,
          checksum: "checksum_revision_1",
          decision: "reject_all"
        });
        await waitForStatus(session, runId, "completed");
      } else {
        await session.stopAgentRun({
          projectId: "project-01",
          runId,
          commandId: "stop-final-state",
          expectedRunRevision: awaiting.runRevision
        });
        await waitForStatus(session, runId, "cancelled");
      }

      const reloaded = createSession({
        repository,
        modelDriver: proposalOnlyDriver(),
        startPreflight: echoStartPreflight(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: unusedVersionGroupExecutor()
      });
      expect(await reloaded.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { changeSet: { status: terminalDecision } }
      });
    }
  });

  test("reconciles an applying run with durable transaction recovery after reload", async () => {
    const createSession = requireCreateSession();

    for (const recoveryStatus of ["applied", "none"] as const) {
      const runId = `run_stage2_reconcile_${recoveryStatus}`;
      const repository = memoryRepository();
      const changeSetSession = {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet(runId) };
        },
        ...unusedChangeSetMethods()
      };
      const interrupted = createSession({
        repository,
        coordinatorOptions: { createRunId: () => runId },
        modelDriver: proposalOnlyDriver(),
        startPreflight: echoStartPreflight(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: {
          async apply() {
            return new Promise(() => undefined);
          },
          async undoRun() {
            throw new Error("unused");
          }
        }
      });
      await interrupted.startAgentRun(startCommand());
      const awaiting = await waitForStatus(interrupted, runId, "awaiting_write_approval");
      void interrupted.decideChangeSet({
        projectId: "project-01",
        runId,
        commandId: `apply-reconcile-${recoveryStatus}`,
        expectedRunRevision: awaiting.runRevision,
        changeSetId: "changes_stage2",
        revision: 1,
        checksum: "checksum_revision_1",
        decision: "apply_selected"
      });
      await waitForStatus(interrupted, runId, "applying_changes");

      const reloaded = createSession({
        repository,
        modelDriver: proposalOnlyDriver(),
        startPreflight: echoStartPreflight(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: {
          async apply() {
            throw new Error("unused");
          },
          async undoRun() {
            throw new Error("unused");
          },
          async recoverRun() {
            return {
              ok: true,
              value:
                recoveryStatus === "applied"
                  ? {
                      status: "applied",
                      versionGroup: {
                        versionGroupId: `vg_reconcile_${recoveryStatus}`,
                        transactionStatus: "applied"
                      }
                    }
                  : { status: "none" }
            };
          }
        }
      });
      const read = await reloaded.readAgentRun(runId);

      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: recoveryStatus === "applied" ? "completed" : "failed" },
          changeSet: {
            status: recoveryStatus === "applied" ? "applied" : "awaiting_approval"
          }
        }
      });
    }
  });

  test("keeps approval pending when the Version Group service is unavailable", async () => {
    const createSession = requireCreateSession();
    const session = createSession({
      repository: memoryRepository(),
      coordinatorOptions: { createRunId: () => "run_stage2_no_version_group" },
      modelDriver: proposalOnlyDriver(),
      startPreflight: echoStartPreflight(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_no_version_group") };
        },
        ...unusedChangeSetMethods()
      }
    });
    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_no_version_group",
      "awaiting_write_approval"
    );

    const result = await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_no_version_group",
      commandId: "apply-no-version-group",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_VERSION_GROUP_UNAVAILABLE" }
    });
    expect(await session.readAgentRun("run_stage2_no_version_group")).toMatchObject({
      ok: true,
      value: {
        snapshot: { status: "awaiting_write_approval" },
        events: expect.not.arrayContaining([expect.objectContaining({ type: "approval_resolved" })])
      }
    });
  });
});

function requireCreateSession(): (options: Record<string, unknown>) => SessionShape {
  const value = (applicationExports as unknown as Record<string, unknown>)["createAgentRunSession"];
  expect(typeof value).toBe("function");
  return value as (options: Record<string, unknown>) => SessionShape;
}

interface SessionShape {
  startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  resumeAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  readAgentRun(runId: string): Promise<Record<string, unknown>>;
}

function startCommand(): Record<string, unknown> {
  return {
    projectId: "project-01",
    conversationId: "conv-stage2",
    commandId: "start-stage2",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    userRequest: "Update the outline.",
    providerCapabilitySnapshot: {
      profileId: "profile-stage2",
      provider: "demo",
      modelName: "demo-stage2",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 32_000,
      requiredContextTokens: 1_000
    }
  };
}

/** Echoes wide intent on the start command back as resolved facts (server-authoritative preflight stub). */
function echoStartPreflight() {
  return {
    async resolveStart(command: Record<string, unknown>) {
      const snapshot = (command["providerCapabilitySnapshot"] ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        value: {
          operationMode: command["operationMode"] ?? "execution",
          contextMode: command["contextMode"] ?? "general_file",
          writePolicy: command["writePolicy"] ?? "write_before_confirmation",
          writePolicyAcknowledged: command["writePolicyAcknowledged"] === true,
          userRequest: command["userRequest"] ?? "",
          ...(command["reasoningEffort"] === undefined
            ? {}
            : { requestedReasoningEffort: command["reasoningEffort"] }),
          model: {
            profileId: snapshot["profileId"] ?? "profile-stage2",
            provider: snapshot["provider"] ?? "demo",
            modelName: snapshot["modelName"] ?? "demo-stage2",
            capabilities: {
              streaming: snapshot["streaming"] ?? true,
              toolCalling: snapshot["toolCalling"] ?? true,
              structuredArguments: snapshot["structuredArguments"] ?? true,
              contextWindow: snapshot["contextWindow"] ?? 32_000
            },
            requiredContextTokens: snapshot["requiredContextTokens"] ?? 1_000,
            reasoningStrength: { status: "hidden", reason: "demo model" }
          },
          initialContextSources: command["initialContextSources"] ?? []
        }
      };
    }
  };
}

function pendingChangeSet(
  runId: string,
  writePolicy?: "write_before_confirmation" | "user_preapproved_run"
): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_stage2",
    revision: 1,
    runId,
    checkpointId: "checkpoint_stage2",
    contextSnapshotId: "context_stage2",
    ...(writePolicy === undefined ? {} : { writePolicy }),
    status: "awaiting_approval",
    checksum: "checksum_revision_1",
    approvalToken: "approval_stage2",
    files: [
      {
        relativePath: "notes/outline.md",
        assetType: "text",
        baseChecksum: sha256("before\n"),
        candidateChecksum: sha256("after\n"),
        baseContent: "before\n",
        candidateContent: "after\n",
        hunks: [],
        validation: { valid: true, issues: [] },
        selected: true
      }
    ]
  };
}

function toolCall(toolCallId: string, name: string, value: Record<string, unknown>) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(value)
  };
}

function proposalOnlyDriver() {
  return {
    async *streamRound() {
      yield toolCall("propose_selection", "propose_file_write", {
        path: "notes/outline.md",
        baseHash: sha256("before\n"),
        range: { unit: "character", start: 0, end: 7 },
        replacement: "after\n"
      });
      yield { type: "round_completed", finishReason: "tool_calls" };
    }
  };
}

function workspaceOutlineSource(
  chapterRevision: string,
  storyRevision: string,
  entries: readonly {
    readonly kind: "directory" | "file" | "chapter" | "story_bible_asset";
    readonly id: string;
    readonly label: string;
    readonly relativePath?: string;
  }[] = [],
  options: {
    readonly truncationReasons?: readonly "max_tokens"[];
    readonly degradedDependencies?: readonly ("chapters" | "story_bible")[];
  } = {}
) {
  const truncationReasons = options.truncationReasons ?? [];
  const dependencyEntries = entries.map((entry) =>
    entry.kind === "story_bible_asset" ? { ...entry, assetType: "character" } : entry
  );
  const manifest = {
    schemaVersion: "1.0" as const,
    readerVersion: "1.0" as const,
    profileId: "writing" as const,
    workspace: {
      workspaceId: "project-01",
      workspaceKind: "creativeProject" as const,
      canonicalRootIdentity: sha256("root:project-01")
    },
    limits: {
      maxDepth: 8,
      maxEntries: 200,
      maxScannedEntries: 2_000,
      maxBytes: 128_000,
      maxDurationMs: 1_000,
      maxTokens: 8_000
    },
    truncated: truncationReasons.length > 0,
    truncationReasons,
    dependency: {
      kind: "writing_indexes" as const,
      chapterIndexRevision: chapterRevision,
      chapterIndexChecksum: sha256(chapterRevision),
      storyBibleIndexRevision: storyRevision,
      storyBibleIndexChecksum: sha256(storyRevision),
      degradedDependencies: options.degradedDependencies ?? []
    }
  };
  const create = applicationExports.createWorkspaceOutlineSource;
  return create({
    workspaceTrust: "trusted",
    result: {
      entries: dependencyEntries,
      text: `${chapterRevision}:${storyRevision}`,
      dependencyManifest: manifest,
      dependencyManifestChecksum: applicationExports.checksumProjectContext(manifest),
      materializedChecksum: sha256(`${chapterRevision}:${storyRevision}`),
      tokenCount: 1,
      truncationRange: null
    }
  }).source;
}

function memoryRepository() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>[]>();
  const receipts = new Map<string, Record<string, unknown>>();
  const contextSnapshots = new Map<string, Record<string, unknown>>();
  const promptMaterializations = new Map<string, Record<string, unknown>>();
  const contextSourceMaterializations = new Map<string, Record<string, unknown>>();
  const toolCatalogs = new Map<string, Record<string, unknown>>();
  const budgetSnapshots = new Map<string, Record<string, unknown>>();
  return {
    async writeToolCatalog(runId: string, catalog: Record<string, unknown>) {
      toolCatalogs.set(runId, structuredClone(catalog));
      return { ok: true, value: catalog };
    },
    async readToolCatalog(runId: string) {
      return { ok: true, value: toolCatalogs.get(runId) };
    },
    async writeSnapshot(snapshot: Record<string, unknown>) {
      snapshots.set(String(snapshot["runId"]), snapshot);
      return { ok: true, value: snapshot };
    },
    async appendEvent(event: Record<string, unknown>) {
      const runId = String(event["runId"]);
      events.set(runId, [...(events.get(runId) ?? []), event]);
      return { ok: true, value: event };
    },
    async writeCommandReceipt(runId: string, commandId: string, receipt: Record<string, unknown>) {
      receipts.set(`${runId}:${commandId}`, receipt);
      return { ok: true, value: receipt };
    },
    async readCommandReceipt(runId: string, commandId: string) {
      return { ok: true, value: receipts.get(`${runId}:${commandId}`) };
    },
    async readSnapshot(runId: string) {
      return { ok: true, value: snapshots.get(runId) };
    },
    async readEvents(runId: string) {
      return { ok: true, value: events.get(runId) ?? [] };
    },
    async writeContextSnapshot(snapshot: Record<string, unknown>) {
      const key = `${String(snapshot["runId"])}:${String(snapshot["contextSnapshotId"])}`;
      contextSnapshots.set(key, snapshot);
      return { ok: true, value: snapshot };
    },
    async readContextSnapshot(runId: string, contextSnapshotId: string) {
      return { ok: true, value: contextSnapshots.get(`${runId}:${contextSnapshotId}`) };
    },
    async writePromptMaterialization(runId: string, artifact: Record<string, unknown>) {
      promptMaterializations.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true, value: artifact };
    },
    async readPromptMaterialization(runId: string, artifactId: string) {
      return { ok: true, value: promptMaterializations.get(`${runId}:${artifactId}`) };
    },
    async writeContextSourceMaterialization(runId: string, artifact: Record<string, unknown>) {
      contextSourceMaterializations.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true, value: artifact };
    },
    async readContextSourceMaterialization(runId: string, artifactId: string) {
      return {
        ok: true,
        value: contextSourceMaterializations.get(`${runId}:${artifactId}`)
      };
    },
    async writeBudgetSnapshot(runId: string, snapshot: Record<string, unknown>) {
      budgetSnapshots.set(
        `${runId}:${String(snapshot["contextBudgetSnapshotId"])}`,
        structuredClone(snapshot)
      );
      return { ok: true, value: snapshot };
    },
    async readBudgetSnapshot(runId: string, contextBudgetSnapshotId: string) {
      return { ok: true, value: budgetSnapshots.get(`${runId}:${contextBudgetSnapshotId}`) };
    }
  };
}

function unusedReadExecutor() {
  return {
    async execute() {
      throw new Error("proposal must not use the read executor");
    }
  };
}

function unusedChangeSetMethods() {
  return {
    async proposeChapterWrite() {
      throw new Error("unused");
    },
    async selectRevision() {
      throw new Error("unused");
    },
    async readChangeSet() {
      throw new Error("unused");
    },
    async decide() {
      return {
        ok: true,
        value: {
          schemaVersion: "1.0",
          decision: "apply_selected",
          approvalSource: "human_confirmation",
          resolvedAt: "2026-07-13T00:00:00.000Z",
          binding: {
            changeSetId: "changes_stage2",
            revision: 1,
            checksum: "checksum_revision_1",
            approvalToken: "approval_stage2"
          }
        }
      };
    }
  };
}

function unusedVersionGroupExecutor() {
  return {
    async apply() {
      throw new Error("proposal must not apply a Version Group");
    },
    async undoRun() {
      throw new Error("proposal must not undo a Version Group");
    }
  };
}

async function waitForStatus(
  session: SessionShape,
  runId: string,
  status: string
): Promise<{ readonly runRevision: number; readonly lastSequence: number }> {
  let snapshot: { readonly runRevision: number; readonly lastSequence: number } | undefined;
  await vi.waitFor(async () => {
    const read = await session.readAgentRun(runId);
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status } } });
    snapshot = (read as { value: { snapshot: { runRevision: number; lastSequence: number } } })
      .value.snapshot;
  });
  if (snapshot === undefined) throw new Error(`Run ${runId} never reached ${status}.`);
  return snapshot;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function storageError(code: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    errorId: `err_${code.toLowerCase()}`,
    code,
    category: "StorageError",
    message: "The command receipt could not be persisted.",
    recoverability: "retryable",
    suggestedAction: "Retry after storage is available.",
    traceId: "stage2-test",
    createdAt: "2026-07-13T00:00:00.000Z"
  };
}
