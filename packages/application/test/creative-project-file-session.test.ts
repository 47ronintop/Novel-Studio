import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  createCreativeProjectFileSession,
  type CreativeProjectFileDocument,
  type CreativeProjectFileLifecycleCommand,
  type CreativeProjectFileLifecycleReceipt,
  type CreativeProjectFileRepositoryPort,
  type CreativeProjectFileSaveResult,
  type CreativeProjectFileSessionIdentity,
  type CreativeProjectFileTreeSnapshot
} from "../src/creative-project-file-session.js";

const first = { projectId: "prj_first", workspaceId: "ws_first" } as const;
const second = { projectId: "prj_second", workspaceId: "ws_second" } as const;

describe("CreativeProjectFileSession", () => {
  test("binds repositories to Main activation and never forwards or returns a root in renderer operations", async () => {
    const calls: unknown[] = [];
    const leakedTree = tree(first, "tree:first");
    Object.defineProperty(leakedTree, "projectRoot", { value: "D:/novels/first" });
    const firstRepository = createRepository(first, "tree:first", {
      getTreeSnapshot: async () => ok(leakedTree)
    });
    const secondRepository = createRepository(second, "tree:second");
    const session = createCreativeProjectFileSession({
      createRepository(activation) {
        calls.push(activation);
        return activation.projectId === first.projectId ? firstRepository : secondRepository;
      }
    });

    const opened = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value).toMatchObject(first);
    expect(JSON.stringify(opened.value)).not.toContain("D:/novels/first");
    expect(calls).toEqual([{ ...first, projectRoot: "D:/novels/first" }]);

    const wrongRead = await session.readTextFile({ ...second, path: "notes.md" });
    expect(wrongRead).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED" }
    });
    expect(firstRepository.readCalls).toBe(0);

    const openedSecond = await session.activate({ ...second, projectRoot: "D:/novels/second" });
    if (!openedSecond.ok) throw new Error(openedSecond.error.message);
    expect(session.getActiveIdentity()).toEqual(second);
    const staleRead = await session.readTextFile({ ...first, path: "notes.md" });
    expect(staleRead).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED" }
    });
    const currentRead = await session.readTextFile({ ...second, path: "notes.md" });
    expect(currentRead).toMatchObject({ ok: true, value: { ...second, path: "notes.md" } });
    expect(secondRepository.readCalls).toBe(1);
  });

  test("rejects a response that completes after the active creative project changes", async () => {
    const delayed = deferred<Result<CreativeProjectFileDocument, UnifiedError>>();
    const firstRepository = createRepository(first, "tree:first", {
      readTextFile: async () => delayed.promise
    });
    const secondRepository = createRepository(second, "tree:second");
    const session = createCreativeProjectFileSession({
      createRepository(activation) {
        return activation.projectId === first.projectId ? firstRepository : secondRepository;
      }
    });
    const firstActivation = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!firstActivation.ok) throw new Error(firstActivation.error.message);

    const reading = session.readTextFile({ ...first, path: "notes.md" });
    const secondActivation = await session.activate({ ...second, projectRoot: "D:/novels/second" });
    if (!secondActivation.ok) throw new Error(secondActivation.error.message);
    delayed.resolve(ok(document(first, "notes.md")));

    expect(await reading).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_STALE" }
    });
  });

  test("holds a mutation lease until an active save completes before switching projects", async () => {
    const saveStarted = deferred<undefined>();
    const saveResult = deferred<Result<CreativeProjectFileSaveResult, UnifiedError>>();
    const createCalls: string[] = [];
    const firstRepository = createRepository(first, "tree:first", {
      saveTextFile: async () => {
        saveStarted.resolve(undefined);
        return saveResult.promise;
      }
    });
    const secondRepository = createRepository(second, "tree:second");
    const session = createCreativeProjectFileSession({
      createRepository(activation) {
        createCalls.push(activation.projectId);
        return activation.projectId === first.projectId ? firstRepository : secondRepository;
      }
    });
    const activated = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!activated.ok) throw new Error(activated.error.message);

    const saving = session.saveTextFile({
      ...first,
      path: "notes.md",
      content: "updated\n",
      expectedTreeRevision: "tree:first",
      expectedNodeRevision: "node:current",
      expectedChecksum: "a".repeat(64)
    });
    await saveStarted.promise;

    const switching = session.activate({ ...second, projectRoot: "D:/novels/second" });
    await Promise.resolve();
    expect(createCalls).toEqual([first.projectId]);
    expect(session.getActiveIdentity()).toEqual(first);

    saveResult.resolve(
      ok({
        kind: "saved",
        treeRevision: "tree:first",
        document: {
          ...document(first, "notes.md"),
          content: "updated\n",
          checksum: "b".repeat(64),
          byteLength: 8
        }
      })
    );

    expect(await saving).toMatchObject({ ok: true, value: { kind: "saved" } });
    expect(await switching).toMatchObject({ ok: true, value: second });
    expect(createCalls).toEqual([first.projectId, second.projectId]);
  });

  test("rejects old lifecycle commands queued after deactivation without forwarding them", async () => {
    const repository = createRepository(first, "tree:first");
    const session = createCreativeProjectFileSession({ createRepository: () => repository });
    const activated = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!activated.ok) throw new Error(activated.error.message);
    const command: CreativeProjectFileLifecycleCommand = {
      schemaVersion: "1.0",
      ...first,
      kind: "createTextFile",
      commandId: "create-after-deactivate",
      expectedTreeRevision: "tree:first",
      path: "notes.md",
      content: "body\n"
    };

    session.deactivate();
    const result = await session.executeLifecycleCommand(command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_UNAVAILABLE" }
    });
    expect(repository.commands).toEqual([]);
  });

  test("holds lifecycle mutations before activation so a create cannot reach the old project after the switch", async () => {
    const commandStarted = deferred<undefined>();
    const commandResult = deferred<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>();
    const createCalls: string[] = [];
    const command: CreativeProjectFileLifecycleCommand = {
      schemaVersion: "1.0",
      ...first,
      kind: "createTextFile",
      commandId: "create-before-switch",
      expectedTreeRevision: "tree:first",
      path: "notes.md",
      content: "body\n"
    };
    const firstRepository = createRepository(first, "tree:first", {
      executeLifecycleCommand: async () => {
        commandStarted.resolve(undefined);
        return commandResult.promise;
      }
    });
    const secondRepository = createRepository(second, "tree:second");
    const session = createCreativeProjectFileSession({
      createRepository(activation) {
        createCalls.push(activation.projectId);
        return activation.projectId === first.projectId ? firstRepository : secondRepository;
      }
    });
    const activated = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!activated.ok) throw new Error(activated.error.message);

    const creating = session.executeLifecycleCommand(command);
    await commandStarted.promise;
    const switching = session.activate({ ...second, projectRoot: "D:/novels/second" });
    await Promise.resolve();
    expect(createCalls).toEqual([first.projectId]);

    commandResult.resolve(ok(receipt(first, command)));

    expect(await creating).toMatchObject({
      ok: true,
      value: { ...first, commandId: command.commandId }
    });
    expect(await switching).toMatchObject({ ok: true, value: second });
    expect(createCalls).toEqual([first.projectId, second.projectId]);
  });

  test("forwards lifecycle commands only for the active identity and refreshes its cached tree", async () => {
    const repository = createRepository(first, "tree:first");
    const session = createCreativeProjectFileSession({ createRepository: () => repository });
    const activated = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!activated.ok) throw new Error(activated.error.message);
    const command: CreativeProjectFileLifecycleCommand = {
      schemaVersion: "1.0",
      ...first,
      kind: "createTextFile",
      commandId: "create-note",
      expectedTreeRevision: "tree:first",
      path: "notes.md",
      content: "body\n"
    };

    const receipt = await session.executeLifecycleCommand(command);

    expect(receipt).toMatchObject({ ok: true, value: { ...first, commandId: "create-note" } });
    expect(repository.commands).toEqual([command]);
    expect(session.getSnapshot()).toMatchObject({ treeRevision: "tree:after-command" });
    const oldCommand: CreativeProjectFileLifecycleCommand = { ...command, ...second };
    expect(await session.executeLifecycleCommand(oldCommand)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED" }
    });
  });

  test("keeps the current session active if a candidate project file activation fails", async () => {
    const firstRepository = createRepository(first, "tree:first");
    const unavailable = testError("CREATIVE_PROJECT_FILE_TREE_READ_FAILED");
    const session = createCreativeProjectFileSession({
      createRepository(activation) {
        return activation.projectId === first.projectId
          ? firstRepository
          : createRepository(second, "tree:second", {
              getTreeSnapshot: async () => err(unavailable)
            });
      }
    });
    const firstActivation = await session.activate({ ...first, projectRoot: "D:/novels/first" });
    if (!firstActivation.ok) throw new Error(firstActivation.error.message);

    const failed = await session.activate({ ...second, projectRoot: "D:/novels/second" });

    expect(failed).toEqual(err(unavailable));
    expect(session.getActiveIdentity()).toEqual(first);
    expect(session.getSnapshot()).toMatchObject(first);
  });

  test("fails closed when a repository returns an unsupported tree snapshot version", async () => {
    const malformed = tree(first, "tree:first");
    Object.defineProperty(malformed, "schemaVersion", { value: "2.0" });
    const repository = createRepository(first, "tree:first", {
      getTreeSnapshot: async () => ok(malformed)
    });
    const session = createCreativeProjectFileSession({ createRepository: () => repository });

    const activation = await session.activate({ ...first, projectRoot: "D:/novels/first" });

    expect(activation).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_SESSION_TREE_INVALID" }
    });
    expect(session.getSnapshot()).toBeUndefined();
  });

  test("rejects saves and lifecycle commands from a nested read-only session", async () => {
    const repository = createRepository(first, "tree:first", {
      getTreeSnapshot: async () => ok(tree(first, "tree:first", "nested-folder"))
    });
    const session = createCreativeProjectFileSession({ createRepository: () => repository });
    const activation = await session.activate({
      ...first,
      projectRoot: "D:/novels/source/.shanhai",
      displayRoot: "D:/novels/source",
      workspaceLayout: "nested-folder"
    });
    if (!activation.ok) throw new Error(activation.error.message);

    expect(
      await session.saveTextFile({
        ...first,
        path: "source.md",
        content: "changed\n",
        expectedTreeRevision: "tree:first",
        expectedNodeRevision: "node:current",
        expectedChecksum: "a".repeat(64)
      })
    ).toMatchObject({ ok: false, error: { code: "CREATIVE_PROJECT_FILE_READ_ONLY" } });
    expect(
      await session.executeLifecycleCommand({
        schemaVersion: "1.0",
        ...first,
        kind: "createTextFile",
        commandId: "read-only-create",
        expectedTreeRevision: "tree:first",
        path: "new.md",
        content: "new\n"
      })
    ).toMatchObject({ ok: false, error: { code: "CREATIVE_PROJECT_FILE_READ_ONLY" } });
    expect(repository.commands).toEqual([]);
  });
});

function createRepository(
  identity: CreativeProjectFileSessionIdentity,
  initialTreeRevision: string,
  overrides: Partial<CreativeProjectFileRepositoryPort> = {}
) {
  let treeRevision = initialTreeRevision;
  let readCalls = 0;
  const commands: CreativeProjectFileLifecycleCommand[] = [];
  const repository: CreativeProjectFileRepositoryPort = {
    getTreeSnapshot: async () => ok(tree(identity, treeRevision)),
    readTextFile: async (path) => {
      readCalls += 1;
      return ok(document(identity, path));
    },
    saveTextFile: async (input) =>
      ok({
        kind: "saved",
        treeRevision,
        document: {
          ...document(identity, input.path),
          content: input.content,
          checksum: "b".repeat(64)
        }
      }),
    executeLifecycleCommand: async (command) => {
      commands.push(command);
      treeRevision = "tree:after-command";
      return ok(receipt(identity, command));
    },
    ...overrides
  };
  return {
    ...repository,
    get readCalls() {
      return readCalls;
    },
    commands
  };
}

function tree(
  identity: CreativeProjectFileSessionIdentity,
  treeRevision: string,
  workspaceLayout: "standalone" | "nested-folder" = "standalone"
): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.1",
    ...identity,
    policyVersion: "1.0",
    workspaceLayout,
    mutationMode: workspaceLayout === "nested-folder" ? "read-only" : "read-write",
    treeRevision,
    nodes: [],
    truncated: false,
    truncationReasons: [],
    dependencyManifestChecksum: "a".repeat(64)
  };
}

function document(
  identity: CreativeProjectFileSessionIdentity,
  path: string
): CreativeProjectFileDocument {
  return {
    schemaVersion: "1.0",
    ...identity,
    path,
    content: "body\n",
    checksum: "a".repeat(64),
    byteLength: 5,
    nodeRevision: "node:current"
  };
}

function receipt(
  identity: CreativeProjectFileSessionIdentity,
  command: CreativeProjectFileLifecycleCommand
): CreativeProjectFileLifecycleReceipt {
  return {
    schemaVersion: "1.0",
    ...identity,
    commandId: command.commandId,
    commandKind: command.kind,
    commandFingerprint: "f".repeat(64),
    treeRevision: "tree:after-command",
    affectedPaths: [command.kind === "renamePath" ? command.sourcePath : command.path]
  };
}

function testError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry.",
    traceId: "creative-project-file-session-test"
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
