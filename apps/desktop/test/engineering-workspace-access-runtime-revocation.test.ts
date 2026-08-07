import { defaultEngineeringPathPolicy } from "@novel-studio/agent-engine";
import type {
  EngineeringWorkspaceNativeRootIdentity,
  EngineeringWorkspaceRootBinding
} from "@novel-studio/repository";
import { describe, expect, test, vi } from "vitest";

import type { EngineeringFileAccessQualificationService } from "../src/main/engineering-file-access-qualification.js";
import { createEngineeringWorkspaceAccessRuntime } from "../src/main/engineering-workspace-access-runtime.js";

describe("engineering workspace access runtime qualification revocation", () => {
  test("immediately retires an open native session and blocks native reads when Main revokes qualification", async () => {
    const service = revocableQualificationService();
    const addon = nativeAddon();
    const onQualificationRevoked = vi.fn();
    const runtime = createEngineeringWorkspaceAccessRuntime({
      qualificationService: service,
      issueRootBinding: (identity) => ({ ...binding(), ...identity }),
      pathPolicy: defaultEngineeringPathPolicy,
      addonLoader: {
        load: () => ({
          status: "loaded" as const,
          addon,
          metadata: {
            adapterId: "novel_studio_engineering_file_access" as const,
            target: "win32-x64" as const,
            batch: "6" as const,
            accessEligible: "available" as const,
            mutation: "unavailable" as const,
            recovery: "unavailable" as const
          }
        })
      },
      onQualificationRevoked
    });

    const opened = await runtime.openWorkspace({ rootPath: "C:\\workspace" });
    if (opened.status !== "available") throw new Error("expected an open native session");

    service.revoke();

    expect(onQualificationRevoked).toHaveBeenCalledExactlyOnceWith({
      rootBindingId: "root_binding_01"
    });
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledExactlyOnceWith(17n);

    await expect(
      opened.session.readTextFile({ relativeIdentity: "src/main.ts" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    expect(addon.readFile).not.toHaveBeenCalled();
  });
});

function revocableQualificationService(): EngineeringFileAccessQualificationService & {
  readonly revoke: () => void;
} {
  const listeners = new Set<() => void>();
  let revoked = false;

  return {
    readAttestation: async () => ({}) as never,
    hasCapability: async () => !revoked,
    subscribeRevocation(listener) {
      listeners.add(listener);
      if (revoked) listener();
      return () => listeners.delete(listener);
    },
    revoke() {
      if (revoked) return;
      revoked = true;
      for (const listener of listeners) listener();
    }
  };
}

function nativeAddon() {
  return {
    adapterInfo: vi.fn(),
    openWorkspaceRoot: vi.fn(() => ({
      rootId: 17n,
      capability: "available" as const,
      rootIdentity: rootIdentity()
    })),
    closeWorkspaceRoot: vi.fn(() => true),
    listDirectory: vi.fn(() => []),
    readFile: vi.fn(() => Buffer.from("", "utf8")),
    searchText: vi.fn(() => ({ matches: [], truncated: false })),
    buildIndex: vi.fn(() => ({ files: [], truncated: false }))
  };
}

function rootIdentity(): EngineeringWorkspaceNativeRootIdentity {
  return {
    volumeIdentity: "d0c0b0a0",
    directoryIdentity: "0000000000000011",
    canonicalPathIdentityChecksum: "a".repeat(64)
  };
}

function binding(): EngineeringWorkspaceRootBinding {
  return {
    schemaVersion: "1.0",
    rootBindingId: "root_binding_01",
    workspaceId: "workspace_01",
    workspaceKind: "engineeringWorkspace",
    ...rootIdentity(),
    pathPolicyRevision: "engineering-policy-01",
    issuedAt: "2026-08-07T00:00:00.000Z"
  };
}
