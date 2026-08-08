import { describe, expect, test } from "vitest";

import {
  ENGINEERING_MUTATION_FILE_REF_PREFIX,
  createEngineeringMutationRefRegistryV2,
  type EngineeringMutationOpaqueRefV2,
  type EngineeringMutationRefIssueV2,
  type EngineeringMutationRefResolveInputV2
} from "../src/main/engineering-mutation-ref-registry-v2.js";

const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

describe("Engineering mutation ref registry V2", () => {
  test("issues unguessable file and directory refs while projecting only the opaque ref", () => {
    const registry = createEngineeringMutationRefRegistryV2();
    const file = registry.issue(issueInput());
    const directory = registry.issue(
      issueInput({ kind: "directory", relativeIdentity: "src/components" })
    );
    const rootDirectory = registry.issue(issueInput({ kind: "directory", relativeIdentity: "" }));

    expect(file).toEqual({
      opaqueRef: expect.stringMatching(/^engineering_file_ref:[a-f0-9]{64}$/u)
    });
    expect(directory).toEqual({
      opaqueRef: expect.stringMatching(/^engineering_directory_ref:[a-f0-9]{64}$/u)
    });
    expect(rootDirectory).toEqual({
      opaqueRef: expect.stringMatching(/^engineering_directory_ref:[a-f0-9]{64}$/u)
    });
    if (file === undefined || directory === undefined || rootDirectory === undefined) return;

    expect(file.opaqueRef).not.toBe(directory.opaqueRef);
    expect(Object.keys(file)).toEqual(["opaqueRef"]);
    expect(file).not.toHaveProperty("rootBindingId");
    expect(file).not.toHaveProperty("relativeIdentity");
    expect(file).not.toHaveProperty("sourceNativeRefChecksum");
    expect(JSON.stringify(file)).not.toContain("root-binding-a");
    expect(JSON.stringify(file)).not.toContain("src/index.ts");
    expect(JSON.stringify(file)).not.toContain("ledger");
    expect(JSON.stringify(file)).not.toContain("wal");

    expect(registry.resolve(resolveInput(file.opaqueRef))).toEqual({
      opaqueRef: file.opaqueRef,
      ...issueInput()
    });
  });

  test("requires an exact opaque ref and every expected binding value to match", () => {
    const registry = createEngineeringMutationRefRegistryV2();
    const issued = registry.issue(issueInput());
    expect(issued).toBeDefined();
    if (issued === undefined) return;

    const exact = resolveInput(issued.opaqueRef);
    expect(registry.resolve(exact)).toBeDefined();
    expect(
      registry.resolve({
        ...exact,
        opaqueRef: `${ENGINEERING_MUTATION_FILE_REF_PREFIX}${"c".repeat(64)}`
      })
    ).toBeUndefined();
    expect(registry.resolve({ ...exact, expectedKind: "directory" })).toBeUndefined();
    expect(registry.resolve({ ...exact, expectedRootBindingId: "root-binding-b" })).toBeUndefined();
    expect(
      registry.resolve({ ...exact, expectedPathPolicyRevision: "path-policy-revision-b" })
    ).toBeUndefined();
    expect(
      registry.resolve({ ...exact, expectedSourceNativeRefChecksum: CHECKSUM_B })
    ).toBeUndefined();
    expect(
      registry.resolve({ ...exact, expectedCapabilityRevision: "capability-revision-b" })
    ).toBeUndefined();
    expect(registry.resolve({ ...exact, unexpected: true })).toBeUndefined();
  });

  test("allows only Main to recover the stored source checksum before a fresh native re-read", () => {
    const registry = createEngineeringMutationRefRegistryV2();
    const issued = registry.issue(issueInput());
    expect(issued).toBeDefined();
    if (issued === undefined) return;

    expect(
      registry.resolveCurrentBoundary({
        opaqueRef: issued.opaqueRef,
        expectedKind: "file",
        expectedRootBindingId: "root-binding-a",
        expectedPathPolicyRevision: "path-policy-revision-a",
        expectedCapabilityRevision: "capability-revision-a"
      })
    ).toMatchObject({ sourceNativeRefChecksum: CHECKSUM_A, relativeIdentity: "src/index.ts" });
    expect(
      registry.resolveCurrentBoundary({
        opaqueRef: issued.opaqueRef,
        expectedKind: "file",
        expectedRootBindingId: "root-binding-a",
        expectedPathPolicyRevision: "path-policy-revision-a",
        expectedCapabilityRevision: "capability-revision-b"
      })
    ).toBeUndefined();
    expect(
      registry.resolveCurrentBoundary({
        opaqueRef: issued.opaqueRef,
        expectedKind: "file",
        expectedRootBindingId: "root-binding-a",
        expectedPathPolicyRevision: "path-policy-revision-a",
        expectedCapabilityRevision: "capability-revision-a",
        expectedSourceNativeRefChecksum: CHECKSUM_A
      })
    ).toBeUndefined();
  });

  test("treats root and revision changes as stale", () => {
    const registry = createEngineeringMutationRefRegistryV2();
    const issued = registry.issue(issueInput());
    expect(issued).toBeDefined();
    if (issued === undefined) return;

    expect(
      registry.resolve(
        resolveInput(issued.opaqueRef, { expectedRootBindingId: "root-binding-next" })
      )
    ).toBeUndefined();
    expect(
      registry.resolve(
        resolveInput(issued.opaqueRef, { expectedPathPolicyRevision: "path-policy-revision-next" })
      )
    ).toBeUndefined();
    expect(
      registry.resolve(
        resolveInput(issued.opaqueRef, { expectedCapabilityRevision: "capability-revision-next" })
      )
    ).toBeUndefined();
  });

  test("revokes every ref for one root and clear removes all remaining refs", () => {
    const registry = createEngineeringMutationRefRegistryV2();
    const first = registry.issue(issueInput({ relativeIdentity: "src/first.ts" }));
    const second = registry.issue(issueInput({ relativeIdentity: "src/second.ts" }));
    const otherRoot = registry.issue(
      issueInput({ rootBindingId: "root-binding-b", relativeIdentity: "src/other.ts" })
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(otherRoot).toBeDefined();
    if (first === undefined || second === undefined || otherRoot === undefined) return;

    registry.revokeRootBinding("root-binding-a");

    expect(registry.resolve(resolveInput(first.opaqueRef))).toBeUndefined();
    expect(registry.resolve(resolveInput(second.opaqueRef))).toBeUndefined();
    expect(
      registry.resolve(
        resolveInput(otherRoot.opaqueRef, { expectedRootBindingId: "root-binding-b" })
      )
    ).toBeDefined();

    registry.clear();

    expect(
      registry.resolve(
        resolveInput(otherRoot.opaqueRef, { expectedRootBindingId: "root-binding-b" })
      )
    ).toBeUndefined();
  });

  test("rejects malformed or non-canonical issuance inputs", () => {
    const registry = createEngineeringMutationRefRegistryV2();

    expect(registry.issue(issueInput({ relativeIdentity: "src/../index.ts" }))).toBeUndefined();
    expect(
      registry.issue(issueInput({ sourceNativeRefChecksum: "not-a-checksum" }))
    ).toBeUndefined();
    expect(registry.issue({ ...issueInput(), extra: "not accepted" })).toBeUndefined();
  });
});

function issueInput(
  overrides: Partial<EngineeringMutationRefIssueV2> = {}
): EngineeringMutationRefIssueV2 {
  return {
    kind: "file",
    rootBindingId: "root-binding-a",
    pathPolicyRevision: "path-policy-revision-a",
    relativeIdentity: "src/index.ts",
    sourceNativeRefChecksum: CHECKSUM_A,
    issuedCapabilityRevision: "capability-revision-a",
    ...overrides
  };
}

function resolveInput(
  opaqueRef: EngineeringMutationOpaqueRefV2,
  overrides: Partial<EngineeringMutationRefResolveInputV2> = {}
): EngineeringMutationRefResolveInputV2 {
  return {
    opaqueRef,
    expectedKind: "file",
    expectedRootBindingId: "root-binding-a",
    expectedPathPolicyRevision: "path-policy-revision-a",
    expectedSourceNativeRefChecksum: CHECKSUM_A,
    expectedCapabilityRevision: "capability-revision-a",
    ...overrides
  };
}
