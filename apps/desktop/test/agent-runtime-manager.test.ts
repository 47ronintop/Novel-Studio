import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createDesktopAgentRuntimeManager } from "../src/main/agent-runtime-manager.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopAgentRuntimeManager", () => {
  test("binds and rebinds runtimes to canonical project roots", async () => {
    const rootA = await createRoot("a");
    const rootB = await createRoot("b");
    const created: { projectId: string; projectRoot: string }[] = [];
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        created.push({ projectId: binding.projectId, projectRoot: binding.projectRoot });
        return fakeRuntime(binding.projectId, binding.projectRoot);
      }
    });

    expect(
      await manager.bindProject({
        projectId: "project_a",
        projectRoot: rootA,
        activeChapterId: "chapter_a"
      })
    ).toMatchObject({ ok: true });
    expect(
      await manager.bindProject({
        projectId: "project_b",
        projectRoot: rootB,
        activeChapterId: "chapter_b"
      })
    ).toMatchObject({ ok: true });

    expect(created).toEqual([
      { projectId: "project_a", projectRoot: await realpath(rootA) },
      { projectId: "project_b", projectRoot: await realpath(rootB) }
    ]);
    expect(manager.currentProject()).toEqual({
      projectId: "project_b",
      projectRoot: await realpath(rootB)
    });
  });

  test("refuses a project switch while the old project has a non-terminal run", async () => {
    const rootA = await createRoot("active-a");
    const rootB = await createRoot("active-b");
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        return fakeRuntime(binding.projectId, binding.projectRoot, [
          { projectId: binding.projectId, status: "executing_model" }
        ]);
      }
    });
    await manager.bindProject({
      projectId: "project_a",
      projectRoot: rootA,
      activeChapterId: "chapter_a"
    });

    expect(
      await manager.bindProject({
        projectId: "project_b",
        projectRoot: rootB,
        activeChapterId: "chapter_b"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(manager.currentProject()?.projectId).toBe("project_a");
  });

  test("disposes old subscriptions and forwards events only from the current runtime", async () => {
    const rootA = await createRoot("events-a");
    const rootB = await createRoot("events-b");
    const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
    const manager = createDesktopAgentRuntimeManager({
      createRuntime(binding) {
        const runtime = fakeRuntime(binding.projectId, binding.projectRoot);
        runtimes.set(binding.projectId, runtime);
        return runtime;
      }
    });
    const seen: string[] = [];
    manager.subscribeAgentRunEvents((event) => seen.push(String(event["runId"])));
    await manager.bindProject({
      projectId: "project_a",
      projectRoot: rootA,
      activeChapterId: "chapter_a"
    });
    runtimes.get("project_a")?.emit({ runId: "run_a" });
    await manager.bindProject({
      projectId: "project_b",
      projectRoot: rootB,
      activeChapterId: "chapter_b"
    });
    runtimes.get("project_a")?.emit({ runId: "run_stale" });
    runtimes.get("project_b")?.emit({ runId: "run_b" });

    expect(seen).toEqual(["run_a", "run_b"]);
  });
});

async function createRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-runtime-${name}-`));
  roots.push(root);
  return root;
}

function fakeRuntime(
  projectId: string,
  projectRoot: string,
  snapshots: Record<string, unknown>[] = []
) {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  return {
    projectId,
    projectRoot,
    agentRunSession: {
      async listAgentRuns() {
        return { ok: true as const, value: snapshots };
      },
      subscribe(listener: (event: Record<string, unknown>) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    agentConversationSession: {},
    emit(event: Record<string, unknown>) {
      for (const listener of listeners) listener(event);
    }
  };
}
