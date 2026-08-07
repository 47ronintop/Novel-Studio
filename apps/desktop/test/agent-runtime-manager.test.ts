import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  createDesktopAgentRuntimeManager,
  type DesktopAgentRuntime,
  type DesktopStandaloneAgentRuntime,
  type DesktopAgentWorkspaceBinding
} from "../src/main/agent-runtime-manager.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopAgentRuntimeManager", () => {
  test("keeps standalone state resident while routing events only from the active scope", async () => {
    const workspaceRoot = await createRoot("standalone-routing-workspace");
    const standaloneRoot = await createRoot("standalone-routing-state");
    const workspaceRuntimes: ReturnType<typeof fakeRuntime>[] = [];
    const standalone = fakeStandaloneRuntime(standaloneRoot);
    const activatedScopes: string[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        workspaceRuntimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      },
      createStandaloneRuntime: () => standalone as unknown as DesktopStandaloneAgentRuntime,
      onActiveRuntimeChanged: (active) => activatedScopes.push(active?.scope ?? "none")
    });
    const seen: string[] = [];
    manager.subscribeAgentRunEvents((event) => seen.push(event.runId));

    expect(await manager.activateStandalone()).toMatchObject({ ok: true });
    expect(manager.activeScope()).toBe("standalone");
    expect(manager.current()).toBeUndefined();
    expect(manager.standalone()).toMatchObject({
      scopeId: "standalone",
      stateRoot: standaloneRoot
    });
    standalone.emit({ runId: "standalone_active" });

    expect(
      await manager.bindWorkspace(engineeringBinding("ws_standalone_routing", workspaceRoot))
    ).toMatchObject({
      ok: true
    });
    expect(manager.activeScope()).toBe("workspace");
    standalone.emit({ runId: "standalone_hidden" });
    workspaceRuntimes[0]?.emit({ runId: "workspace_active" });

    expect(await manager.activateStandalone()).toMatchObject({ ok: true });
    expect(manager.activeScope()).toBe("standalone");
    workspaceRuntimes[0]?.emit({ runId: "workspace_disposed" });
    standalone.emit({ runId: "standalone_restored" });

    expect(seen).toEqual(["standalone_active", "workspace_active", "standalone_restored"]);
    expect(activatedScopes).toEqual(["standalone", "workspace", "standalone"]);
    expect(standalone).toMatchObject({ disposeCalls: 0, prepareCalls: 1, subscribeCalls: 1 });
    expect(workspaceRuntimes[0]).toMatchObject({ disposeCalls: 1, unsubscribeCalls: 1 });
  });

  test("blocks workspace activation while standalone owns a non-terminal run", async () => {
    const workspaceRoot = await createRoot("standalone-active-workspace");
    const standaloneRoot = await createRoot("standalone-active-state");
    const standalone = fakeStandaloneRuntime(standaloneRoot, {
      snapshots: [
        {
          runId: "standalone_running",
          runRevision: 1,
          status: "conversation_model"
        }
      ]
    });
    const createWorkspace = vi.fn((binding: DesktopAgentWorkspaceBinding) =>
      fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot)
    );
    const manager = createDesktopAgentRuntimeManager({
      createRuntime: createWorkspace,
      createStandaloneRuntime: () => standalone as unknown as DesktopStandaloneAgentRuntime
    });

    await manager.prepareStandalone();

    await expect(
      manager.bindWorkspace(engineeringBinding("ws_blocked", workspaceRoot))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(manager.active()).toBeUndefined();
  });

  test("restores an active standalone run without treating its own scope as a switch", async () => {
    const standaloneRoot = await createRoot("standalone-restore-state");
    const standalone = fakeStandaloneRuntime(standaloneRoot, {
      snapshots: [
        {
          runId: "standalone_restored_run",
          runRevision: 3,
          status: "conversation_model"
        }
      ]
    });
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        return fakeRuntime(
          binding.workspaceId,
          binding.contentRoot,
          binding.stateRoot
        ) as unknown as DesktopAgentRuntime;
      },
      createStandaloneRuntime: () => standalone as unknown as DesktopStandaloneAgentRuntime
    });

    await expect(manager.activateStandalone()).resolves.toMatchObject({ ok: true });
    expect(manager.active()).toMatchObject({ scope: "standalone" });
  });

  test("keeps the current workspace selected when standalone initialization fails", async () => {
    const workspaceRoot = await createRoot("standalone-init-failure-workspace");
    const workspaceRuntime = fakeRuntime("ws_init_failure", workspaceRoot, workspaceRoot);
    const manager = createDesktopAgentRuntimeManager({
      createRuntime: () => workspaceRuntime as unknown as DesktopAgentRuntime,
      createStandaloneRuntime: () => {
        throw new Error("state root unavailable");
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_init_failure", workspaceRoot));

    await expect(manager.activateStandalone()).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_STANDALONE_RUNTIME_CREATE_FAILED" }
    });
    expect(manager.active()).toMatchObject({ scope: "workspace" });
    expect(workspaceRuntime).toMatchObject({ disposeCalls: 0 });
  });

  test("blocks workspace close and replacement while a start preflight lease is held", async () => {
    const rootA = await createRoot("start-lease-source");
    const rootB = await createRoot("start-lease-target");
    const standaloneRoot = await createRoot("start-lease-standalone");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const standalone = fakeStandaloneRuntime(standaloneRoot);
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot);
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      },
      createStandaloneRuntime: () => standalone as unknown as DesktopStandaloneAgentRuntime
    });
    await manager.bindWorkspace(engineeringBinding("ws_start_lease_a", rootA));

    const lease = manager.acquireActiveRunStartLease();
    expect(lease).toMatchObject({ ok: true });
    if (!lease.ok) throw new Error(lease.error.message);

    await expect(manager.activateStandalone()).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    await expect(
      manager.prepareWorkspace(engineeringBinding("ws_start_lease_b", rootB))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(runtimes.get("ws_start_lease_a")).toMatchObject({ disposeCalls: 0 });
    expect(runtimes.has("ws_start_lease_b")).toBe(false);

    lease.value.release();
    await expect(manager.activateStandalone()).resolves.toMatchObject({ ok: true });
    expect(manager.active()).toMatchObject({ scope: "standalone" });
  });

  test("keeps workspace replacement closed to starts through commit", async () => {
    const rootA = await createRoot("transition-gate-source");
    const rootB = await createRoot("transition-gate-target");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    let releaseCandidate: (() => void) | undefined;
    const candidatePrepared = new Promise<void>((resolve) => {
      releaseCandidate = resolve;
    });
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          ...(binding.workspaceId === "ws_transition_gate_b"
            ? { prepare: async () => candidatePrepared.then(() => ok(undefined)) }
            : {})
        });
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_transition_gate_a", rootA));

    const preparing = manager.prepareWorkspace(engineeringBinding("ws_transition_gate_b", rootB));
    await vi.waitFor(() => expect(runtimes.get("ws_transition_gate_b")?.prepareCalls).toBe(1));
    expect(manager.acquireActiveRunStartLease()).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });

    releaseCandidate?.();
    const prepared = await preparing;
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(manager.acquireActiveRunStartLease()).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });

    manager.commitPreparedWorkspace(prepared.value);
    const started = manager.acquireActiveRunStartLease();
    expect(started).toMatchObject({ ok: true });
    if (!started.ok) throw new Error(started.error.message);
    expect(started.value.session).toBe(runtimes.get("ws_transition_gate_b")?.agentRunSession);
    started.value.release();
  });

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

  test("refuses a workspace switch when a run starts while the candidate is preparing", async () => {
    const rootA = await createRoot("active-during-prepare-a");
    const rootB = await createRoot("active-during-prepare-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    let releaseCandidate: (() => void) | undefined;
    const candidatePrepared = new Promise<void>((resolve) => {
      releaseCandidate = resolve;
    });
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          ...(binding.workspaceId === "ws_prepare_b"
            ? { prepare: async () => candidatePrepared.then(() => ok(undefined)) }
            : {})
        });
        runtimes.set(binding.workspaceId, runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_prepare_a", rootA));

    const preparing = manager.prepareWorkspace(engineeringBinding("ws_prepare_b", rootB));
    await vi.waitFor(() => expect(runtimes.get("ws_prepare_b")?.prepareCalls).toBe(1));
    runtimes.get("ws_prepare_a")?.addSnapshot({
      runId: "run_started_during_prepare",
      projectId: "ws_prepare_a",
      runRevision: 1,
      status: "executing_model"
    });
    releaseCandidate?.();

    await expect(preparing).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(manager.currentWorkspace()?.workspaceId).toBe("ws_prepare_a");
    expect(runtimes.get("ws_prepare_a")).toMatchObject({ disposeCalls: 0 });
    expect(runtimes.get("ws_prepare_b")).toMatchObject({ disposeCalls: 1, subscribeCalls: 0 });
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
    expect(runtimes[0]).toMatchObject({ revokeCalls: 1 });
  });

  test("treats capability-changed and blocked runs as terminal during a settings refresh", async () => {
    const root = await createRoot("settings-refresh-capability-terminal");
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          ...(runtimes.length === 0
            ? {
                snapshots: [
                  {
                    runId: "run_capability_changed",
                    projectId: binding.workspaceId,
                    runRevision: 2,
                    status: "capability_changed"
                  },
                  {
                    runId: "run_blocked",
                    projectId: binding.workspaceId,
                    runRevision: 3,
                    status: "blocked"
                  }
                ]
              }
            : {})
        });
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_capability_terminal", root));

    expect(await manager.refreshCurrentWorkspace()).toMatchObject({ ok: true });
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).toMatchObject({ revokeCalls: 1, stopCalls: 0, disposeCalls: 1 });
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

  test("queues one settings refresh until a write transaction becomes terminal", async () => {
    const root = await createRoot("settings-refresh-transaction");
    const runtimes: ReturnType<typeof fakeRuntime>[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
          ...(runtimes.length === 0
            ? {
                snapshots: [
                  {
                    runId: "run_applying_changes",
                    projectId: binding.workspaceId,
                    runRevision: 4,
                    status: "applying_changes"
                  }
                ],
                deferStop: true
              }
            : {})
        });
        runtimes.push(runtime);
        return runtime as unknown as DesktopAgentRuntime;
      }
    });
    await manager.bindWorkspace(engineeringBinding("ws_settings_transaction", root));

    expect(await manager.refreshCurrentWorkspace()).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED" }
    });
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({ stopCalls: 1, revokeCalls: 1, disposeCalls: 0 });

    runtimes[0]?.setRunStatus("run_applying_changes", "cancelled");
    runtimes[0]?.emit({ type: "run_cancelled", runId: "run_applying_changes" });
    runtimes[0]?.emit({ type: "run_cancelled", runId: "run_applying_changes" });

    await vi.waitFor(() => expect(runtimes).toHaveLength(2));
    expect(runtimes[0]).toMatchObject({ stopCalls: 1, disposeCalls: 1 });
    expect(runtimes[1]).toMatchObject({ prepareCalls: 1, disposeCalls: 0 });
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

  test.each([
    ["active", "running", false],
    ["pending approval", "awaiting_write_approval", false],
    ["applying/deferred", "applying_changes", true]
  ] as const)(
    "revokes approval capabilities synchronously before %s expiry refresh can stop or defer the runtime",
    async (_label, status, deferStop) => {
      const root = await createRoot(`approval-expiry-${status}`);
      const runtimes: ReturnType<typeof fakeRuntime>[] = [];
      const manager = createDesktopAgentRuntimeManager({
        createRuntime(binding) {
          const runtime = fakeRuntime(binding.workspaceId, binding.contentRoot, binding.stateRoot, {
            deferStop,
            snapshots: [
              {
                runId: `run_${status}`,
                projectId: binding.workspaceId,
                runRevision: 1,
                status
              }
            ]
          });
          runtimes.push(runtime);
          return runtime as unknown as DesktopAgentRuntime;
        }
      });
      await manager.bindWorkspace(engineeringBinding(`ws_${status}`, root));

      manager.revokeCurrentApprovalCapabilities();
      expect(runtimes[0]).toMatchObject({ approvalRevokeCalls: 1, stopCalls: 0 });

      const refreshed = await manager.refreshCurrentWorkspace();
      if (deferStop) {
        expect(refreshed).toMatchObject({
          ok: false,
          error: { code: "AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED" }
        });
        expect(runtimes).toHaveLength(1);
        expect(runtimes[0]).toMatchObject({
          approvalRevokeCalls: 1,
          stopCalls: 1,
          disposeCalls: 0
        });
      } else {
        expect(refreshed).toMatchObject({ ok: true });
        expect(runtimes).toHaveLength(2);
        expect(runtimes[0]).toMatchObject({
          approvalRevokeCalls: 1,
          stopCalls: 1,
          disposeCalls: 1
        });
      }
    }
  );
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
    readonly deferStop?: boolean;
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
    approvalRevokeCalls: 0,
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
          snapshots[index] = {
            ...snapshots[index],
            status: options.deferStop ? "stopping_after_transaction" : "cancelled"
          };
        }
        return ok(snapshots[index] ?? {});
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
    revokeApprovalCapabilities() {
      runtime.approvalRevokeCalls += 1;
    },
    addSnapshot(snapshot: Record<string, unknown>) {
      snapshots.push(snapshot);
    },
    setRunStatus(runId: string, status: string) {
      const index = snapshots.findIndex((snapshot) => snapshot["runId"] === runId);
      if (index >= 0) snapshots[index] = { ...snapshots[index], status };
    },
    emit(event: Record<string, unknown>) {
      for (const listener of listeners) listener(event);
    }
  };
  return runtime;
}

function fakeStandaloneRuntime(stateRoot: string, options: Parameters<typeof fakeRuntime>[3] = {}) {
  const runtime = fakeRuntime("standalone", "", stateRoot, options);
  const record = runtime as unknown as Record<string, unknown>;
  delete record["workspaceId"];
  delete record["contentRoot"];
  record["scopeId"] = "standalone";
  record["listRunSnapshots"] = () => runtime.agentRunSession.listAgentRuns();
  return runtime as typeof runtime & { readonly scopeId: "standalone" };
}
