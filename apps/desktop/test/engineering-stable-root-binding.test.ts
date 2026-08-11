import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { issueStableEngineeringWorkspaceRootBindingV2 } from "../src/main/index.js";

const ISSUED_AT_A = "2026-08-11T00:00:00.000Z";
const ISSUED_AT_B = "2026-08-12T00:00:00.000Z";
const PATH_POLICY_REVISION = "f".repeat(64);

describe("stable production Engineering root binding", () => {
  test("keeps the binding id stable across process issue times", () => {
    const first = issueBinding({ issuedAt: ISSUED_AT_A });
    const restarted = issueBinding({ issuedAt: ISSUED_AT_B });

    expect(first).toBeDefined();
    expect(restarted).toBeDefined();
    expect(restarted?.rootBindingId).toBe(first?.rootBindingId);
    expect(restarted?.issuedAt).not.toBe(first?.issuedAt);
    expect(first).toMatchObject(nativeIdentity());
  });

  test("separates workspace, native root, canonical path identity, and policy revisions", () => {
    const bindings = [
      issueBinding(),
      issueBinding({ workspaceId: "workspace_02" }),
      issueBinding({ nativeIdentity: { ...nativeIdentity(), volumeIdentity: "volume_02" } }),
      issueBinding({ nativeIdentity: { ...nativeIdentity(), directoryIdentity: "directory_02" } }),
      issueBinding({
        nativeIdentity: {
          ...nativeIdentity(),
          canonicalPathIdentityChecksum: "b".repeat(64)
        }
      }),
      issueBinding({ pathPolicyRevision: "e".repeat(64) })
    ];

    expect(bindings.every((binding) => binding !== undefined)).toBe(true);
    expect(new Set(bindings.map((binding) => binding?.rootBindingId)).size).toBe(bindings.length);
  });

  test("does not place the raw canonical path in the durable binding", () => {
    const rawCanonicalPath = "C:\\Users\\private-author\\secret-novel";
    const binding = issueBinding({
      nativeIdentity: {
        ...nativeIdentity(),
        canonicalPathIdentityChecksum: createHash("sha256")
          .update(rawCanonicalPath, "utf8")
          .digest("hex")
      }
    });

    expect(binding).toBeDefined();
    expect(JSON.stringify(binding)).not.toContain(rawCanonicalPath);
    expect(binding?.rootBindingId).toMatch(/^engineering_root_v2_[0-9a-f]{64}$/u);
  });

  test("fails closed when authenticated native identity evidence is absent or malformed", () => {
    expect(issueBinding({ nativeIdentity: undefined })).toBeUndefined();
    expect(
      issueBinding({
        nativeIdentity: {
          ...nativeIdentity(),
          canonicalPathIdentityChecksum: "not-a-checksum"
        }
      })
    ).toBeUndefined();
    expect(
      issueBinding({ nativeIdentity: { ...nativeIdentity(), volumeIdentity: "" } })
    ).toBeUndefined();
    expect(issueBinding({ workspaceId: "" })).toBeUndefined();
    expect(issueBinding({ pathPolicyRevision: "" })).toBeUndefined();
  });
});

function issueBinding(
  overrides: Partial<Parameters<typeof issueStableEngineeringWorkspaceRootBindingV2>[0]> = {}
) {
  return issueStableEngineeringWorkspaceRootBindingV2({
    workspaceId: "workspace_01",
    nativeIdentity: nativeIdentity(),
    pathPolicyRevision: PATH_POLICY_REVISION,
    issuedAt: ISSUED_AT_A,
    ...overrides
  });
}

function nativeIdentity() {
  return {
    volumeIdentity: "volume_01",
    directoryIdentity: "directory_01",
    canonicalPathIdentityChecksum: "a".repeat(64)
  };
}
