import { createUnifiedError, err, ok } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  createEngineeringWorkspaceSession,
  type EngineeringTextFileSnapshot,
  type EngineeringWorkspaceLockPort,
  type EngineeringWorkspaceRepositoryPort,
  type EngineeringWorkspaceStatePort,
  type EngineeringWorkspaceTreeSnapshot
} from "../src/engineering-workspace-session.js";

const tree: EngineeringWorkspaceTreeSnapshot = {
  truncated: false,
  nodes: [
    { id: "file:project.json", name: "project.json", kind: "file", path: "project.json" },
    {
      id: "folder:chapters",
      name: "chapters",
      kind: "directory",
      path: "chapters",
      children: [
        {
          id: "file:chapters/ch_01.md",
          name: "ch_01.md",
          kind: "file",
          path: "chapters/ch_01.md"
        }
      ]
    },
    { id: "file:notes.txt", name: "notes.txt", kind: "file", path: "notes.txt" }
  ]
};

describe("EngineeringWorkspaceSession", () => {
  test("opens an ordinary workspace only after state resolution and lock acquisition", async () => {
    const calls: string[] = [];
    const repository = createRepository({
      openWorkspace: async () => {
        calls.push("repository:open");
        return ok({
          canonicalContentRoot: "D:/code/example",
          displayName: "example",
          tree
        });
      }
    });
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        calls.push(`repository:create:${contentRoot}`);
        return repository;
      },
      createStatePort() {
        calls.push("state:create");
        return {
          async resolveState(canonicalContentRoot) {
            calls.push(`state:resolve:${canonicalContentRoot}`);
            return ok({ workspaceId: "ws_01", stateRoot: "C:/state/ws_01" });
          }
        };
      },
      createLockPort(stateRoot) {
        calls.push(`lock:create:${stateRoot}`);
        return {
          async acquireWorkspaceLock() {
            calls.push("lock:acquire");
            return ok(undefined);
          },
          async releaseWorkspaceLock() {
            calls.push("lock:release");
            return ok(undefined);
          }
        };
      }
    });

    const opened = await session.openEngineeringWorkspace("D:/code/example");

    expect(opened).toMatchObject({
      ok: true,
      value: {
        context: {
          kind: "engineeringWorkspace",
          workspaceId: "ws_01",
          displayName: "example",
          contentRoot: "D:/code/example",
          stateRoot: "C:/state/ws_01",
          capabilities: ["engineeringWorkbench", "generalFileContext"]
        },
        snapshot: {
          workspaceId: "ws_01",
          displayName: "example",
          tree
        }
      }
    });
    expect(session.getSnapshot()).toEqual(opened.ok ? opened.value.snapshot : undefined);
    expect(calls).toEqual([
      "repository:create:D:/code/example",
      "repository:open",
      "state:create",
      "state:resolve:D:/code/example",
      "lock:create:C:/state/ws_01",
      "lock:acquire"
    ]);
  });

  test("keeps the previous snapshot and lock when a candidate open fails", async () => {
    const firstLock = createLockPort();
    const openFailure = testError("ENGINEERING_WORKSPACE_OPEN_FAILED");
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        return contentRoot === "first"
          ? createRepository({
              openWorkspace: async () =>
                ok({ canonicalContentRoot: "first", displayName: "first", tree })
            })
          : createRepository({ openWorkspace: async () => err(openFailure) });
      },
      createStatePort: () => createStatePort(),
      createLockPort: () => firstLock.port
    });
    const first = await session.openEngineeringWorkspace("first");
    if (!first.ok) throw new Error(first.error.message);

    const failed = await session.openEngineeringWorkspace("second");

    expect(failed).toEqual(err(openFailure));
    expect(session.getSnapshot()).toEqual(first.value.snapshot);
    expect(firstLock.releaseCalls).toBe(0);
  });

  test("returns an open failure when workspace state resolution rejects", async () => {
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort: () => ({
        async resolveState() {
          throw new Error("state storage unavailable");
        }
      }),
      createLockPort: () => createLockPort().port
    });

    const failed = await session.openEngineeringWorkspace("workspace");

    expect(failed).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_OPEN_FAILED" }
    });
    expect(session.getSnapshot()).toBeUndefined();
  });

  test("cleans up a candidate lock when acquisition rejects", async () => {
    const lock = createLockPort({ acquireError: new Error("lock acquisition rejected") });
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort: () => createStatePort(),
      createLockPort: () => lock.port
    });

    const failed = await session.openEngineeringWorkspace("workspace");

    expect(failed).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_LOCK_ACQUIRE_FAILED" }
    });
    expect(session.getSnapshot()).toBeUndefined();
    expect(lock.acquireCalls).toBe(1);
    expect(lock.releaseCalls).toBe(1);
  });

  test("reports cleanup failure after lock acquisition rejects", async () => {
    const cleanupFailure = testError("CANDIDATE_LOCK_RELEASE_FAILED");
    const lock = createLockPort({
      acquireError: new Error("lock acquisition rejected"),
      releaseResult: err(cleanupFailure)
    });
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort: () => createStatePort(),
      createLockPort: () => lock.port
    });

    const failed = await session.openEngineeringWorkspace("workspace");

    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_WORKSPACE_LOCK_ROLLBACK_FAILED",
        redactedDetail: {
          primaryErrorCode: "ENGINEERING_WORKSPACE_LOCK_ACQUIRE_FAILED",
          candidateCleanupErrorCode: "CANDIDATE_LOCK_RELEASE_FAILED"
        }
      }
    });
    expect(session.getSnapshot()).toBeUndefined();
    expect(lock.releaseCalls).toBe(1);
  });

  test("releases a locked candidate when the previous lock cannot be released", async () => {
    const previousReleaseFailure = testError("ENGINEERING_WORKSPACE_LOCK_RELEASE_FAILED");
    const firstLock = createLockPort({ releaseResult: err(previousReleaseFailure) });
    const secondLock = createLockPort();
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        return createRepository({
          openWorkspace: async () =>
            ok({ canonicalContentRoot: contentRoot, displayName: contentRoot, tree })
        });
      },
      createStatePort: () => createStatePort(),
      createLockPort(stateRoot) {
        return stateRoot.endsWith("first") ? firstLock.port : secondLock.port;
      }
    });
    const first = await session.openEngineeringWorkspace("first");
    if (!first.ok) throw new Error(first.error.message);

    const failed = await session.openEngineeringWorkspace("second");

    expect(failed).toEqual(err(previousReleaseFailure));
    expect(session.getSnapshot()).toEqual(first.value.snapshot);
    expect(firstLock.releaseCalls).toBe(1);
    expect(secondLock.acquireCalls).toBe(1);
    expect(secondLock.releaseCalls).toBe(1);
  });

  test("normalizes a rejected previous-lock release and cleans up the candidate", async () => {
    const firstLock = createLockPort({ releaseError: new Error("release rejected") });
    const secondLock = createLockPort();
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        return createRepository({
          openWorkspace: async () =>
            ok({ canonicalContentRoot: contentRoot, displayName: contentRoot, tree })
        });
      },
      createStatePort: () => createStatePort(),
      createLockPort(stateRoot) {
        return stateRoot.endsWith("first") ? firstLock.port : secondLock.port;
      }
    });
    const first = await session.openEngineeringWorkspace("first");
    if (!first.ok) throw new Error(first.error.message);

    const failed = await session.openEngineeringWorkspace("second");

    expect(failed).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_LOCK_RELEASE_FAILED" }
    });
    expect(session.getSnapshot()).toEqual(first.value.snapshot);
    expect(firstLock.releaseCalls).toBe(1);
    expect(secondLock.releaseCalls).toBe(1);
  });

  test("reports candidate cleanup failure while retaining the previous activation", async () => {
    const previousFailure = testError("PREVIOUS_LOCK_RELEASE_FAILED");
    const candidateFailure = testError("CANDIDATE_LOCK_RELEASE_FAILED");
    const firstLock = createLockPort({ releaseResult: err(previousFailure) });
    const secondLock = createLockPort({ releaseResult: err(candidateFailure) });
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        return createRepository({
          openWorkspace: async () =>
            ok({ canonicalContentRoot: contentRoot, displayName: contentRoot, tree })
        });
      },
      createStatePort: () => createStatePort(),
      createLockPort(stateRoot) {
        return stateRoot.endsWith("first") ? firstLock.port : secondLock.port;
      }
    });
    const first = await session.openEngineeringWorkspace("first");
    if (!first.ok) throw new Error(first.error.message);

    const failed = await session.openEngineeringWorkspace("second");

    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_WORKSPACE_LOCK_ROLLBACK_FAILED",
        redactedDetail: {
          primaryErrorCode: "PREVIOUS_LOCK_RELEASE_FAILED",
          candidateCleanupErrorCode: "CANDIDATE_LOCK_RELEASE_FAILED"
        }
      }
    });
    expect(session.getSnapshot()).toEqual(first.value.snapshot);
    expect(firstLock.releaseCalls).toBe(1);
    expect(secondLock.releaseCalls).toBe(1);
  });

  test("serializes concurrent activation commits and releases the intermediate candidate lock", async () => {
    const firstRelease =
      deferred<Awaited<ReturnType<EngineeringWorkspaceLockPort["releaseWorkspaceLock"]>>>();
    let firstReleaseCalls = 0;
    const firstLock: EngineeringWorkspaceLockPort = {
      async acquireWorkspaceLock() {
        return ok(undefined);
      },
      async releaseWorkspaceLock() {
        firstReleaseCalls += 1;
        return firstRelease.promise;
      }
    };
    const secondLock = createLockPort();
    const thirdLock = createLockPort();
    const session = createEngineeringWorkspaceSession({
      createRepository(contentRoot) {
        return createRepository({
          openWorkspace: async () =>
            ok({ canonicalContentRoot: contentRoot, displayName: contentRoot, tree })
        });
      },
      createStatePort: () => createStatePort(),
      createLockPort(stateRoot) {
        if (stateRoot.endsWith("first")) return firstLock;
        return stateRoot.endsWith("second") ? secondLock.port : thirdLock.port;
      }
    });
    const first = await session.openEngineeringWorkspace("first");
    if (!first.ok) throw new Error(first.error.message);

    const openingSecond = session.openEngineeringWorkspace("second");
    const openingThird = session.openEngineeringWorkspace("third");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const releaseCallsBeforeGate = firstReleaseCalls;
    firstRelease.resolve(ok(undefined));
    const [second, third] = await Promise.all([openingSecond, openingThird]);

    expect(second).toMatchObject({ ok: true });
    expect(third).toMatchObject({ ok: true });
    expect(releaseCallsBeforeGate).toBe(1);
    expect(firstReleaseCalls).toBe(1);
    expect(secondLock.releaseCalls).toBe(1);
    expect(thirdLock.releaseCalls).toBe(0);
    expect(session.getSnapshot()).toMatchObject({ workspaceId: "ws_third" });
  });

  test("attaches a creative project without resolving state or acquiring another lock", async () => {
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort() {
        throw new Error("creative attach must not resolve state");
      },
      createLockPort() {
        throw new Error("creative attach must not acquire another lock");
      }
    });

    const attached = await session.attachCreativeProject({
      projectId: "prj_01",
      projectRoot: "D:/novels/example"
    });

    expect(attached).toMatchObject({
      ok: true,
      value: {
        context: {
          kind: "engineeringWorkspace",
          workspaceId: "prj_01",
          contentRoot: "D:/novels/example",
          stateRoot: "D:/novels/example"
        },
        snapshot: {
          workspaceId: "prj_01",
          tree: {
            nodes: [
              expect.objectContaining({ path: "project.json", readOnlyReason: expect.any(String) }),
              expect.objectContaining({
                path: "chapters",
                readOnlyReason: expect.any(String),
                children: [
                  expect.objectContaining({
                    path: "chapters/ch_01.md",
                    readOnlyReason: expect.any(String)
                  })
                ]
              }),
              expect.objectContaining({ path: "notes.txt" })
            ]
          }
        }
      }
    });
    if (attached.ok) {
      expect(
        attached.value.snapshot.tree.nodes.find((node) => node.path === "notes.txt")
      ).not.toHaveProperty("readOnlyReason");
    }
  });

  test("keeps managed creative assets readable but rejects manual saves", async () => {
    let saveCalls = 0;
    const repository = createRepository({
      readTextFile: async (path) => ok(textSnapshot(path, "managed content\n")),
      saveTextFile: async () => {
        saveCalls += 1;
        return ok({ kind: "saved", document: textSnapshot("notes.txt", "saved\n") });
      }
    });
    const session = createEngineeringWorkspaceSession({
      createRepository: () => repository,
      createStatePort: () => createStatePort(),
      createLockPort: () => createLockPort().port
    });
    const attached = await session.attachCreativeProject({
      projectId: "prj_01",
      projectRoot: "D:/novels/example"
    });
    if (!attached.ok) throw new Error(attached.error.message);

    const read = await session.readTextFile("chapters/ch_01.md");
    expect(read).toMatchObject({
      ok: true,
      value: { path: "chapters/ch_01.md", readOnlyReason: expect.any(String) }
    });
    for (const path of [
      "project.json",
      "settings.json",
      "chapters/ch_01.md",
      "characters/item.md",
      "world/item.md",
      "outline/item.md",
      "timeline/item.md",
      "memories/item.md",
      "prompts/item.md",
      "agents/item.md",
      "workflow/item.yaml",
      "plugins/item.json",
      "history/item.json",
      "cache/item.json",
      ".novel-studio/project-lock.json"
    ]) {
      expect(
        await session.saveTextFile({
          path,
          content: "manual edit\n",
          expectedChecksum: "0".repeat(64)
        })
      ).toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MANAGED_ASSET_WRITE_REJECTED" }
      });
    }
    expect(saveCalls).toBe(0);
  });

  test("forwards non-managed creative files to the repository conflict contract", async () => {
    const current = textSnapshot("notes.txt", "external\n");
    const repository = createRepository({
      saveTextFile: async () => ok({ kind: "conflict", current, attemptedContent: "draft\n" })
    });
    const session = createEngineeringWorkspaceSession({
      createRepository: () => repository,
      createStatePort: () => createStatePort(),
      createLockPort: () => createLockPort().port
    });
    const attached = await session.attachCreativeProject({
      projectId: "prj_01",
      projectRoot: "D:/novels/example"
    });
    if (!attached.ok) throw new Error(attached.error.message);

    const saved = await session.saveTextFile({
      path: "notes.txt",
      content: "draft\n",
      expectedChecksum: "0".repeat(64)
    });

    expect(saved).toEqual(ok({ kind: "conflict", current, attemptedContent: "draft\n" }));
  });

  test("releases an owned engineering workspace lock once", async () => {
    const lock = createLockPort();
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort: () => createStatePort(),
      createLockPort: () => lock.port
    });
    const opened = await session.openEngineeringWorkspace("workspace");
    if (!opened.ok) throw new Error(opened.error.message);

    expect(await session.releaseWorkspaceLock()).toEqual(ok(undefined));
    expect(await session.releaseWorkspaceLock()).toEqual(ok(undefined));
    expect(lock.releaseCalls).toBe(1);
  });

  test("returns a lock error when public release rejects and keeps the lock active", async () => {
    const lock = createLockPort({ releaseError: new Error("release rejected") });
    const session = createEngineeringWorkspaceSession({
      createRepository: () => createRepository(),
      createStatePort: () => createStatePort(),
      createLockPort: () => lock.port
    });
    const opened = await session.openEngineeringWorkspace("workspace");
    if (!opened.ok) throw new Error(opened.error.message);

    const failed = await session.releaseWorkspaceLock();

    expect(failed).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_LOCK_RELEASE_FAILED" }
    });
    expect(session.getSnapshot()).toEqual(opened.value.snapshot);
    expect(lock.releaseCalls).toBe(1);
  });

  test("does not apply creative managed-path rules after releasing an ordinary lock", async () => {
    let saveCalls = 0;
    const session = createEngineeringWorkspaceSession({
      createRepository: () =>
        createRepository({
          saveTextFile: async (input) => {
            saveCalls += 1;
            return ok({ kind: "saved", document: textSnapshot(input.path, input.content) });
          }
        }),
      createStatePort: () => createStatePort(),
      createLockPort: () => createLockPort().port
    });
    const opened = await session.openEngineeringWorkspace("ordinary");
    if (!opened.ok) throw new Error(opened.error.message);
    await session.releaseWorkspaceLock();

    const saved = await session.saveTextFile({
      path: "chapters/ch_01.md",
      content: "manual engineering edit\n",
      expectedChecksum: "0".repeat(64)
    });

    expect(saved).toMatchObject({ ok: true, value: { kind: "saved" } });
    expect(saveCalls).toBe(1);
  });
});

function createRepository(
  overrides: Partial<EngineeringWorkspaceRepositoryPort> = {}
): EngineeringWorkspaceRepositoryPort {
  return {
    openWorkspace: async () =>
      ok({
        canonicalContentRoot: "D:/novels/example",
        displayName: "example",
        tree
      }),
    readTextFile: async (path) => ok(textSnapshot(path, "content\n")),
    saveTextFile: async (input) =>
      ok({ kind: "saved", document: textSnapshot(input.path, input.content) }),
    ...overrides
  };
}

function createStatePort(): EngineeringWorkspaceStatePort {
  return {
    async resolveState(canonicalContentRoot) {
      return ok({
        workspaceId: `ws_${canonicalContentRoot}`,
        stateRoot: `state_${canonicalContentRoot}`
      });
    }
  };
}

function createLockPort(
  options: {
    readonly acquireResult?: Awaited<
      ReturnType<EngineeringWorkspaceLockPort["acquireWorkspaceLock"]>
    >;
    readonly releaseResult?: Awaited<
      ReturnType<EngineeringWorkspaceLockPort["releaseWorkspaceLock"]>
    >;
    readonly acquireError?: Error;
    readonly releaseError?: Error;
  } = {}
) {
  let acquireCalls = 0;
  let releaseCalls = 0;
  const port: EngineeringWorkspaceLockPort = {
    async acquireWorkspaceLock() {
      acquireCalls += 1;
      if (options.acquireError !== undefined) throw options.acquireError;
      return options.acquireResult ?? ok(undefined);
    },
    async releaseWorkspaceLock() {
      releaseCalls += 1;
      if (options.releaseError !== undefined) throw options.releaseError;
      return options.releaseResult ?? ok(undefined);
    }
  };
  return {
    port,
    get acquireCalls() {
      return acquireCalls;
    },
    get releaseCalls() {
      return releaseCalls;
    }
  };
}

function textSnapshot(path: string, content: string): EngineeringTextFileSnapshot {
  return {
    path,
    content,
    checksum: "a".repeat(64),
    byteLength: Buffer.byteLength(content, "utf8")
  };
}

function testError(code: string) {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry the operation.",
    traceId: "engineering-workspace-session-test"
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
