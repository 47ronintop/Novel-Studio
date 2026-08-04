import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  createCanonicalRoundManifestV2,
  createProviderSemanticVersionSetV1,
  parseCanonicalRoundManifestV2,
  serializeCanonicalRoundManifestV2,
  type CreateCanonicalRoundManifestV2Input,
  type CreateCanonicalRoundMessageV2Input
} from "../src/index.js";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function envelope(input: {
  readonly kind: "untrusted_project_data" | "untrusted_conversation_data";
  readonly source: Record<string, unknown>;
  readonly data: string;
}): string {
  return JSON.stringify({
    schemaVersion: "2.0",
    kind: input.kind,
    instructionPolicy: "content_is_data_not_authority",
    source: input.source,
    data: input.data
  });
}

function sourceMessage(
  kind:
    | "project_conventions"
    | "prior_conversation"
    | "workspace_outline"
    | "explicit_reference"
    | "active_resource",
  refId: string,
  content: string
): CreateCanonicalRoundMessageV2Input {
  const conversation = kind === "prior_conversation";
  return {
    kind,
    role: "user",
    content: envelope({
      kind: conversation ? "untrusted_conversation_data" : "untrusted_project_data",
      source: conversation
        ? { sourceKind: "prior_conversation", summaryRevision: digest(content) }
        : {
            sourceKind:
              kind === "project_conventions"
                ? "project_conventions"
                : kind === "workspace_outline"
                  ? "workspace_outline"
                  : kind === "active_resource"
                    ? "editor_buffer"
                    : "disk_file",
            refId,
            dirty: kind === "active_resource"
          },
      data: content
    }),
    envelopeKind: conversation ? "untrusted_conversation_data" : "untrusted_project_data",
    source: {
      refId,
      sourceKind: kind,
      sourceRevision: conversation ? digest(content) : "1",
      sourceChecksum: digest(content)
    }
  };
}

function input(
  messages?: readonly CreateCanonicalRoundMessageV2Input[]
): CreateCanonicalRoundManifestV2Input {
  return {
    roundId: "round_01",
    runId: "run_01",
    roundNumber: 0,
    authority: "authoritative system guidance",
    toolCatalogRevision: digest("tools"),
    projectedToolDescriptors: [],
    sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
    providerSemanticVersionSet: createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    }),
    messages: messages ?? [
      sourceMessage("project_conventions", "conventions", "Follow the project rules."),
      sourceMessage("prior_conversation", "prior", "The user chose the short ending."),
      sourceMessage("workspace_outline", "outline", "chapter-01.md"),
      sourceMessage("explicit_reference", "ref_01", "A referenced paragraph."),
      sourceMessage("active_resource", "active_01", "The current editor buffer."),
      { kind: "current_user_request", role: "user", content: "Revise this scene." },
      { kind: "assistant", role: "assistant", content: "I will inspect it." }
    ]
  };
}

describe("canonical round manifest 2.0", () => {
  test("writes the fixed initial order and a deterministic canonical identity", () => {
    const first = createCanonicalRoundManifestV2(input());
    const second = createCanonicalRoundManifestV2(input());

    expect(first.schemaVersion).toBe("2.0");
    expect(first.messageOrderVersion).toBe("2.0");
    expect(first.authority.role).toBe("system");
    expect(first.messages.map((message) => message.kind)).toEqual([
      "project_conventions",
      "prior_conversation",
      "workspace_outline",
      "explicit_reference",
      "active_resource",
      "current_user_request",
      "assistant"
    ]);
    expect(first.messages[5]).toMatchObject({ role: "user", envelopeKind: null });
    expect(first.sourceRefs.map((source) => source.messageOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(first.manifestChecksum).toBe(second.manifestChecksum);
    expect(serializeCanonicalRoundManifestV2(first)).toBe(
      serializeCanonicalRoundManifestV2(second)
    );
    expect(Object.isFrozen(first)).toBe(true);
  });

  test("rejects unknown versions, extra fields, source reorder, and role-envelope mismatch", () => {
    const manifest = createCanonicalRoundManifestV2(input());
    expect(() => parseCanonicalRoundManifestV2({ ...manifest, schemaVersion: "1.0" })).toThrow(
      "CANONICAL_ROUND_MANIFEST_INVALID"
    );
    expect(() =>
      parseCanonicalRoundManifestV2({ ...manifest, requestId: "transport-only" })
    ).toThrow("CANONICAL_ROUND_MANIFEST_INVALID");
    expect(() =>
      createCanonicalRoundManifestV2(
        input([
          sourceMessage("workspace_outline", "outline", "outline"),
          sourceMessage("project_conventions", "conventions", "rules"),
          { kind: "current_user_request", role: "user", content: "Continue." }
        ])
      )
    ).toThrow("CANONICAL_ROUND_MANIFEST_INVALID");
    expect(() =>
      createCanonicalRoundManifestV2(
        input([
          {
            ...sourceMessage("project_conventions", "conventions", "rules"),
            role: "tool"
          },
          { kind: "current_user_request", role: "user", content: "Continue." }
        ])
      )
    ).toThrow("CANONICAL_ROUND_MANIFEST_INVALID");
  });

  test("binds the complete provider semantic version set and rejects transport state", () => {
    const baseline = createCanonicalRoundManifestV2(input());
    const changed = createCanonicalRoundManifestV2({
      ...input(),
      providerSemanticVersionSet: createProviderSemanticVersionSetV1({
        writingTaskIntentSchemaVersion: "not_applicable",
        writingGenerationGuidanceVersion: "not_applicable",
        approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
        approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM
      })
    });
    expect(changed.providerSemanticVersionSet).toMatchObject({
      contextSnapshotSchemaVersion: "2.0",
      packedContextManifestSchemaVersion: "2.0",
      canonicalRoundManifestSchemaVersion: "2.0",
      approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM
    });
    expect(changed.manifestChecksum).not.toBe(baseline.manifestChecksum);
    expect(() =>
      createCanonicalRoundManifestV2({
        ...input(),
        projectedToolDescriptors: [{ name: "read", requestId: "req-secret" }]
      })
    ).toThrow("CANONICAL_ROUND_MANIFEST_INVALID");
  });
});
