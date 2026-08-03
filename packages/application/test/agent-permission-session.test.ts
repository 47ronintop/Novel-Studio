import { describe, expect, test } from "vitest";

import {
  computeDescriptorRevision,
  computeProviderMappingRevision,
  createDefaultCapabilitySnapshot,
  listAgentTools,
  normalizePermissionSummaryV10,
  resolvePermissionSummaryCapabilities,
  type AgentToolDescriptor,
  type AgentToolCapabilitySnapshot,
  type ListAgentToolsInput
} from "@novel-studio/agent-engine";
import {
  ok,
  err,
  createUnifiedError,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createAgentPermissionSession,
  type AgentPermissionSessionRepository,
  type AgentPermissionRootFingerprintPort,
  type PreparePermissionSummaryInput
} from "../src/agent-permission-session.js";

function baseInput(
  overrides: Partial<PreparePermissionSummaryInput> = {}
): PreparePermissionSummaryInput {
  return {
    projectId: "project_01",
    runDraftId: "run_draft_01",
    runDraftRevision: 1,
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    ...overrides
  };
}

function catalogV2WritingCapability(): AgentToolCapabilitySnapshot {
  return {
    ...createDefaultCapabilitySnapshot("creativeProject"),
    writingOperations: ["chapter_replace"],
    featureFlagRevision: "catalog-v2-writing"
  };
}

function catalogV2WritingDescriptors(
  capability: AgentToolCapabilitySnapshot
): readonly AgentToolDescriptor[] {
  return listAgentTools({
    facadeVersion: "v2",
    catalogSchemaVersion: "2.0",
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    capabilitySnapshot: capability
  });
}

function catalogV2WritingInput(
  overrides: Partial<PreparePermissionSummaryInput> = {}
): PreparePermissionSummaryInput {
  const capability = overrides.capabilitySnapshot ?? catalogV2WritingCapability();
  const descriptors = overrides.frozenToolDescriptors ?? catalogV2WritingDescriptors(capability);
  return baseInput({
    catalogSchemaVersion: "2.0",
    capabilitySnapshot: capability,
    frozenToolDescriptors: descriptors,
    providerMappingRevision: computeProviderMappingRevision(descriptors),
    ...overrides
  });
}

function fakeRootFingerprint(resolve: () => string): AgentPermissionRootFingerprintPort {
  return {
    resolveRootFingerprint: async () => ok(resolve())
  };
}

function memoryRepository(): AgentPermissionSessionRepository & {
  readonly written: JsonObject[];
} {
  const written: JsonObject[] = [];
  return {
    written,
    async writePermissionSummary(_runId, summary) {
      written.push(summary);
      return ok(summary);
    },
    async readPermissionSummary(runId, permissionSummaryId) {
      return ok(
        written.find(
          (summary) =>
            summary["runId"] === runId && summary["permissionSummaryId"] === permissionSummaryId
        )
      );
    }
  };
}

describe("createAgentPermissionSession.prepareForDraft", () => {
  test("generates a summary from the resolved root fingerprint and remembers it for the draft", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      now: () => "2026-07-16T00:00:00.000Z",
      createId: () => "permission_summary_fixed",
      writeMutationTrust: "standard_trusted_creative"
    });
    const result = await session.prepareForDraft(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rootFingerprint).toBe("f".repeat(64));
    expect(result.value.permissionSummaryId).toBe("permission_summary_fixed");
    expect(result.value.runId).toBeUndefined();
    expect(result.value).toMatchObject({
      schemaVersion: "1.1",
      writeMutationTrust: "standard_trusted_creative"
    });
  });

  test("propagates a root-fingerprint resolution failure", async () => {
    const failing: AgentPermissionRootFingerprintPort = {
      resolveRootFingerprint: async () =>
        err(
          createUnifiedError({
            code: "PROJECT_ROOT_UNRESOLVED",
            category: "AgentError",
            message: "unresolved",
            recoverability: "user-action",
            suggestedAction: "retry",
            traceId: "test"
          })
        )
    };
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: failing
    });
    const result = await session.prepareForDraft(baseInput());
    expect(result.ok).toBe(false);
  });
});

describe("createAgentPermissionSession Catalog and Permission Summary 2.0", () => {
  test("binds the supplied frozen provider directory and its mapping revision", async () => {
    const capability = catalogV2WritingCapability();
    const frozenDescriptors = catalogV2WritingDescriptors(capability);
    let listToolsCalls = 0;
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      createId: () => "permission_summary_v2",
      writeMutationTrust: "standard_trusted_creative",
      listTools: () => {
        listToolsCalls += 1;
        throw new Error("the frozen directory must be used instead");
      }
    });

    const prepared = await session.prepareForDraft(
      catalogV2WritingInput({
        capabilitySnapshot: capability,
        frozenToolDescriptors: frozenDescriptors
      })
    );

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        toolCatalogSchemaVersion: "2.0",
        providerMappingRevision: computeProviderMappingRevision(frozenDescriptors),
        descriptorRevision: computeDescriptorRevision(frozenDescriptors),
        writingOperations: ["chapter_replace"],
        workspaceFileOperations: [],
        writeCapability: "propose",
        writeApprovalPolicy: "confirm_each_change_set"
      }
    });
    if (!prepared.ok) return;
    expect(prepared.value.proposalCapabilities).toEqual(["edit_text"]);
    expect(listToolsCalls).toBe(0);
  });

  test("treats frozen provider mapping and descriptor changes as stale", async () => {
    const capability = catalogV2WritingCapability();
    const frozenDescriptors = catalogV2WritingDescriptors(capability);
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      writeMutationTrust: "standard_trusted_creative"
    });
    const input = catalogV2WritingInput({
      capabilitySnapshot: capability,
      frozenToolDescriptors: frozenDescriptors
    });
    const prepared = await session.prepareForDraft(input);
    expect(prepared.ok).toBe(true);

    const mappingChanged = await session.verifyForStart({
      ...input,
      providerMappingRevision: "0".repeat(64)
    });
    expect(mappingChanged.ok).toBe(false);
    if (!mappingChanged.ok) {
      expect(mappingChanged.error.redactedDetail?.["driftedFields"]).toContain(
        "providerMappingRevision"
      );
    }

    const descriptorsChanged = await session.verifyForStart({
      ...input,
      frozenToolDescriptors: frozenDescriptors.filter(
        (descriptor) => descriptor.id !== "read_resource"
      ),
      providerMappingRevision: computeProviderMappingRevision(
        frozenDescriptors.filter((descriptor) => descriptor.id !== "read_resource")
      )
    });
    expect(descriptorsChanged.ok).toBe(false);
    if (!descriptorsChanged.ok) {
      expect(descriptorsChanged.error.redactedDetail?.["driftedFields"]).toContain(
        "descriptorRevision"
      );
    }
  });

  test("keeps limited run preapproval closed without Main qualification", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });

    await expect(
      session.prepareForDraft(
        catalogV2WritingInput({
          writePolicy: "user_preapproved_run",
          writePolicyAcknowledged: true,
          limitedRunPreapprovalQualified: false
        })
      )
    ).rejects.toThrow("PERMISSION_SUMMARY_V2_PREAPPROVAL_UNQUALIFIED");
  });

  test("strictly rejects a persisted V2 summary with proposal-proof leakage", async () => {
    const repository = memoryRepository();
    const session = createAgentPermissionSession({
      repository,
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      createId: () => "permission_summary_v2_read",
      writeMutationTrust: "standard_trusted_creative"
    });
    const prepared = await session.prepareForDraft(catalogV2WritingInput());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const bound = await session.bindToRun({ runId: "run_01", summary: prepared.value });
    expect(bound.ok).toBe(true);
    repository.written[0] = {
      ...repository.written[0],
      proposalProofChecksum: "a".repeat(64)
    };

    await expect(
      session.readForRun({
        runId: "run_01",
        permissionSummaryId: "permission_summary_v2_read"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PERMISSION_SUMMARY_INVALID" }
    });
  });
});

describe("createAgentPermissionSession.verifyForStart", () => {
  test("a draft never previewed has nothing to drift from and succeeds with a freshly generated summary", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const result = await session.verifyForStart(baseInput());
    expect(result.ok).toBe(true);
  });

  test("succeeds when the regeneration matches the last prepared summary for the same draft", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    const verified = await session.verifyForStart(baseInput());
    expect(verified.ok).toBe(true);
    if (!verified.ok || !prepared.ok) return;
    expect(verified.value.checksum).toBe(prepared.value.checksum);
  });

  test("ignores a preview from an older persisted draft revision", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const prepared = await session.prepareForDraft({
      ...baseInput({ writePolicy: "user_preapproved_run" }),
      runDraftRevision: 2
    });
    expect(prepared.ok).toBe(true);

    const verified = await session.verifyForStart({
      ...baseInput({ operationMode: "planning", writePolicy: "write_before_confirmation" }),
      runDraftRevision: 3
    });

    expect(verified.ok).toBe(true);
  });

  test("blocks the run when the canonical root fingerprint changed since the summary was last previewed", async () => {
    let fingerprint = "f".repeat(64);
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => fingerprint)
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    fingerprint = "0".repeat(64);
    const verified = await session.verifyForStart(baseInput());
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.error.code).toBe("AGENT_PERMISSION_SUMMARY_STALE");
    expect(verified.error.redactedDetail?.["driftedFields"]).toContain("rootFingerprint");
  });

  test("blocks the run when the Tool Registry revision changed since the summary was last previewed", async () => {
    let listTools: (input: ListAgentToolsInput) => readonly AgentToolDescriptor[] = listAgentTools;
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      listTools: (input) => listTools(input)
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    listTools = (input) => [
      ...listAgentTools(input),
      {
        name: "read_project_text",
        kind: "file_tool",
        effect: "read",
        inputSchema: { type: "object" }
      } as AgentToolDescriptor
    ];
    const verified = await session.verifyForStart(baseInput());
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.error.redactedDetail?.["driftedFields"]).toContain("toolRegistryRevision");
  });

  test("blocks the run when the effective write policy changed since the summary was last previewed (e.g. draft mutated after preview)", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const prepared = await session.prepareForDraft(
      baseInput({ writePolicy: "write_before_confirmation" })
    );
    expect(prepared.ok).toBe(true);
    const verified = await session.verifyForStart(
      baseInput({ writePolicy: "user_preapproved_run" })
    );
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.error.redactedDetail?.["driftedFields"]).toContain("writePolicy");
  });

  test("model- or file-content cannot smuggle a capability change: verifyForStart ignores any extraneous fields on the input and only ever derives facts from projectId/runDraftId/operationMode/contextMode/writePolicy", async () => {
    const session = createAgentPermissionSession({
      repository: memoryRepository(),
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const tampered = {
      ...baseInput(),
      readCapabilities: ["shell"],
      forbiddenCapabilities: []
    } as PreparePermissionSummaryInput & {
      readCapabilities: readonly string[];
      forbiddenCapabilities: readonly string[];
    };
    const result = await session.verifyForStart(tampered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.forbiddenCapabilities]).toEqual([
      "shell",
      "git",
      "network",
      "delete",
      "move",
      "rename",
      "create_directory"
    ]);
  });
});

describe("createAgentPermissionSession.bindToRun", () => {
  test("persists the summary under the run and stamps the runId onto the bound copy", async () => {
    const repository = memoryRepository();
    const session = createAgentPermissionSession({
      repository,
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const bound = await session.bindToRun({ runId: "run_01", summary: prepared.value });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.runId).toBe("run_01");
    expect(repository.written).toHaveLength(1);
    expect(repository.written[0]?.["runId"]).toBe("run_01");
    expect(repository.written[0]?.["permissionSummaryId"]).toBe(prepared.value.permissionSummaryId);
  });

  test("propagates a persistence failure", async () => {
    const failing: AgentPermissionSessionRepository = {
      async writePermissionSummary(): Promise<Result<JsonObject, UnifiedError>> {
        return err(
          createUnifiedError({
            code: "AGENT_PERMISSION_SUMMARY_WRITE_FAILED",
            category: "AgentError",
            message: "write failed",
            recoverability: "user-action",
            suggestedAction: "retry",
            traceId: "test"
          })
        );
      }
    };
    const session = createAgentPermissionSession({
      repository: failing,
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64))
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const bound = await session.bindToRun({ runId: "run_01", summary: prepared.value });
    expect(bound.ok).toBe(false);
  });
});

describe("createAgentPermissionSession.readForRun", () => {
  test("reads and validates the server-persisted summary bound to a run", async () => {
    const repository = memoryRepository();
    const session = createAgentPermissionSession({
      repository,
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      createId: () => "permission_summary_read"
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await session.bindToRun({ runId: "run_01", summary: prepared.value });

    const read = await session.readForRun({
      runId: "run_01",
      permissionSummaryId: "permission_summary_read"
    });

    expect(read).toEqual({
      ok: true,
      value: expect.objectContaining({
        runId: "run_01",
        permissionSummaryId: "permission_summary_read",
        checksum: prepared.value.checksum
      })
    });
  });

  test("keeps a legacy persisted summary deny-new for post-v1 authorization", async () => {
    const repository = memoryRepository();
    const session = createAgentPermissionSession({
      repository,
      rootFingerprint: fakeRootFingerprint(() => "f".repeat(64)),
      createId: () => "permission_summary_legacy"
    });
    const prepared = await session.prepareForDraft(baseInput());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    if (prepared.value.schemaVersion === "2.0") {
      throw new Error("Expected the legacy Permission Summary writer for this migration test.");
    }
    const legacy = normalizePermissionSummaryV10(prepared.value);
    const bound = await session.bindToRun({ runId: "run_legacy", summary: legacy });
    expect(bound.ok).toBe(true);
    const read = await session.readForRun({
      runId: "run_legacy",
      permissionSummaryId: "permission_summary_legacy"
    });
    expect(read.ok).toBe(true);
    if (!read.ok || read.value === undefined) return;

    expect(resolvePermissionSummaryCapabilities(read.value)).toMatchObject({
      executeCapabilities: [],
      externalReadCapabilities: [],
      externalActionCapabilities: [],
      dataEgressCapabilities: [],
      featureFlagRevision: "legacy-v1.0-deny",
      descriptorRevision: "legacy-v1.0-deny",
      providerMappingRevision: "legacy-v1.0-deny"
    });
  });
});
