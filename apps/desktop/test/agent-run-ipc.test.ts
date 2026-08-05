import { describe, expect, test, vi } from "vitest";

import type { DesktopApplication } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createCreativeGeneralActiveResourceProof } from "../src/main/creative-general-active-resource-proof.js";
import { createNovelStudioApi } from "../src/preload/api.js";

describe("Agent Run IPC", () => {
  test("updates workspace context policy through the active runtime binding", async () => {
    const disableConventions = vi.fn(async () =>
      ok({
        workspaceTrust: "trusted" as const,
        projectConventionsEnabled: false,
        policyRevision: "policy-02"
      })
    );
    const revokeTrust = vi.fn(async () =>
      ok({
        workspaceTrust: "untrusted" as const,
        projectConventionsEnabled: false,
        policyRevision: "policy-03"
      })
    );
    const setSourcePreference = vi.fn(async () =>
      ok({
        workspaceTrust: "untrusted" as const,
        projectConventionsEnabled: false,
        sourcePreferences: [
          { refId: "story_bible:chr_hero", decision: "pinned" as const, priority: 80 }
        ],
        policyRevision: "policy-04"
      })
    );
    const refreshCurrentWorkspace = vi.fn(async () => ok(undefined));
    const revokeCurrentSettingsCapabilities = vi.fn();
    const manager = {
      active: () => ({
        scope: "workspace" as const,
        binding: {
          kind: "engineeringWorkspace" as const,
          workspaceId: "workspace-active",
          contentRoot: "C:/workspace-active",
          stateRoot: "C:/workspace-active-state"
        },
        runtime: {}
      }),
      current: () => undefined,
      currentWorkspace: () => undefined,
      subscribeAgentRunEvents: () => () => undefined,
      refreshCurrentWorkspace,
      revokeCurrentSettingsCapabilities
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: manager,
        workspaceContextPolicyStore: {
          disableConventions,
          revokeTrust,
          setSourcePreference
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const update = handlers["application:workspace:update-context-policy"];
    if (update === undefined) throw new Error("Missing workspace policy handler");

    await expect(
      update({ action: "disable_conventions", workspaceId: "renderer-controlled" })
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(disableConventions).toHaveBeenCalledWith({
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace-active",
      contentRoot: "C:/workspace-active"
    });
    expect(refreshCurrentWorkspace).toHaveBeenCalledOnce();
    expect(revokeCurrentSettingsCapabilities).not.toHaveBeenCalled();

    await expect(update({ action: "revoke_workspace_trust" })).resolves.toEqual({
      ok: true,
      value: undefined
    });
    expect(revokeTrust).toHaveBeenCalledWith({
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace-active",
      contentRoot: "C:/workspace-active"
    });

    await expect(
      update({
        action: "set_source_preference",
        preference: {
          refId: "story_bible:chr_hero",
          decision: "pinned",
          priority: 80
        }
      })
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(setSourcePreference).toHaveBeenCalledWith(
      {
        workspaceKind: "engineeringWorkspace",
        workspaceId: "workspace-active",
        contentRoot: "C:/workspace-active"
      },
      {
        refId: "story_bible:chr_hero",
        decision: "pinned",
        priority: 80
      }
    );
    expect(refreshCurrentWorkspace).toHaveBeenCalledTimes(3);

    await expect(
      update({
        action: "set_source_preference",
        preference: {
          refId: "file:escape",
          decision: "pinned",
          priority: 50,
          ref: {
            kind: "project_file",
            refId: "file:escape",
            relativePath: "../outside.md",
            label: "Outside"
          }
        }
      })
    ).resolves.toMatchObject({ ok: false });
    expect(setSourcePreference).toHaveBeenCalledOnce();
    expect(refreshCurrentWorkspace).toHaveBeenCalledTimes(3);
  });

  test("requires a Main-attested Files surface and exact active resource for creative general drafts", async () => {
    const identity = { projectId: "project-record-01", workspaceId: "workspace-creative-01" };
    const path = "notes/outline.md";
    const initialChecksum = "a".repeat(64);
    const savedChecksum = "b".repeat(64);
    let diskChecksum = initialChecksum;
    const document = () => ({
      schemaVersion: "1.0" as const,
      ...identity,
      path,
      content: "Outline",
      checksum: diskChecksum,
      byteLength: 7,
      nodeRevision: `node-${diskChecksum.slice(0, 8)}`
    });
    const fileSession = {
      getActiveIdentity: () => identity,
      async refresh() {
        return ok({
          schemaVersion: "1.0" as const,
          ...identity,
          treeRevision: "tree-01",
          nodes: [],
          truncated: false,
          truncationReasons: [],
          dependencyManifestChecksum: "c".repeat(64)
        });
      },
      async readTextFile() {
        return ok(document());
      },
      async saveTextFile() {
        diskChecksum = savedChecksum;
        return ok({ kind: "saved" as const, document: document(), treeRevision: "tree-02" });
      }
    };
    const draftCalls: string[] = [];
    const runtime = {
      workspaceId: identity.workspaceId,
      projectId: identity.workspaceId,
      projectRoot: "C:/creative-project",
      agentRunDraftSession: {
        async syncStartDraft() {
          draftCalls.push("sync");
          return ok({});
        },
        async updateAgentRunDraft(command: { readonly commandId: string }) {
          draftCalls.push("mode");
          if (command.commandId === "mode-writing-fails-01") {
            return { ok: false, error: { code: "DRAFT_WRITE_FAILED" } } as never;
          }
          return ok({});
        },
        async updateContextDraft() {
          draftCalls.push("resource");
          return ok({});
        }
      }
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          active: () => ({
            scope: "workspace" as const,
            binding: {
              kind: "creativeProject" as const,
              workspaceId: identity.workspaceId,
              contentRoot: "C:/creative-project",
              stateRoot: "C:/creative-project"
            },
            runtime
          }),
          current: () => runtime,
          subscribeAgentRunEvents: () => () => undefined
        },
        creativeProjectFileSession: fileSession,
        creativeGeneralActiveResourceProof: createCreativeGeneralActiveResourceProof()
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const updateRunDraft = handlers["application:agent-run:update-run-draft"];
    const updateContextDraft = handlers["application:agent-run:update-context-draft"];
    const syncStartDraft = handlers["application:agent-run:prepare-start"];
    const refreshFiles = handlers["application:creative-project-files:refresh"];
    const readFile = handlers["application:creative-project-files:read-text-file"];
    const saveFile = handlers["application:creative-project-files:save-text-file"];
    if (
      updateRunDraft === undefined ||
      updateContextDraft === undefined ||
      syncStartDraft === undefined ||
      refreshFiles === undefined ||
      readFile === undefined ||
      saveFile === undefined
    ) {
      throw new Error("Missing creative general IPC handlers");
    }

    const modeCommand = {
      projectId: identity.workspaceId,
      conversationId: "conversation-01",
      commandId: "mode-general-01",
      expectedDraftRevision: 1,
      mutation: { kind: "set_context_mode" as const, contextMode: "general_file" as const }
    };
    const emptyGeneralStart = {
      projectId: identity.workspaceId,
      conversationId: "conversation-01",
      commandId: "sync-general-01",
      userRequest: "Inspect files",
      operationMode: "planning" as const,
      contextMode: "general_file" as const,
      writePolicy: "write_before_confirmation" as const,
      writePolicyAcknowledged: false,
      modelProfileId: "profile-01",
      contextRefs: [],
      activeResourceRef: null
    };
    const activeResource = (checksum: string) => ({
      kind: "project_file" as const,
      refId: `file:${path}`,
      relativePath: path,
      label: "outline.md",
      expectedChecksum: checksum
    });

    await expect(updateRunDraft(modeCommand)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED" }
    });
    await expect(syncStartDraft(emptyGeneralStart)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED" }
    });
    expect(draftCalls).toEqual([]);

    await expect(refreshFiles(identity)).resolves.toMatchObject({ ok: true });
    await expect(updateRunDraft(modeCommand)).resolves.toMatchObject({ ok: true });
    await expect(syncStartDraft(emptyGeneralStart)).resolves.toMatchObject({ ok: true });
    await expect(
      updateContextDraft({
        projectId: identity.workspaceId,
        conversationId: "conversation-01",
        commandId: "resource-unread-01",
        contextDraftId: "context-01",
        expectedDraftRevision: 1,
        mutation: { kind: "set_active_resource", ref: activeResource(initialChecksum) }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED" }
    });

    await expect(readFile({ ...identity, path })).resolves.toMatchObject({ ok: true });
    await expect(
      updateContextDraft({
        projectId: identity.workspaceId,
        conversationId: "conversation-01",
        commandId: "resource-verified-01",
        contextDraftId: "context-01",
        expectedDraftRevision: 1,
        mutation: { kind: "set_active_resource", ref: activeResource(initialChecksum) }
      })
    ).resolves.toMatchObject({ ok: true });

    diskChecksum = savedChecksum;
    await expect(
      updateContextDraft({
        projectId: identity.workspaceId,
        conversationId: "conversation-01",
        commandId: "resource-stale-01",
        contextDraftId: "context-01",
        expectedDraftRevision: 2,
        mutation: { kind: "set_active_resource", ref: activeResource(initialChecksum) }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED" }
    });

    diskChecksum = initialChecksum;
    await expect(
      saveFile({
        ...identity,
        path,
        content: "Updated outline",
        expectedTreeRevision: "tree-01",
        expectedNodeRevision: "node-aaaaaaaa",
        expectedChecksum: initialChecksum
      })
    ).resolves.toMatchObject({ ok: true, value: { kind: "saved" } });
    await expect(
      updateContextDraft({
        projectId: identity.workspaceId,
        conversationId: "conversation-01",
        commandId: "resource-saved-01",
        contextDraftId: "context-01",
        expectedDraftRevision: 3,
        mutation: { kind: "set_active_resource", ref: activeResource(savedChecksum) }
      })
    ).resolves.toMatchObject({ ok: true });

    await expect(
      updateRunDraft({
        ...modeCommand,
        commandId: "mode-writing-fails-01",
        mutation: { kind: "set_context_mode", contextMode: "writing" }
      })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      updateRunDraft({ ...modeCommand, commandId: "mode-general-after-failed-writing-01" })
    ).resolves.toMatchObject({ ok: true });

    await expect(
      updateRunDraft({
        ...modeCommand,
        commandId: "mode-writing-01",
        mutation: { kind: "set_context_mode", contextMode: "writing" }
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      updateRunDraft({ ...modeCommand, commandId: "mode-general-after-writing-01" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED" }
    });
    await expect(refreshFiles(identity)).resolves.toMatchObject({ ok: true });
    await expect(
      updateRunDraft({ ...modeCommand, commandId: "mode-general-after-refresh-01" })
    ).resolves.toMatchObject({ ok: true });
    expect(draftCalls).toEqual([
      "mode",
      "sync",
      "resource",
      "resource",
      "mode",
      "mode",
      "mode",
      "mode"
    ]);
  });

  test("rejects a creative writing-plan approval that switches to general file context", async () => {
    let sourceContextMode: "writing" | "general_file" = "writing";
    const decidePlan = vi.fn(async () => ok({ forwarded: true }));
    const session = {
      async readAgentRun() {
        return ok({
          snapshot: { ...snapshot("plan_ready", 5, 5), contextMode: sourceContextMode },
          events: []
        });
      },
      decidePlan,
      subscribe: () => () => undefined
    };
    const runtime = { agentRunSession: session };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          active: () => ({
            scope: "workspace" as const,
            binding: {
              kind: "creativeProject" as const,
              workspaceId: "project-01",
              contentRoot: "C:/creative-project",
              stateRoot: "C:/creative-project"
            },
            runtime
          }),
          current: () => runtime,
          subscribeAgentRunEvents: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const decide = handlers["application:agent-run:decide-plan"];
    if (decide === undefined) throw new Error("Missing decide plan handler");
    const command = {
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "plan-general-01",
      expectedRunRevision: 5,
      planId: "plan-01",
      planRevision: 1,
      decision: "approve" as const,
      executionContextMode: "general_file" as const
    };

    await expect(
      decide({
        ...command,
        commandId: "plan-forged-preapproval-01",
        executionWritePolicy: "user_preapproved_run",
        executionWritePolicyAcknowledged: true
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_IPC_UNAVAILABLE" }
    });
    expect(decidePlan).not.toHaveBeenCalled();

    await expect(decide(command)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_REPREFLIGHT_REQUIRED" }
    });
    expect(decidePlan).not.toHaveBeenCalled();

    sourceContextMode = "general_file";
    await expect(decide({ ...command, commandId: "plan-general-02" })).resolves.toEqual({
      ok: true,
      value: { forwarded: true }
    });
    expect(decidePlan).toHaveBeenCalledOnce();
  });

  test("forwards clone-safe commands and publishes the persisted AgentRunEvent stream", async () => {
    const calls: string[] = [];
    let subscriber: ((event: Record<string, unknown>) => void) | undefined;
    const published: Record<string, unknown>[] = [];
    const session = {
      async startAgentRun(command: Record<string, unknown>) {
        calls.push(`start:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 1, 1) };
      },
      async stopAgentRun(command: Record<string, unknown>) {
        calls.push(`stop:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("cancelled", 2, 2) };
      },
      async answerUserInput(command: Record<string, unknown>) {
        calls.push(`answer:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 3, 3) };
      },
      async resumeAgentRun(command: Record<string, unknown>) {
        calls.push(`resume:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 4, 4) };
      },
      async retryStep(command: Record<string, unknown>) {
        calls.push(`retry:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 5, 5) };
      },
      async retryRunTarget(command: Record<string, unknown>) {
        const target = command["target"] as Record<string, unknown>;
        calls.push(
          `retry-target:${String(command["commandId"])}:${String(command["errorId"])}:${String(
            target["kind"]
          )}:${String(target["id"])}`
        );
        return { ok: true, value: snapshot("planning_model", 5, 5) };
      },
      async decidePlan(command: Record<string, unknown>) {
        calls.push(`plan:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("executing_model", 6, 6) };
      },
      async refreshContext(command: Record<string, unknown>) {
        calls.push(`context:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 7, 7) };
      },
      async decideChangeSet(command: Record<string, unknown>) {
        calls.push(
          `change-set:${String(command["commandId"])}:${String(command["revision"])}:${String(
            command["checksum"]
          )}`
        );
        return { ok: true, value: snapshot("applying_changes", 8, 8) };
      },
      async undoRun(command: Record<string, unknown>) {
        calls.push(`undo:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("completed", 9, 9) };
      },
      async readAgentRun(runId: string) {
        calls.push(`read:${runId}`);
        return { ok: true, value: { snapshot: snapshot("planning_model", 3, 3), events: [] } };
      },
      async listAgentRuns(scopeOrProjectId: unknown) {
        calls.push(
          `list:${
            typeof scopeOrProjectId === "string"
              ? scopeOrProjectId
              : JSON.stringify(scopeOrProjectId)
          }`
        );
        return { ok: true, value: [snapshot("planning_model", 3, 3)] };
      },
      subscribe(listener: (event: Record<string, unknown>) => void) {
        subscriber = listener;
        return () => {
          subscriber = undefined;
        };
      }
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: session,
        publishAgentRunEvent: (event: Record<string, unknown>) => published.push(event)
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const startCommand = {
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "start-01",
      expectedRunRevision: 0,
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "checksum-01",
      packedContextId: "packed_context_0123456789abcdef0123456789abcdef",
      packedContextPayloadChecksum: "a".repeat(64)
    };
    expect(typeof handlers["application:agent-run:start"]).toBe("function");
    expect(typeof handlers["application:agent-run:stop"]).toBe("function");
    expect(typeof handlers["application:agent-run:answer-user-input"]).toBe("function");
    expect(typeof handlers["application:agent-run:resume"]).toBe("function");
    expect(typeof handlers["application:agent-run:retry-step"]).toBe("function");
    expect(typeof handlers["application:agent-run:retry-target"]).toBe("function");
    expect(typeof handlers["application:agent-run:decide-plan"]).toBe("function");
    expect(typeof handlers["application:agent-run:refresh-context"]).toBe("function");
    expect(typeof handlers["application:agent-run:decide-change-set"]).toBe("function");
    expect(typeof handlers["application:agent-run:undo"]).toBe("function");
    expect(typeof handlers["application:agent-run:read"]).toBe("function");
    expect(typeof handlers["application:agent-run:list"]).toBe("function");
    if (
      handlers["application:agent-run:start"] === undefined ||
      handlers["application:agent-run:stop"] === undefined ||
      handlers["application:agent-run:answer-user-input"] === undefined ||
      handlers["application:agent-run:resume"] === undefined ||
      handlers["application:agent-run:retry-step"] === undefined ||
      handlers["application:agent-run:retry-target"] === undefined ||
      handlers["application:agent-run:decide-plan"] === undefined ||
      handlers["application:agent-run:refresh-context"] === undefined ||
      handlers["application:agent-run:decide-change-set"] === undefined ||
      handlers["application:agent-run:undo"] === undefined ||
      handlers["application:agent-run:read"] === undefined ||
      handlers["application:agent-run:list"] === undefined
    )
      return;

    expect(await handlers["application:agent-run:start"](startCommand)).toMatchObject({ ok: true });
    const callsAfterStart = calls.length;
    expect(
      await handlers["application:agent-run:start"]({
        ...startCommand,
        commandId: "start-missing-packed-checksum",
        packedContextPayloadChecksum: undefined
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_UNAVAILABLE" } });
    expect(
      await handlers["application:agent-run:start"]({
        ...startCommand,
        commandId: "start-invalid-packed-checksum",
        packedContextPayloadChecksum: "not-a-checksum"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_UNAVAILABLE" } });
    expect(calls).toHaveLength(callsAfterStart);
    await handlers["application:agent-run:answer-user-input"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "answer-01",
      expectedRunRevision: 2,
      questionId: "question-01",
      answer: "保留"
    });
    await handlers["application:agent-run:resume"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "resume-01",
      expectedRunRevision: 3
    });
    await handlers["application:agent-run:retry-step"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "retry-01",
      expectedRunRevision: 4
    });
    await handlers["application:agent-run:retry-target"]({
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "retry-target-01",
      expectedRunRevision: 4,
      errorId: "err-ipc-01",
      target: { kind: "tool_call", id: "call:read/1" }
    });
    const callsAfterExplicitRetry = calls.length;
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-invalid",
        expectedRunRevision: 4,
        errorId: "err-ipc-01",
        target: { kind: "shell", id: "tool-ipc-01" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-missing-error",
        expectedRunRevision: 4,
        target: { kind: "tool_call", id: "tool-ipc-01" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-too-long",
        expectedRunRevision: 4,
        errorId: "err-ipc-01",
        target: { kind: "tool_call", id: "x".repeat(513) }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(calls).toHaveLength(callsAfterExplicitRetry);
    await handlers["application:agent-run:decide-plan"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "plan-01",
      expectedRunRevision: 5,
      planId: "plan-01",
      planRevision: 1,
      decision: "approve"
    });
    await handlers["application:agent-run:refresh-context"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "context-01",
      expectedRunRevision: 6,
      decision: "refresh"
    });
    const decideCommand = {
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "change-set-01",
      expectedRunRevision: 7,
      changeSetId: "cs-01",
      revision: 4,
      checksum: "checksum-r4",
      decision: "apply_selected"
    };
    const firstDecision = await handlers["application:agent-run:decide-change-set"](
      structuredClone(decideCommand)
    );
    const duplicateDecision = await handlers["application:agent-run:decide-change-set"](
      structuredClone(decideCommand)
    );
    expect(() => structuredClone(firstDecision)).not.toThrow();
    expect(duplicateDecision).toEqual(firstDecision);
    await handlers["application:agent-run:undo"]({
      action: "request",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-01",
      expectedRunRevision: 9
    });
    await handlers["application:agent-run:read"]("run-ipc");
    await handlers["application:agent-run:list"]("project-01");
    await handlers["application:agent-run:list"]({ kind: "standalone", scopeId: "standalone" });
    await handlers["application:agent-run:stop"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "stop-01",
      expectedRunRevision: 3
    });

    const event = {
      schemaVersion: "1.0",
      runId: "run-ipc",
      projectId: "project-01",
      sequence: 2,
      runRevision: 2,
      type: "user_input_requested",
      createdAt: "2026-07-13T00:00:00.000Z",
      detail: { questionId: "question-01", prompt: "保留？" }
    };
    subscriber?.(event);
    expect(() => structuredClone(published[0])).not.toThrow();
    expect(published).toEqual([event]);
    expect(calls).toEqual([
      "start:start-01",
      "answer:answer-01",
      "resume:resume-01",
      "retry:retry-01",
      "retry-target:retry-target-01:err-ipc-01:tool_call:call:read/1",
      "plan:plan-01",
      "context:context-01",
      "change-set:change-set-01:4:checksum-r4",
      "change-set:change-set-01:4:checksum-r4",
      "undo:undo-01",
      "read:run-ipc",
      "list:project-01",
      'list:{"kind":"standalone","scopeId":"standalone"}',
      "stop:stop-01"
    ]);
  });

  test("holds the active runtime start lease until delayed preflight settles", async () => {
    let startEntered: (() => void) | undefined;
    const startStarted = new Promise<void>((resolve) => {
      startEntered = resolve;
    });
    let finishStart: ((value: unknown) => void) | undefined;
    const startFinished = new Promise<unknown>((resolve) => {
      finishStart = resolve;
    });
    const session = {
      async startAgentRun() {
        startEntered?.();
        return startFinished;
      }
    };
    let leaseCount = 0;
    let releaseCount = 0;
    const runtime = { agentRunSession: session };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          active: () => ({ scope: "workspace", binding: {}, runtime }),
          acquireActiveRunStartLease() {
            leaseCount += 1;
            let released = false;
            return {
              ok: true,
              value: {
                session,
                release() {
                  if (released) return;
                  released = true;
                  releaseCount += 1;
                }
              }
            };
          },
          subscribeAgentRunEvents: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const started = handlers["application:agent-run:start"]({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "start-lease-01",
      expectedRunRevision: 0,
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "checksum-01",
      packedContextId: "packed_context_0123456789abcdef0123456789abcdef",
      packedContextPayloadChecksum: "a".repeat(64)
    });
    await startStarted;
    expect(leaseCount).toBe(1);
    expect(releaseCount).toBe(0);

    finishStart?.({ ok: true, value: snapshot("planning_model", 1, 1) });
    await expect(started).resolves.toMatchObject({ ok: true });
    expect(releaseCount).toBe(1);
  });

  test("preload exposes typed Agent Run commands and filters event payloads", async () => {
    const invoked: string[] = [];
    let eventListener: ((payload: unknown) => void) | undefined;
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on(channel, listener) {
        expect(channel).toBe("application:agent-run:event");
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }
    }) as unknown as Record<string, unknown>;
    const agentRuns = api["agentRuns"] as
      Record<string, (...args: unknown[]) => unknown> | undefined;
    expect(agentRuns).toBeDefined();
    if (agentRuns === undefined) return;
    expect(typeof agentRuns["start"]).toBe("function");
    expect(typeof agentRuns["stop"]).toBe("function");
    expect(typeof agentRuns["answerUserInput"]).toBe("function");
    expect(typeof agentRuns["resume"]).toBe("function");
    expect(typeof agentRuns["retryStep"]).toBe("function");
    expect(typeof agentRuns["retryTarget"]).toBe("function");
    expect(typeof agentRuns["decidePlan"]).toBe("function");
    expect(typeof agentRuns["refreshContext"]).toBe("function");
    expect(typeof agentRuns["decideChangeSet"]).toBe("function");
    expect(typeof agentRuns["undoRun"]).toBe("function");
    expect(typeof agentRuns["read"]).toBe("function");
    expect(typeof agentRuns["list"]).toBe("function");
    expect(typeof agentRuns["onEvent"]).toBe("function");

    const received: unknown[] = [];
    const unsubscribe = agentRuns["onEvent"]?.((event: unknown) => received.push(event));
    eventListener?.({ nope: true });
    const validEvent = {
      schemaVersion: "1.0",
      runId: "run-ipc",
      projectId: "project-01",
      sequence: 1,
      runRevision: 1,
      type: "run_started",
      createdAt: "2026-07-13T00:00:00.000Z"
    };
    eventListener?.(validEvent);
    expect(received).toEqual([validEvent]);
    if (typeof unsubscribe === "function") unsubscribe();

    await agentRuns["start"]?.({});
    await agentRuns["stop"]?.({});
    await agentRuns["answerUserInput"]?.({});
    await agentRuns["resume"]?.({});
    await agentRuns["retryStep"]?.({});
    await agentRuns["retryTarget"]?.({});
    await agentRuns["decidePlan"]?.({});
    await agentRuns["refreshContext"]?.({});
    await agentRuns["decideChangeSet"]?.({});
    await agentRuns["undoRun"]?.({});
    await agentRuns["read"]?.("run-ipc");
    await agentRuns["list"]?.("project-01");
    expect(invoked).toEqual([
      "application:agent-run:start",
      "application:agent-run:stop",
      "application:agent-run:answer-user-input",
      "application:agent-run:resume",
      "application:agent-run:retry-step",
      "application:agent-run:retry-target",
      "application:agent-run:decide-plan",
      "application:agent-run:refresh-context",
      "application:agent-run:decide-change-set",
      "application:agent-run:undo",
      "application:agent-run:read",
      "application:agent-run:list"
    ]);
  });

  test("reads permission summaries from persisted draft facts or a bound run and decides plan revisions", async () => {
    const calls: Array<{ readonly name: string; readonly value: unknown }> = [];
    const summary = {
      schemaVersion: "1.0",
      permissionSummaryId: "permission-summary-01",
      projectId: "project-01",
      runDraftId: "draft-01",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter"],
      proposalCapabilities: ["propose_chapter_write"],
      forbiddenCapabilities: ["shell", "git", "network"],
      checksum: "c".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    };
    const runtime = {
      workspaceId: "project-01",
      projectId: "project-01",
      projectRoot: "C:/project",
      agentRunDraftSession: {
        async resolveStartDraft(command: Record<string, unknown>) {
          calls.push({ name: "resolve-draft", value: structuredClone(command) });
          return {
            ok: true,
            value: {
              runDraft: {
                runDraftId: "draft-01",
                revision: 3,
                checksum: "draft-checksum-03",
                operationMode: "execution",
                contextMode: "writing",
                writePolicy: "write_before_confirmation"
              },
              contextDraft: { contextDraftId: "context-01", revision: 2 }
            }
          };
        }
      },
      agentPermissionSession: {
        async prepareForDraft(input: Record<string, unknown>) {
          calls.push({ name: "prepare-permission", value: structuredClone(input) });
          return { ok: true, value: summary };
        },
        async readForRun(input: Record<string, unknown>) {
          calls.push({ name: "read-permission", value: structuredClone(input) });
          return { ok: true, value: { ...summary, runId: "run-01" } };
        }
      },
      agentRunSession: {
        async decidePlanRevision(command: Record<string, unknown>) {
          calls.push({ name: "decide-plan-revision", value: structuredClone(command) });
          return { ok: true, value: snapshot("executing_model", 8, 8) };
        },
        subscribe: () => () => undefined
      },
      agentConversationSession: {}
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => runtime,
          currentWorkspace: () => ({
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.projectRoot,
            stateRoot: runtime.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const draftResult = await handlers["application:agent-run:read-permission-summary"]?.({
      kind: "draft",
      projectId: "project-01",
      conversationId: "conversation-01",
      runDraftId: "draft-01",
      runDraftRevision: 3,
      runDraftChecksum: "draft-checksum-03"
    });
    const runResult = await handlers["application:agent-run:read-permission-summary"]?.({
      kind: "run",
      projectId: "project-01",
      runId: "run-01",
      permissionSummaryId: "permission-summary-01"
    });
    const decision = {
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      projectId: "project-01",
      runId: "run-01",
      commandId: "plan-revision-decision-01",
      expectedRunRevision: 7,
      requestId: "request-01",
      planId: "plan-01",
      planRevision: 2,
      decision: "approve"
    };
    const decisionResult = await handlers["application:agent-run:decide-plan-revision"]?.(
      structuredClone(decision)
    );

    expect(draftResult).toMatchObject({ ok: true, value: summary });
    expect(runResult).toMatchObject({ ok: true, value: { runId: "run-01" } });
    expect(decisionResult).toMatchObject({ ok: true });
    expect(calls).toEqual([
      {
        name: "resolve-draft",
        value: {
          projectId: "project-01",
          conversationId: "conversation-01",
          runDraftId: "draft-01",
          runDraftRevision: 3,
          runDraftChecksum: "draft-checksum-03"
        }
      },
      {
        name: "prepare-permission",
        value: {
          projectId: "project-01",
          runDraftId: "draft-01",
          runDraftRevision: 3,
          operationMode: "execution",
          contextMode: "writing",
          writePolicy: "write_before_confirmation"
        }
      },
      {
        name: "read-permission",
        value: { runId: "run-01", permissionSummaryId: "permission-summary-01" }
      },
      { name: "decide-plan-revision", value: decision }
    ]);
  });

  test("preload exposes the permission summary and plan revision channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      }
    });

    await api.agentRuns.readPermissionSummary({
      kind: "run",
      projectId: "project-01",
      runId: "run-01",
      permissionSummaryId: "permission-summary-01"
    });
    await api.agentRuns.decidePlanRevision({
      projectId: "project-01",
      runId: "run-01",
      commandId: "decision-01",
      expectedRunRevision: 7,
      requestId: "request-01",
      planId: "plan-01",
      planRevision: 2,
      decision: "reject"
    });

    expect(invoked).toEqual([
      "application:agent-run:read-permission-summary",
      "application:agent-run:decide-plan-revision"
    ]);
  });

  test("rejects malformed Change Set decisions before the session boundary", async () => {
    let called = false;
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: {
          decideChangeSet: async () => {
            called = true;
            return { ok: true, value: snapshot("applying_changes", 8, 8) };
          },
          subscribe: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const result = await handlers["application:agent-run:decide-change-set"]?.({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "change-set-invalid",
      expectedRunRevision: 7,
      changeSetId: "cs-01",
      revision: 4,
      checksum: "checksum-r4",
      decision: "write_candidate_body",
      candidateText: "must never cross IPC"
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false });
  });

  test("routes only strictly bound context-sharing decisions to the active session", async () => {
    const received: Record<string, unknown>[] = [];
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: {
          async decideContextShareApproval(command: Record<string, unknown>) {
            received.push(command);
            return { ok: true, value: snapshot("executing_model", 9, 9) };
          },
          subscribe: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const command = {
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "context-share-decision-01",
      expectedRunRevision: 8,
      requestId: "context-share-request-01",
      approvalBinding: "a".repeat(64),
      decision: "approve"
    };

    const resolved =
      await handlers["application:agent-run:decide-context-share-approval"]?.(command);
    const rejected = await handlers["application:agent-run:decide-context-share-approval"]?.({
      ...command,
      commandId: "context-share-invalid-01",
      resultBody: "must never cross IPC"
    });

    expect(resolved).toMatchObject({ ok: true });
    expect(rejected).toMatchObject({ ok: false });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject(command);
  });

  test("validates discriminated rollback review commands before the session boundary", async () => {
    const received: Record<string, unknown>[] = [];
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: {
          async undoRun(command: Record<string, unknown>) {
            received.push(command);
            return { ok: true, value: snapshot("completed", 10, 10) };
          },
          subscribe: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const resolved = await handlers["application:agent-run:undo"]?.({
      action: "resolve",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-resolve-01",
      expectedRunRevision: 9,
      reviewId: "rollback-review-01",
      decisions: [{ relativePath: "notes/outline.md", decision: "restore_baseline" }]
    });
    const invalid = await handlers["application:agent-run:undo"]?.({
      action: "resolve",
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-resolve-invalid",
      expectedRunRevision: 9,
      reviewId: "rollback-review-01",
      decisions: [{ relativePath: "notes/outline.md", decision: "overwrite_current" }],
      candidateText: "must never cross IPC"
    });

    expect(resolved).toMatchObject({ ok: true });
    expect(invalid).toMatchObject({ ok: false });
    expect(received).toEqual([
      {
        action: "resolve",
        scope: {
          kind: "workspace",
          workspaceKind: "creativeProject",
          workspaceId: "project-01"
        },
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "undo-resolve-01",
        expectedRunRevision: 9,
        reviewId: "rollback-review-01",
        decisions: [{ relativePath: "notes/outline.md", decision: "restore_baseline" }]
      }
    ]);
  });

  test("routes strict Conversation commands through the currently bound runtime", async () => {
    const calls: string[] = [];
    const createRuntime = (projectId: string) => ({
      workspaceId: projectId,
      projectId,
      projectRoot: `C:/${projectId}`,
      agentRunSession: {},
      agentConversationSession: {
        async createConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:create:${String(command["commandId"])}`);
          return { ok: true, value: conversationSummary(projectId) };
        },
        async listConversations(query: Record<string, unknown>) {
          calls.push(`${projectId}:list:${String(query["limit"])}`);
          return { ok: true, value: { items: [conversationSummary(projectId)], diagnostics: [] } };
        },
        async readConversation(query: Record<string, unknown>) {
          calls.push(`${projectId}:read:${String(query["conversationId"])}`);
          return {
            ok: true,
            value: { ...conversationSummary(projectId), runs: [], diagnostics: [] }
          };
        },
        async archiveConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:archive:${String(command["expectedConversationRevision"])}`);
          return { ok: true, value: { ...conversationSummary(projectId), status: "archived" } };
        },
        async restoreConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:restore:${String(command["expectedConversationRevision"])}`);
          return { ok: true, value: conversationSummary(projectId) };
        },
        async deleteConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:delete:${String(command["expectedConversationRevision"])}`);
          return {
            ok: true,
            value: {
              conversationId: String(command["conversationId"]),
              revision: Number(command["expectedConversationRevision"]) + 1
            }
          };
        },
        async searchConversations(query: Record<string, unknown>) {
          calls.push(`${projectId}:search:${String(query["query"])}`);
          return {
            ok: true,
            value: {
              items: [{ ...conversationSummary(projectId), snippet: "Opening scene" }],
              diagnostics: []
            }
          };
        }
      }
    });
    const first = createRuntime("project-01");
    const second = createRuntime("project-02");
    let current = first;
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => current,
          currentWorkspace: () => ({
            workspaceId: current.workspaceId,
            contentRoot: current.projectRoot,
            stateRoot: current.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const created = await handlers["application:agent-conversation:create"]?.({
      projectId: "project-01",
      commandId: "create-01"
    });
    await handlers["application:agent-conversation:list"]?.({
      projectId: "project-01",
      includeArchived: true,
      limit: 30
    });
    await handlers["application:agent-conversation:read"]?.({
      projectId: "project-01",
      conversationId: "conversation-01"
    });
    await handlers["application:agent-conversation:archive"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "archive-01",
      expectedConversationRevision: 1
    });
    await handlers["application:agent-conversation:restore"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "restore-01",
      expectedConversationRevision: 2
    });
    await handlers["application:agent-conversation:delete"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "delete-01",
      expectedConversationRevision: 3
    });
    await handlers["application:agent-conversation:search"]?.({
      projectId: "project-01",
      query: "Opening",
      cursor: "next_page",
      limit: 10
    });
    expect(() => structuredClone(created)).not.toThrow();

    current = second;
    await handlers["application:agent-conversation:list"]?.({
      projectId: "project-02",
      limit: 5
    });
    const callCount = calls.length;
    const invalidResults = await Promise.all([
      handlers["application:agent-conversation:create"]?.({
        projectId: "project-02",
        commandId: "create-invalid",
        extra: true
      }),
      handlers["application:agent-conversation:list"]?.({
        projectId: "project-02",
        cursor: "bad cursor"
      }),
      handlers["application:agent-conversation:list"]?.({
        projectId: "project-02",
        limit: 101
      }),
      handlers["application:agent-conversation:archive"]?.({
        projectId: "project-02",
        conversationId: "conversation-01",
        commandId: "archive-invalid",
        expectedConversationRevision: -1
      }),
      handlers["application:agent-conversation:delete"]?.({
        projectId: "project-02",
        conversationId: "conversation-01",
        commandId: "delete-invalid",
        expectedConversationRevision: -1
      })
    ]);

    expect(invalidResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ ok: false })])
    );
    expect(invalidResults.every((result) => (result as { ok?: boolean }).ok === false)).toBe(true);
    expect(calls).toHaveLength(callCount);
    expect(calls).toEqual([
      "project-01:create:create-01",
      "project-01:list:30",
      "project-01:read:conversation-01",
      "project-01:archive:1",
      "project-01:restore:2",
      "project-01:delete:3",
      "project-01:search:Opening",
      "project-02:list:5"
    ]);
  });

  test("preload exposes all Conversation commands on allowlisted channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on: () => () => undefined
    }) as unknown as Record<string, unknown>;
    const conversations = api["agentConversations"] as
      Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    expect(conversations).toBeDefined();
    if (conversations === undefined) return;

    await conversations["create"]?.({});
    await conversations["list"]?.({});
    await conversations["read"]?.({});
    await conversations["archive"]?.({});
    await conversations["restore"]?.({});
    await conversations["delete"]?.({});
    await conversations["search"]?.({});

    expect(invoked).toEqual([
      "application:agent-conversation:create",
      "application:agent-conversation:list",
      "application:agent-conversation:read",
      "application:agent-conversation:archive",
      "application:agent-conversation:restore",
      "application:agent-conversation:delete",
      "application:agent-conversation:search"
    ]);
  });

  test("routes draft/context-budget commands through the bound runtime and rejects malformed ones", async () => {
    const calls: string[] = [];
    const draftView = { ok: true, value: { runDraft: {}, contextDraft: {} } };
    const runtime = {
      workspaceId: "project-01",
      projectId: "project-01",
      projectRoot: "C:/project-01",
      agentRunSession: {
        async compactContext(command: Record<string, unknown>) {
          calls.push(`compact:${String(command["trigger"])}`);
          return { ok: true, value: { compactionId: "compaction-01" } };
        }
      },
      agentRunDraftSession: {
        async syncStartDraft(command: Record<string, unknown>) {
          calls.push(
            `sync-start:${String(command["writePolicy"])}:${String(
              command["executionWritePolicyDraft"]
            )}`
          );
          return draftView;
        },
        async readAgentRunDraft(command: Record<string, unknown>) {
          calls.push(`read-run-draft:${String(command["conversationId"])}`);
          return draftView;
        },
        async updateAgentRunDraft(command: Record<string, unknown>) {
          calls.push(
            `update-run-draft:${String((command["mutation"] as Record<string, unknown>)["kind"])}`
          );
          return draftView;
        },
        async updateContextDraft(command: Record<string, unknown>) {
          calls.push(
            `update-context-draft:${String(
              (command["mutation"] as Record<string, unknown>)["kind"]
            )}`
          );
          return draftView;
        },
        async refreshContextDraft(command: Record<string, unknown>) {
          calls.push(`refresh-context-draft:${String(command["contextDraftId"])}`);
          return draftView;
        }
      },
      agentContextSession: {
        async previewContextBudget(command: Record<string, unknown>) {
          calls.push(`preview-budget:${String(command["commandId"])}`);
          return { ok: true, value: { contextBudgetSnapshotId: "budget-01" } };
        },
        async previewPackedContext(command: Record<string, unknown>) {
          calls.push(`preview-packed:${String(command["commandId"])}`);
          return {
            ok: true,
            value: {
              packedContextId: "packed-01",
              payloadChecksum: "a".repeat(64),
              blocks: []
            }
          };
        }
      }
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => runtime,
          currentWorkspace: () => ({
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.projectRoot,
            stateRoot: runtime.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await handlers["application:agent-run:prepare-start"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "sync-draft-policy-01",
      userRequest: "制定计划",
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      executionWritePolicyDraft: "user_preapproved_run",
      modelProfileId: "profile-01",
      contextRefs: [],
      activeResourceRef: null
    });

    const readDraft = await handlers["application:agent-run:read-run-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation"
      }
    });
    expect(() => structuredClone(readDraft)).not.toThrow();
    await handlers["application:agent-run:update-run-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-01",
      expectedDraftRevision: 1,
      mutation: { kind: "set_model", modelProfileId: "profile-02" }
    });
    await handlers["application:agent-run:update-run-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-policy-draft-01",
      expectedDraftRevision: 1,
      mutation: { kind: "set_execution_write_policy_draft", policy: "user_preapproved_run" }
    });
    await handlers["application:agent-run:update-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-02",
      contextDraftId: "context-01",
      expectedDraftRevision: 1,
      mutation: { kind: "remove_ref", refId: "chapter:ch-01" }
    });
    await handlers["application:agent-run:update-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-02-neutral",
      contextDraftId: "context-01",
      expectedDraftRevision: 2,
      mutation: {
        kind: "set_source_override",
        refId: "chapter:ch-01",
        decision: "automatic"
      }
    });
    await handlers["application:agent-run:update-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-02-story",
      contextDraftId: "context-01",
      expectedDraftRevision: 2,
      mutation: {
        kind: "set_active_resource",
        ref: {
          kind: "story_bible",
          refId: "story_bible:chr_hero",
          assetId: "chr_hero",
          label: "主角"
        }
      }
    });
    await handlers["application:agent-run:refresh-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-03",
      contextDraftId: "context-01",
      expectedDraftRevision: 2
    });
    await handlers["application:agent-run:preview-context-budget"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-04",
      runDraftId: "draft-01",
      expectedDraftRevision: 3,
      runDraftChecksum: "checksum-01"
    });
    await handlers["application:agent-run:preview-packed-context"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-packed-04",
      runDraftId: "draft-01",
      expectedDraftRevision: 3,
      runDraftChecksum: "checksum-01"
    });
    await handlers["application:agent-run:compact-context"]?.({
      projectId: "project-01",
      runId: "run-01",
      commandId: "cmd-05",
      expectedRunRevision: 4,
      contextBudgetSnapshotId: "budget-01",
      trigger: "manual"
    });
    await handlers["application:agent-run:preview-context-budget"]?.({
      scope: { kind: "standalone", scopeId: "standalone" },
      conversationId: "conversation-standalone",
      commandId: "cmd-standalone-preview",
      runDraftId: "draft-standalone",
      expectedDraftRevision: 1,
      runDraftChecksum: "checksum-standalone"
    });
    await handlers["application:agent-run:compact-context"]?.({
      scope: { kind: "standalone", scopeId: "standalone" },
      runId: "run-standalone",
      commandId: "cmd-standalone-compact",
      expectedRunRevision: 2,
      contextBudgetSnapshotId: "budget-standalone",
      trigger: "recovery"
    });

    const before = calls.length;
    const rejected = await Promise.all([
      handlers["application:agent-run:update-run-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad",
        expectedDraftRevision: 1,
        mutation: { kind: "set_model" }
      }),
      handlers["application:agent-run:update-run-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-forged-policy",
        expectedDraftRevision: 1,
        mutation: {
          kind: "set_write_policy",
          writePolicy: "user_preapproved_run",
          acknowledged: true
        }
      }),
      handlers["application:agent-run:read-run-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        initialize: {
          modelProfileId: "profile-01",
          operationMode: "planning",
          contextMode: "writing",
          writePolicy: "write_before_confirmation",
          forgedAcknowledgement: true
        }
      }),
      handlers["application:agent-run:prepare-start"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "sync-forged-policy-01",
        userRequest: "制定计划",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "user_preapproved_run",
        writePolicyAcknowledged: true,
        executionWritePolicyDraft: "user_preapproved_run",
        modelProfileId: "profile-01",
        contextRefs: [],
        activeResourceRef: null
      }),
      handlers["application:agent-run:update-context-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad",
        contextDraftId: "context-01",
        expectedDraftRevision: 1,
        mutation: { kind: "unknown_mutation" }
      }),
      handlers["application:agent-run:update-context-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad-neutral",
        contextDraftId: "context-01",
        expectedDraftRevision: 1,
        mutation: {
          kind: "set_source_override",
          refId: "chapter:ch-01",
          decision: "automatic",
          priority: 50
        }
      }),
      handlers["application:agent-run:preview-packed-context"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad-packed",
        runDraftId: "draft-01",
        expectedDraftRevision: 3,
        runDraftChecksum: "checksum-01",
        exposeSystemGuidance: true
      }),
      handlers["application:agent-run:compact-context"]?.({
        projectId: "project-01",
        runId: "run-01",
        commandId: "cmd-bad",
        expectedRunRevision: 4,
        contextBudgetSnapshotId: "budget-01",
        trigger: "sideways"
      }),
      handlers["application:agent-run:compact-context"]?.({
        scope: { kind: "standalone", scopeId: "standalone" },
        projectId: "forged-project",
        runId: "run-standalone",
        commandId: "cmd-forged-identity",
        expectedRunRevision: 2,
        contextBudgetSnapshotId: "budget-standalone",
        trigger: "manual"
      })
    ]);
    expect(rejected.every((result) => (result as { ok?: boolean }).ok === false)).toBe(true);
    expect(calls).toHaveLength(before);
    expect(calls).toEqual([
      "sync-start:write_before_confirmation:user_preapproved_run",
      "read-run-draft:conversation-01",
      "update-run-draft:set_model",
      "update-run-draft:set_execution_write_policy_draft",
      "update-context-draft:remove_ref",
      "update-context-draft:set_source_override",
      "update-context-draft:set_active_resource",
      "refresh-context-draft:context-01",
      "preview-budget:cmd-04",
      "preview-packed:cmd-packed-04",
      "compact:manual",
      "preview-budget:cmd-standalone-preview",
      "compact:recovery"
    ]);
  });

  test("preload exposes the Stage 5 context controls on allowlisted channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on: () => () => undefined
    }) as unknown as Record<string, unknown>;
    const agentRuns = api["agentRuns"] as
      Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    expect(agentRuns).toBeDefined();
    if (agentRuns === undefined) return;

    await agentRuns["readRunDraft"]?.({});
    await agentRuns["updateRunDraft"]?.({});
    await agentRuns["updateContextDraft"]?.({});
    await agentRuns["refreshContextDraft"]?.({});
    await agentRuns["previewContextBudget"]?.({});
    await agentRuns["previewPackedContext"]?.({});
    await agentRuns["compactContext"]?.({});

    expect(invoked).toEqual([
      "application:agent-run:read-run-draft",
      "application:agent-run:update-run-draft",
      "application:agent-run:update-context-draft",
      "application:agent-run:refresh-context-draft",
      "application:agent-run:preview-context-budget",
      "application:agent-run:preview-packed-context",
      "application:agent-run:compact-context"
    ]);
  });

  test("routes send preview IPC through the active preview-capable runtime", async () => {
    const release = vi.fn();
    const prepareAgentSendPreview = vi.fn(async (command: unknown) => ok({ command }));
    const confirmSendPreview = vi.fn(async () => ok({ runId: "run-01" }));
    const readSendLedger = vi.fn(async () => ok([]));
    const startAgentRun = vi.fn(async () => ok({ runId: "legacy" }));
    const runtime = {
      agentRunSession: { startAgentRun },
      prepareAgentSendPreview,
      confirmAgentSendPreview: confirmSendPreview,
      readAgentSendLedger: readSendLedger
    };
    const manager = {
      active: () => ({
        scope: "workspace" as const,
        binding: {
          kind: "creativeProject" as const,
          workspaceId: "project-01",
          contentRoot: "C:/project-01",
          stateRoot: "C:/project-01/.state"
        },
        runtime
      }),
      acquireActiveRunStartLease: () => ok({ session: runtime.agentRunSession, release }),
      subscribeAgentRunEvents: () => () => undefined
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: manager
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const startCommand = {
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "command-01",
      expectedRunRevision: 0,
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "c".repeat(64),
      packedContextId: "packed-01",
      packedContextPayloadChecksum: "a".repeat(64)
    };

    await expect(
      handlers["application:agent-run:prepare-send-preview"]?.({
        schemaVersion: "2.0",
        commandId: "preview-command-01",
        startCommand
      })
    ).resolves.toEqual({ ok: true, value: { command: expect.anything() } });
    await expect(
      handlers["application:agent-run:confirm-send-preview"]?.({
        schemaVersion: "2.0",
        previewId: "preview-01",
        canonicalPayloadChecksum: "b".repeat(64)
      })
    ).resolves.toEqual({ ok: true, value: { runId: "run-01" } });
    await expect(handlers["application:agent-run:read-send-ledger"]?.("run-01")).resolves.toEqual({
      ok: true,
      value: []
    });
    expect(prepareAgentSendPreview).toHaveBeenCalledOnce();
    expect(confirmSendPreview).toHaveBeenCalledOnce();
    expect(readSendLedger).toHaveBeenCalledWith("run-01");
    expect(release).toHaveBeenCalledOnce();

    await expect(
      handlers["application:agent-run:confirm-send-preview"]?.({
        schemaVersion: "2.0",
        previewId: "preview-01",
        canonicalPayloadChecksum: "not-a-checksum"
      })
    ).resolves.toMatchObject({ ok: false });
    expect(confirmSendPreview).toHaveBeenCalledOnce();

    const directStart = await handlers["application:agent-run:start"]?.(startCommand);
    expect(directStart).toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_PREVIEW_REQUIRED" }
    });
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  test("preload exposes the send preview controls on allowlisted channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on: () => () => undefined
    }) as unknown as Record<string, unknown>;
    const agentRuns = api["agentRuns"] as
      Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    expect(agentRuns).toBeDefined();
    if (agentRuns === undefined) return;

    await agentRuns["prepareSendPreview"]?.({});
    await agentRuns["confirmSendPreview"]?.({});
    await agentRuns["readSendLedger"]?.("run-01");

    expect(invoked).toEqual([
      "application:agent-run:prepare-send-preview",
      "application:agent-run:confirm-send-preview",
      "application:agent-run:read-send-ledger"
    ]);
  });

  test("preserves direct start for legacy injected sessions without a preview runtime", async () => {
    const startAgentRun = vi.fn(async () => ok({ runId: "legacy" }));
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: { startAgentRun, subscribe: () => () => undefined }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const result = await handlers["application:agent-run:start"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "command-01",
      expectedRunRevision: 0,
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "c".repeat(64),
      packedContextId: "packed-01",
      packedContextPayloadChecksum: "a".repeat(64)
    });
    expect(result).toEqual({ ok: true, value: { runId: "legacy" } });
    expect(startAgentRun).toHaveBeenCalledOnce();
  });
});

function conversationSummary(projectId: string) {
  return {
    schemaVersion: "1.0",
    conversationId: "conversation-01",
    projectId,
    revision: 1,
    title: "Opening scene",
    status: "active",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    runCount: 0,
    summaryFreshness: "fresh"
  };
}

function snapshot(status: string, runRevision: number, lastSequence: number) {
  return {
    schemaVersion: "1.0",
    runId: "run-ipc",
    projectId: "project-01",
    conversationId: "conversation-01",
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "制定计划",
    status,
    runRevision,
    lastSequence,
    startedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
    providerCapabilitySnapshot: {
      profileId: "profile-01",
      provider: "demo",
      modelName: "agent-demo",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000,
      requiredContextTokens: 8000
    },
    pendingUserInputId: null,
    contextSnapshotId: null,
    sourcePlanId: null,
    sourcePlanRevision: null
  };
}
