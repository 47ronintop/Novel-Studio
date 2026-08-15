import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import * as ipcExports from "../src/main/ipc-handlers.js";
import {
  createAgentWriteSaveCoordinator,
  createApplicationIpcHandlers
} from "../src/main/ipc-handlers.js";

describe("AgentWriteSaveCoordinator", () => {
  test("waits for an active chapter save, rejects saves while paused, and allows saving after resume", async () => {
    const createCoordinator = (ipcExports as unknown as Record<string, unknown>)[
      "createAgentWriteSaveCoordinator"
    ];
    expect(typeof createCoordinator).toBe("function");
    if (typeof createCoordinator !== "function") return;

    const chapterId = "chapter-save-guard";
    const relativePath = `chapters/${chapterId}.md`;
    let finishFirstSave: (() => void) | undefined;
    const firstSave = new Promise<ReturnType<typeof savedSnapshot>>((resolve) => {
      finishFirstSave = () => resolve(savedSnapshot(chapterId));
    });
    const saveActiveChapter = vi
      .fn()
      .mockImplementationOnce(async () => firstSave)
      .mockResolvedValue(savedSnapshot(chapterId));
    const application = {
      readActiveChapterState: vi.fn(async () => savedSnapshot(chapterId)),
      saveActiveChapter
    };
    const coordinator = (
      createCoordinator as () => {
        pauseAutosave(relativePaths: readonly string[]): Promise<void>;
        resumeAutosave(relativePaths: readonly string[]): Promise<void>;
      }
    )();
    const createHandlers = ipcExports.createApplicationIpcHandlers as unknown as (
      application: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Record<string, () => Promise<unknown>>;
    const handlers = createHandlers(application, { agentWriteSaveCoordinator: coordinator });

    const activeSave = handlers["application:chapter:save"]?.();
    await vi.waitFor(() => expect(saveActiveChapter).toHaveBeenCalledTimes(1));
    let pauseFinished = false;
    const pause = coordinator.pauseAutosave([relativePath]).then(() => {
      pauseFinished = true;
    });
    await Promise.resolve();
    expect(pauseFinished).toBe(false);

    finishFirstSave?.();
    await activeSave;
    await pause;

    const blocked = await handlers["application:chapter:save"]?.();
    expect(blocked).toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_SAVE_PAUSED_FOR_AGENT_WRITE",
        category: "UserError",
        recoverability: "user-action"
      }
    });
    expect(() => structuredClone(blocked)).not.toThrow();
    expect(saveActiveChapter).toHaveBeenCalledTimes(1);

    await coordinator.resumeAutosave([relativePath]);
    await expect(handlers["application:chapter:save"]?.()).resolves.toMatchObject({ ok: true });
    expect(saveActiveChapter).toHaveBeenCalledTimes(2);
  });

  test("preserves the existing path-list pause semantics for writing and creative saves", async () => {
    const coordinator = createAgentWriteSaveCoordinator();
    const active = coordinator.beginSave("chapters/chapter-01.md");
    expect(active.ok).toBe(true);
    if (!active.ok) throw new Error("expected the initial save permit");

    let drained = false;
    const pause = coordinator.pauseAutosave(["chapters/chapter-01.md"]);
    void pause.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(coordinator.beginSave("chapters/chapter-02.md").ok).toBe(true);

    active.release();
    await pause;
    expect(coordinator.beginSave("chapters/chapter-01.md").ok).toBe(false);
    await coordinator.resumeAutosave(["chapters/chapter-01.md"]);
    expect(coordinator.beginSave("chapters/chapter-01.md").ok).toBe(true);
  });

  test("pauses and drains an entire engineering root while keeping other roots independent", async () => {
    const coordinator = createAgentWriteSaveCoordinator();
    const active = coordinator.beginEngineeringSave("root-a", "src/main.ts");
    expect(active.ok).toBe(true);
    if (!active.ok) throw new Error("expected the initial engineering save permit");

    let drained = false;
    const paused = coordinator.pauseAndDrainEngineeringRoot("root-a");
    void paused.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(coordinator.beginEngineeringSave("root-b", "src/main.ts").ok).toBe(true);

    active.release();
    const rootPause = await paused;
    expect(coordinator.beginEngineeringSave("root-a", "README.md").ok).toBe(false);
    expect(coordinator.beginEngineeringSave("root-b", "README.md").ok).toBe(true);

    rootPause.release();
    expect(coordinator.beginEngineeringSave("root-a", "README.md").ok).toBe(true);
  });
});

describe("engineering workspace save IPC", () => {
  test("uses the Main-owned active root binding and rejects a paused root before application save", async () => {
    const coordinator = createAgentWriteSaveCoordinator();
    const rootPause = await coordinator.pauseAndDrainEngineeringRoot("root-a");
    const saveEngineeringTextFile = async () => ok({ kind: "saved" as const });
    const handlers = createApplicationIpcHandlers({ saveEngineeringTextFile } as never, {
      agentWriteSaveCoordinator: coordinator,
      getActiveEngineeringEditorRootBindingId: () => "root-a",
      assertEngineeringRecoveryAllowed: async () => ok(undefined)
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    await expect(
      handlers["application:workspace:save-text-file"](saveRequest())
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_SAVE_PAUSED_FOR_AGENT_WRITE" }
    });
    rootPause.release();

    await expect(handlers["application:workspace:save-text-file"](saveRequest())).resolves.toEqual(
      ok({ kind: "saved" })
    );
  });

  test("fails closed when Main has no authoritative root or it changes before dispatch", async () => {
    let saveCalls = 0;
    const application = {
      saveEngineeringTextFile: async () => {
        saveCalls += 1;
        return ok({ kind: "saved" as const });
      }
    };
    const coordinator = createAgentWriteSaveCoordinator();
    const unavailable = createApplicationIpcHandlers(application as never, {
      agentWriteSaveCoordinator: coordinator
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    await expect(
      unavailable["application:workspace:save-text-file"](saveRequest())
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_SAVE_COORDINATOR_UNAVAILABLE" }
    });

    let rootReads = 0;
    const changed = createApplicationIpcHandlers(application as never, {
      agentWriteSaveCoordinator: coordinator,
      getActiveEngineeringEditorRootBindingId: () => (rootReads++ === 0 ? "root-a" : "root-b"),
      assertEngineeringRecoveryAllowed: async () => ok(undefined)
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    await expect(
      changed["application:workspace:save-text-file"](saveRequest())
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_SAVE_ROOT_BINDING_CHANGED" }
    });
    expect(saveCalls).toBe(0);
  });

  test("blocks save when startup recovery is blocked or unavailable", async () => {
    const application = {
      saveEngineeringTextFile: vi.fn(async () => ok({ kind: "saved" as const }))
    };
    for (const assertEngineeringRecoveryAllowed of [
      async () => ({
        ok: false as const,
        error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
      }),
      async () => {
        throw new Error("scan unavailable");
      }
    ]) {
      const handlers = createApplicationIpcHandlers(application as never, {
        agentWriteSaveCoordinator: createAgentWriteSaveCoordinator(),
        getActiveEngineeringEditorRootBindingId: () => "root-a",
        assertEngineeringRecoveryAllowed: assertEngineeringRecoveryAllowed as never
      }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
      await expect(
        handlers["application:workspace:save-text-file"](saveRequest())
      ).resolves.toMatchObject({
        ok: false
      });
    }
    expect(application.saveEngineeringTextFile).not.toHaveBeenCalled();
  });
});

describe("engineering workspace recovery lifecycle gate", () => {
  test("allows leaving the workspace but blocks entering another engineering workspace", async () => {
    const workspaceActivationCoordinator = {
      openCreativeProject: vi.fn(async () => ok({ kind: "creativeProject" as const })),
      openEngineeringWorkspace: vi.fn(async () => ok({ kind: "engineeringWorkspace" as const })),
      closeCurrentWorkspace: vi.fn(async () => ok({ kind: "none" as const }))
    };
    const applicationRoot = process.cwd();
    const handlers = createApplicationIpcHandlers({ executeCommand: vi.fn() } as never, {
      chooseOpenProjectDirectory: async () => applicationRoot,
      chooseEngineeringDirectory: async () => applicationRoot,
      workspaceActivationCoordinator: workspaceActivationCoordinator as never,
      agentRuntimeManager: {
        active: () => ({ scope: "workspace", binding: { kind: "engineeringWorkspace" } }),
        subscribeAgentRunEvents: () => () => undefined
      } as never,
      getActiveEngineeringEditorRootBindingId: () => "root-a",
      assertEngineeringRecoveryAllowed: async () =>
        ({
          ok: false as const,
          error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
        }) as never
    }) as unknown as Record<string, (...args: readonly unknown[]) => Promise<unknown>>;

    await expect(
      handlers["application:execute-command"]("workspace.close-current")
    ).resolves.toEqual(ok({ kind: "none" }));
    expect(workspaceActivationCoordinator.closeCurrentWorkspace).toHaveBeenCalledTimes(1);

    const creativeSelection =
      await handlers["application:project:choose-open-creative-directory"]();
    expect(creativeSelection).toMatchObject({ ok: true, value: { canceled: false } });
    if (!creativeSelection.ok || creativeSelection.value.selectionId === undefined) {
      throw new Error("expected a creative project directory selection");
    }
    await expect(
      handlers["application:project:open-creative-project"](creativeSelection.value.selectionId)
    ).resolves.toEqual(ok({ kind: "creativeProject" }));
    expect(workspaceActivationCoordinator.openCreativeProject).toHaveBeenCalledWith(
      applicationRoot
    );

    const engineeringSelection =
      await handlers["application:workspace:choose-engineering-directory"]();
    expect(engineeringSelection).toMatchObject({ ok: true, value: { canceled: false } });
    if (!engineeringSelection.ok || engineeringSelection.value.selectionId === undefined) {
      throw new Error("expected an engineering workspace directory selection");
    }
    await expect(
      handlers["application:workspace:open-engineering-workspace"](
        engineeringSelection.value.selectionId
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
    });
    expect(workspaceActivationCoordinator.openEngineeringWorkspace).not.toHaveBeenCalled();
  });
});

function saveRequest() {
  return {
    path: "src/main.ts",
    content: "export {};",
    expectedChecksum: "sha256:old"
  };
}

function savedSnapshot(chapterId: string) {
  return ok({
    state: {
      dirty: false,
      chapter: {
        frontmatter: { id: chapterId }
      }
    }
  });
}
