import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createUnifiedError, err, ok } from "@novel-studio/shared";
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
    readonly prepareResult?: ReturnType<typeof ok<void>> | ReturnType<typeof err>;
  } = {}
) {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const runtime = {
    workspaceId,
    contentRoot,
    stateRoot,
    prepareCalls: 0,
    disposeCalls: 0,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    async prepare() {
      runtime.prepareCalls += 1;
      return options.prepareResult ?? ok(undefined);
    },
    agentRunSession: {
      async listAgentRuns() {
        return ok(options.snapshots ?? []);
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
    emit(event: Record<string, unknown>) {
      for (const listener of listeners) listener(event);
    }
  };
  return runtime;
}
