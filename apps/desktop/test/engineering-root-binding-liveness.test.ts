import { createHash } from "node:crypto";

import { defaultEngineeringPathPolicy } from "@novel-studio/agent-engine";
import type { EngineeringWorkspaceNativeRootIdentity } from "@novel-studio/repository";
import { ok } from "@novel-studio/shared";
import { describe, expect, test, vi } from "vitest";

const qualification = vi.hoisted(() => ({ hasAccess: vi.fn(() => true) }));

vi.mock("../src/main/engineering-file-access-qualification.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/engineering-file-access-qualification.js")>();
  return { ...actual, hasMainOwnedEngineeringFileQualification: qualification.hasAccess };
});

import { createEngineeringEditorStateRegistry } from "../src/main/engineering-editor-state-registry.js";
import { createEngineeringWorkspaceAccessRuntime } from "../src/main/engineering-workspace-access-runtime.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

describe("B6 engineering root-binding liveness", () => {
  test("a root-change permanently retires the prior native session and binding", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = nativeAddon();
    addon.buildIndex.mockImplementation(() => {
      const failure = new Error("root changed");
      Object.assign(failure, { code: "ENGINEERING_ACCESS_ROOT_CHANGED" });
      throw failure;
    });
    const runtime = createEngineeringWorkspaceAccessRuntime({
      qualificationService: qualificationService(),
      issueRootBinding: (identity) => ({ ...rootBinding("root-before-change"), ...identity }),
      pathPolicy: defaultEngineeringPathPolicy,
      addonLoader: {
        load: vi.fn(() => ({ status: "loaded" as const, addon, metadata: addonMetadata() }))
      }
    });

    const opened = await runtime.openWorkspace({ rootPath: "C:\\workspace" });
    expect(opened).toMatchObject({ status: "available" });
    if (opened.status !== "available") throw new Error("expected native session");
    expect(opened.session.binding.rootBindingId).toBe("root-before-change");

    await expect(opened.session.buildIndex()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_ROOT_CHANGED" }
    });
    await expect(
      opened.session.readTextFile({ relativeIdentity: "src/main.ts" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    await expect(opened.session.close()).resolves.toEqual({ ok: true, value: { closed: true } });
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledOnce();
    expect(addon.readFile).not.toHaveBeenCalled();
  });

  test("a stale root binding cannot decorate a workspace snapshot or authorize editor state", async () => {
    const registry = createEngineeringEditorStateRegistry();
    let activeRootBindingId: string | undefined = "root-current";
    const undecoratedSnapshot = {
      workspaceId: "workspace-01",
      displayName: "Engineering workspace",
      tree: { nodes: [], truncated: false }
    };
    const handlers = createApplicationIpcHandlers(
      {
        async refreshEngineeringTree() {
          return ok(undecoratedSnapshot);
        }
      } as never,
      {
        engineeringEditorStateRegistry: registry,
        getActiveEngineeringEditorRootBindingId: () => activeRootBindingId
      }
    ) as unknown as Record<string, (input?: unknown) => Promise<unknown>>;

    const refresh = handlers["application:workspace:refresh-engineering-tree"];
    const report = handlers["application:engineering-editor:report-state"];
    if (refresh === undefined || report === undefined) throw new Error("expected B6 IPC handlers");

    await expect(refresh()).resolves.toEqual(
      ok({ ...undecoratedSnapshot, rootBindingId: "root-current" })
    );

    activeRootBindingId = "root-replaced";
    await expect(report(editorReport({ rootBindingId: "root-current" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "EDITOR_STATE_ROOT_BINDING_MISMATCH" }
    });
    expect(
      registry.observe({ rootBindingId: "root-current", relativePath: "src/main.ts" })
    ).toMatchObject({ status: "unknown", reason: "missing" });
    await expect(refresh()).resolves.toEqual(
      ok({ ...undecoratedSnapshot, rootBindingId: "root-replaced" })
    );

    activeRootBindingId = undefined;
    await expect(refresh()).resolves.toEqual(ok(undecoratedSnapshot));
    await expect(report(editorReport({ rootBindingId: "root-replaced" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "EDITOR_STATE_UNAVAILABLE" }
    });
  });

  test("a disconnected editor is never mutation-ready", async () => {
    const registry = createEngineeringEditorStateRegistry();
    const target = { rootBindingId: "root-live", relativePath: "src/main.ts" };

    expect(
      registry.report(
        editorReport({
          ...target,
          connection: "disconnected",
          dirty: false,
          bufferContent: "",
          bufferChecksum: checksum("")
        })
      )
    ).toMatchObject({ ok: true });
    expect(registry.readForMutation(target)).toEqual({ status: "unknown", dirty: false });
    expect(registry.decideMutation([target])).toEqual({
      ok: false,
      code: "EDITOR_STATE_UNKNOWN",
      targets: [target]
    });
  });
});

function nativeAddon() {
  return {
    adapterInfo: vi.fn(),
    openWorkspaceRoot: vi.fn(() => ({
      rootId: 17n,
      capability: "available",
      rootIdentity: rootIdentity()
    })),
    closeWorkspaceRoot: vi.fn(() => true),
    listDirectory: vi.fn(() => []),
    readFile: vi.fn(() => Buffer.from("", "utf8")),
    searchText: vi.fn(() => ({ matches: [], truncated: false })),
    buildIndex: vi.fn(() => ({ files: [], truncated: false }))
  };
}

function addonMetadata() {
  return {
    adapterId: "novel_studio_engineering_file_access" as const,
    target: "win32-x64" as const,
    batch: "6" as const,
    accessEligible: "available" as const,
    mutation: "unavailable" as const,
    recovery: "unavailable" as const
  };
}

function rootIdentity(): EngineeringWorkspaceNativeRootIdentity {
  return {
    volumeIdentity: "d0c0b0a0",
    directoryIdentity: "0000000000000011",
    canonicalPathIdentityChecksum: "a".repeat(64)
  };
}

function qualificationService() {
  return {
    readAttestation: async () => ({}) as never,
    hasCapability: async () => qualification.hasAccess(),
    subscribeRevocation: () => () => undefined
  };
}

function rootBinding(rootBindingId: string) {
  return {
    schemaVersion: "1.0" as const,
    rootBindingId,
    workspaceId: "workspace-01",
    workspaceKind: "engineeringWorkspace" as const,
    ...rootIdentity(),
    pathPolicyRevision: "engineering-policy-01",
    issuedAt: "2026-08-07T00:00:00.000Z"
  };
}

function editorReport(overrides: Record<string, unknown> = {}) {
  const bufferContent = "saved";
  return {
    rootBindingId: "root-live",
    relativePath: "src/main.ts",
    editorInstanceId: "editor-01",
    connection: "connected",
    rendererRevision: 1,
    acknowledgedRevision: 1,
    dirty: false,
    bufferChecksum: checksum(bufferContent),
    bufferContent,
    ...overrides
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
