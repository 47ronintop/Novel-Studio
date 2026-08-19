import { defaultEngineeringPathPolicy } from "@novel-studio/agent-engine";
import type { EngineeringWorkspaceNativeRootIdentity } from "@novel-studio/repository";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const qualification = vi.hoisted(() => ({ hasAccess: vi.fn(() => false) }));

vi.mock("../src/main/engineering-file-access-qualification.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/engineering-file-access-qualification.js")>();
  return {
    ...actual,
    hasMainOwnedEngineeringFileQualification: qualification.hasAccess
  };
});

import { createEngineeringWorkspaceAccessRuntime } from "../src/main/engineering-workspace-access-runtime.js";
import { resolveEngineeringFileAccessAddonPath } from "../src/main/engineering-file-access-adapter.js";

describe("engineering workspace access runtime", () => {
  beforeEach(() => qualification.hasAccess.mockReturnValue(false));

  test("uses the single asar-unpacked addon path for packaged production", () => {
    expect(resolveEngineeringFileAccessAddonPath("C:\\Novel Studio\\resources")).toBe(
      join(
        "C:\\Novel Studio\\resources",
        "app.asar.unpacked",
        "native",
        "engineering-file-access-win32",
        "dist",
        "win32-x64",
        "engineering_file_access.node"
      )
    );
  });

  test("exposes no usable session when Main qualification is unavailable", async () => {
    const loader = { load: vi.fn() };
    const issueRootBinding = vi.fn(() => binding());
    const runtime = createEngineeringWorkspaceAccessRuntime({
      capabilityAuthority: qualificationService(),
      issueRootBinding,
      pathPolicy: defaultEngineeringPathPolicy,
      addonLoader: loader
    });

    await expect(runtime.openWorkspace({ rootPath: "C:\\workspace" })).resolves.toEqual({
      status: "unavailable",
      reason: "qualification_unavailable"
    });
    expect(loader.load).not.toHaveBeenCalled();
    expect(issueRootBinding).not.toHaveBeenCalled();
    expect(Object.keys(runtime)).toEqual(["operations", "openWorkspace"]);
  });

  test("rejects a loaded addon whose B6 access metadata is unavailable", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = validAddon();
    const runtime = createEngineeringWorkspaceAccessRuntime({
      capabilityAuthority: qualificationService(),
      issueRootBinding: (identity) => ({ ...binding(), ...identity }),
      pathPolicy: defaultEngineeringPathPolicy,
      addonLoader: {
        load: vi.fn(() => ({
          status: "loaded" as const,
          addon,
          metadata: metadata({ accessEligible: "unavailable" })
        }))
      }
    });

    await expect(runtime.openWorkspace({ rootPath: "C:\\workspace" })).resolves.toEqual({
      status: "unavailable",
      reason: "native_addon_unavailable"
    });
    expect(addon.openWorkspaceRoot).not.toHaveBeenCalled();
  });

  test("opens one native root, issues its Main binding, and keeps all B6 reads on that session", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = validAddon();
    addon.listDirectory.mockReturnValue([{ name: "main.ts", directory: false, byteLength: 3n }]);
    addon.readFile.mockReturnValue(Buffer.from("one", "utf8"));
    addon.searchText.mockReturnValue({
      matches: [{ relativePath: "src/main.ts", byteOffset: 1n }],
      truncated: false
    });
    addon.buildIndex.mockReturnValue({
      files: [{ relativePath: "src/main.ts", byteLength: 3n }],
      truncated: false
    });
    const issueRootBinding = vi.fn((identity: EngineeringWorkspaceNativeRootIdentity) => ({
      ...binding(),
      ...identity
    }));
    const runtime = runtimeWith(addon, issueRootBinding);

    const opened = await runtime.openWorkspace({ rootPath: "C:\\workspace" });
    expect(opened.status).toBe("available");
    if (opened.status !== "available") throw new Error("expected session");

    await opened.session.listDirectory({ relativeIdentity: "src" });
    await opened.session.readTextFile({ relativeIdentity: "src/main.ts" });
    await opened.session.searchText({ query: "main" });
    await opened.session.buildIndex();

    expect(issueRootBinding).toHaveBeenCalledWith(rootIdentity());
    expect(addon.openWorkspaceRoot).toHaveBeenCalledWith("C:\\workspace");
    expect(addon.listDirectory).toHaveBeenCalledWith(17n, "src");
    expect(addon.readFile).toHaveBeenCalledWith(17n, "src/main.ts");
    expect(addon.searchText).toHaveBeenCalledWith(17n, "main");
    expect(addon.buildIndex).toHaveBeenCalledWith(17n);
    expect("replaceFile" in opened.session).toBe(false);
    expect("createDirectory" in opened.session).toBe(false);
  });

  test("closes a native root and exposes no session when Main's issued binding mismatches its identity", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = validAddon();
    const runtime = runtimeWith(addon, () => ({
      ...binding(),
      directoryIdentity: "0000000000000022"
    }));

    await expect(runtime.openWorkspace({ rootPath: "C:\\workspace" })).resolves.toEqual({
      status: "unavailable",
      reason: "workspace_access_unavailable"
    });
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledOnce();
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledWith(17n);
  });

  test("closes and invalidates the session when native access reports a root change", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = validAddon();
    addon.buildIndex.mockImplementation(() => {
      const error = new Error("changed");
      Object.assign(error, { code: "ENGINEERING_ACCESS_ROOT_CHANGED" });
      throw error;
    });
    const runtime = runtimeWith(addon, (identity) => ({ ...binding(), ...identity }));
    const opened = await runtime.openWorkspace({ rootPath: "C:\\workspace" });
    if (opened.status !== "available") throw new Error("expected session");

    await expect(opened.session.buildIndex()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_ROOT_CHANGED" }
    });
    await expect(opened.session.listDirectory()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledOnce();
    expect(addon.listDirectory).not.toHaveBeenCalled();
  });

  test("closes an active native root immediately when its capability authority is revoked", async () => {
    qualification.hasAccess.mockReturnValue(true);
    const addon = validAddon();
    let revoke: (() => void) | undefined;
    const onQualificationRevoked = vi.fn();
    const runtime = createEngineeringWorkspaceAccessRuntime({
      capabilityAuthority: {
        hasCapability: async () => qualification.hasAccess(),
        subscribeRevocation(listener) {
          revoke = listener;
          return () => {
            revoke = undefined;
          };
        }
      },
      issueRootBinding: (identity) => ({ ...binding(), ...identity }),
      pathPolicy: defaultEngineeringPathPolicy,
      addonLoader: {
        load: vi.fn(() => ({
          status: "loaded" as const,
          addon,
          metadata: metadata()
        }))
      },
      onQualificationRevoked
    });
    const opened = await runtime.openWorkspace({ rootPath: "C:\\workspace" });
    if (opened.status !== "available") throw new Error("expected an available session");

    revoke?.();
    await vi.waitFor(() => expect(addon.closeWorkspaceRoot).toHaveBeenCalledOnce());

    await expect(opened.session.listDirectory()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    expect(onQualificationRevoked).toHaveBeenCalledWith({
      rootBindingId: opened.session.binding.rootBindingId
    });
    expect(addon.listDirectory).not.toHaveBeenCalled();
  });
});

function runtimeWith(
  addon: ReturnType<typeof validAddon>,
  issueRootBinding: (identity: EngineeringWorkspaceNativeRootIdentity) => unknown
) {
  return createEngineeringWorkspaceAccessRuntime({
    capabilityAuthority: qualificationService(),
    issueRootBinding,
    pathPolicy: defaultEngineeringPathPolicy,
    addonLoader: {
      load: vi.fn(() => ({
        status: "loaded" as const,
        addon,
        metadata: metadata()
      }))
    }
  });
}

function qualificationService() {
  return {
    readAttestation: async () => ({}) as never,
    hasCapability: async () => qualification.hasAccess(),
    subscribeRevocation: () => () => undefined
  };
}

function metadata(
  overrides: Partial<{ readonly accessEligible: "available" | "unavailable" }> = {}
) {
  return {
    adapterId: "novel_studio_engineering_file_access" as const,
    target: "win32-x64" as const,
    batch: "6" as const,
    accessEligible: "available" as const,
    mutation: "unavailable" as const,
    recovery: "unavailable" as const,
    ...overrides
  };
}

function validAddon() {
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

function rootIdentity() {
  return {
    volumeIdentity: "d0c0b0a0",
    directoryIdentity: "0000000000000011",
    canonicalPathIdentityChecksum: "a".repeat(64)
  };
}

function binding() {
  return {
    schemaVersion: "1.0" as const,
    rootBindingId: "root_binding_01",
    workspaceId: "workspace_01",
    workspaceKind: "engineeringWorkspace" as const,
    ...rootIdentity(),
    pathPolicyRevision: "engineering-policy-01",
    issuedAt: "2026-08-07T00:00:00.000Z"
  };
}
