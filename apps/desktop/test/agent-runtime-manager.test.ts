import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  createDesktopAgentRuntimeManager,
  type DesktopAgentRuntime,
  type DesktopAgentWorkspaceBinding
} from "../src/main/agent-runtime-manager.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopAgentRuntimeManager", () => {
  test("prepares a runtime without replacing the current workspace until commit", async () => {
    const rootA = await createRoot("atomic-a");
    const rootB = await createRoot("atomic-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    const seen: string[] = [];
    manager.subscribeAgentRunEvents((event) => seen.push(event.runId));
    await manager.bindWorkspace(engineeringBinding("ws_atomic_a", rootA));

    const prepared = await manager.prepareWorkspace(engineeringBinding("ws_atomic_b", rootB));

    expect(prepared).toMatchObject({ ok: true });
    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_atomic_a");
    expect(runtimes.get("ws_atomic_a")).toMatchObject({ disposeCalls: 0, unsubscribeCalls: 0 });
    expect(runtimes.get("ws_atomic_b")).toMatchObject({ prepareCalls: 1, subscribeCalls: 1 });
    runtimes.get("ws_atomic_b")?.emit({ runId: "run_before_commit" });
    expect(seen).toEqual([]);
    if (!prepared.ok) {
      throw new Error(prepared.error.message);
    }

    manager.commitPreparedWorkspace(prepared.value);
    runtimes.get("ws_atomic_a")?.emit({ runId: "run_stale" });
    runtimes.get("ws_atomic_b")?.emit({ runId: "run_after_commit" });

    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_atomic_b");
    expect(runtimes.get("ws_atomic_a")).toMatchObject({ disposeCalls: 1, unsubscribeCalls: 1 });
    expect(seen).toEqual(["run_after_commit"]);
  });

  test("discards only a prepared runtime and leaves the current workspace untouched", async () => {
    const rootA = await createRoot("discard-a");
    const rootB = await createRoot("discard-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_discard_a", rootA));
    const prepared = await manager.prepareWorkspace(engineeringBinding("ws_discard_b", rootB));
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) {
      throw new Error(prepared.error.message);
    }

    manager.discardPreparedWorkspace(prepared.value);
    manager.discardPreparedWorkspace(prepared.value);

    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_discard_a");
    expect(runtimes.get("ws_discard_a")).toMatchObject({ disposeCalls: 0, unsubscribeCalls: 0 });
    expect(runtimes.get("ws_discard_b")).toMatchObject({ disposeCalls: 1, unsubscribeCalls: 1 });
  });

  test("preserves creative project identity and binds canonical content/state roots", async () => {
    const root = await createRoot("creative");
    const created: DesktopAgentWorkspaceBinding[] = [];
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        created.push(binding);
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });

    expect(
      await manager.bindWorkspace({
        kind: "creativeProject",
        workspaceId: "prj_changan",
        contentRoot: root,
        stateRoot: root,
        activeChapterId: "chapter_a"
      })
    ).toMatchObject({ ok: true });

    const canonicalRoot = await realpath(root);
    expect(created).toEqual([
      {
        kind: "creativeProject",
        workspaceId: "prj_changan",
        contentRoot: canonicalRoot,
        stateRoot: canonicalRoot,
        activeChapterId: "chapter_a"
      }
    ]);
    expect(runtimes[0]?.prepareCalls).toBe(1);
    expect(manager.currentWorkspace()).toEqual({
      workspaceId: "prj_changan",
      contentRoot: canonicalRoot,
      stateRoot: canonicalRoot
    });
  });

  test("refuses a workspace switch while the old workspace has a non-terminal run", async () => {
    const rootA = await createRoot("active-a");
    const rootB = await createRoot("active-b");
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        return fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          snapshots: [{ projectId: binding.workspaceId, status: "executing_model" }]
        }) as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_a", rootA));

    expect(await manager.bindWorkspace(engineeringBinding("ws_b", rootB))).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_a");
  });

  test("keeps the old runtime when candidate preparation fails", async () => {
    const rootA = await createRoot("prepared-a");
    const rootB = await createRoot("prepared-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const prepareError = createUnifiedError({
      code: "AGENT_RUNTIME_RECOVERY_FAILED",
      category: "StorageError",
      message: "Recovery failed.",
      recoverability: "user-action",
      suggestedAction: "Review recovery state.",
      traceId: "agent-runtime-manager-test"
    });
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          prepareResult: binding.workspaceId === "ws_b" ? err(prepareError) : ok(undefined)
        });
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_a", rootA));

    const failed = await manager.bindWorkspace(engineeringBinding("ws_b", rootB));

    expect(failed).toEqual(err(prepareError));
    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_a");
    expect(runtimes.get("ws_a")).toMatchObject({ disposeCalls: 0, subscribeCalls: 1 });
    expect(runtimes.get("ws_b")).toMatchObject({
      prepareCalls: 1,
      disposeCalls: 1,
      subscribeCalls: 0
    });
  });

  test("reprepares when runtime-relevant workspace binding fields change", async () => {
    const root = await createRoot("binding-change");
    const created: DesktopAgentWorkspaceBinding[] = [];
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        created.push(binding);
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    const first: DesktopAgentWorkspaceBinding = {
      kind: "creativeProject",
      workspaceId: "prj_binding_change",
      contentRoot: root,
      stateRoot: root,
      activeChapterId: "chapter_a"
    };

    await manager.bindWorkspace(first);
    await manager.bindWorkspace({ ...first, activeChapterId: "chapter_b" });

    expect(created.map((binding) => binding.activeChapterId)).toEqual(["chapter_a", "chapter_b"]);
    expect(runtimes.map((runtime) => runtime.prepareCalls)).toEqual([1, 1]);
    expect(runtimes[0]?.disposeCalls).toBe(1);
  });

  test("disposes old subscriptions and forwards events only from the prepared current runtime", async () => {
    const rootA = await createRoot("events-a");
    const rootB = await createRoot("events-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    const seen: string[] = [];
    manager.subscribeAgentRunEvents((event) => seen.push(event.runId));
    await manager.bindWorkspace(engineeringBinding("ws_a", rootA));
    runtimes.get("ws_a")?.emit({ runId: "run_a" });
    await manager.bindWorkspace(engineeringBinding("ws_b", rootB));
    runtimes.get("ws_a")?.emit({ runId: "run_stale" });
    runtimes.get("ws_b")?.emit({ runId: "run_b" });

    expect(seen).toEqual(["run_a", "run_b"]);
    expect(runtimes.get("ws_a")).toMatchObject({ disposeCalls: 1, unsubscribeCalls: 1 });
  });

  test("refreshes the current workspace only when no Agent run is active", async () => {
    const root = await createRoot("settings-refresh");
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_settings", root));

    expect(await manager.refreshCurrentWorkspace()).toMatchObject({ ok: true });
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).toMatchObject({ disposeCalls: 1, unsubscribeCalls: 1 });
    expect(runtimes[1]).toMatchObject({ prepareCalls: 1, subscribeCalls: 1 });
  });

  test("stops an active pending approval before replacing settings-backed runtime", async () => {
    const root = await createRoot("settings-refresh-active");
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          snapshots: [
            {
              runId: "run_pending_approval",
              projectId: binding.workspaceId,
              runRevision: 7,
              status: "awaiting_tool_approval"
            }
          ]
        });
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_settings_active", root));

    expect(await manager.refreshCurrentWorkspace()).toMatchObject({ ok: true });
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).toMatchObject({ stopCalls: 1, disposeCalls: 1 });
  });

  test("revokes settings capabilities when refresh cannot confirm active runs", async () => {
    const root = await createRoot("settings-refresh-list-failure");
    const listError = createUnifiedError({
      code: "AGENT_RUNTIME_LIST_FAILED",
      message: "Agent runs could not be listed."
    });
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          listResult: err(listError)
        });
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_settings_list_failure", root));

    expect(await manager.refreshCurrentWorkspace()).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_LIST_FAILED" }
    });
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({ revokeCalls: 1, disposeCalls: 0 });
  });

  test("discards an older prepared settings runtime when a newer refresh is queued", async () => {
    const root = await createRoot("settings-refresh-generation");
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    let created = 0;
    let releaseFirstCandidate: (() => void) | undefined;
    const firstCandidatePrepared = new Promise<void>((resolve) => {
      releaseFirstCandidate = resolve;
    });
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        created += 1;
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          ...(created === 2
            ? { prepare: async () => firstCandidatePrepared.then(() => ok(undefined)) }
            : {})
        });
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_settings_generation", root));

    const older = manager.refreshCurrentWorkspace();
    await vi.waitFor(() => expect(runtimes).toHaveLength(2));
    const newer = manager.refreshCurrentWorkspace();
    releaseFirstCandidate?.();
    await expect(older).resolves.toMatchObject({ ok: true });
    await expect(newer).resolves.toMatchObject({ ok: true });

    expect(runtimes).toHaveLength(3);
    expect(runtimes[0]).toMatchObject({ disposeCalls: 1 });
    expect(runtimes[1]).toMatchObject({ disposeCalls: 1 });
    expect(runtimes[2]).toMatchObject({ disposeCalls: 0 });
  });
});

async function createRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-runtime-${name}-`));
  roots.push(root);
  return root;
}

function engineeringBinding(workspaceId: string, root: string): DesktopAgentWorkspaceBinding {
  return {
    kind: "engineeringWorkspace",
    workspaceId,
    contentRoot: root,
    stateRoot: root
  };
}

function fakeRuntime(
  workspaceId: string,
  contentRoot: string,
  stateRoot: string,
  options: {
    readonly snapshots?: Record<string, unknown>[];
    readonly listResult?: Result<readonly Record<string, unknown>[], UnifiedError>;
    readonly prepareResult?: ReturnType<typeof ok<void>> | ReturnType<typeof err>;
    readonly prepare?: () => Promise<ReturnType<typeof ok<void>> | ReturnType<typeof err>>;
  } = {}
) {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const snapshots = [...(options.snapshots ?? [])];
  const runtime = {
    workspaceId,
    contentRoot,
    stateRoot,
    prepareCalls: 0,
    disposeCalls: 0,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    stopCalls: 0,
    revokeCalls: 0,
    async prepare() {
      runtime.prepareCalls += 1;
      return options.prepare?.() ?? options.prepareResult ?? ok(undefined);
    },
    agentRunSession: {
      async listAgentRuns() {
        return options.listResult ?? ok(snapshots);
      },
      async stopAgentRun(command: { readonly runId: string }) {
        runtime.stopCalls += 1;
        const index = snapshots.findIndex((snapshot) => snapshot["runId"] === command.runId);
        if (index >= 0) {
          snapshots[index] = { ...snapshots[index], status: "cancelled" };
        }
        return ok({});
      },
      subscribe(listener: (event: Record<string, unknown>) => void) {
        runtime.subscribeCalls += 1;
        listeners.add(listener);
        return () => {
          runtime.unsubscribeCalls += 1;
          listeners.delete(listener);
        };
      }
    },
    agentConversationSession: {},
    agentRunDraftSession: {},
    agentContextSession: {},
    agentPermissionSession: {},
    agentPlanExecutionSession: {},
    dispose() {
      runtime.disposeCalls += 1;
    },
    revokeSettingsCapabilities() {
      runtime.revokeCalls += 1;
    },
    emit(event: Record<string, unknown>) {
      for (const listener of listeners) listener(event);
    }
  };
  return runtime;
}
