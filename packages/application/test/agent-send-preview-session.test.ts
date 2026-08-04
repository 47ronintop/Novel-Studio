import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  createCanonicalRoundManifestV2,
  createProviderSemanticVersionSetV1,
  serializeCanonicalRoundManifestV2,
  type CanonicalRoundManifestV2
} from "@novel-studio/agent-engine";
import { ok } from "@novel-studio/shared";
import {
  AGENT_SEND_PREVIEW_SCHEMA_VERSION,
  canonicalAgentFirstRoundSemanticPayloadChecksumV2,
  createAgentSendPreviewSession,
  parseAgentFirstRoundSemanticPayloadV2,
  type AgentFirstRoundSemanticPayloadV2,
  type AgentSendPreviewDisplayInputV2,
  type AgentSendPreviewPreparedMaterialV2,
  type AgentSendPreviewValidationFactsV2,
  type PrepareAgentSendPreviewCommandV2
} from "../src/agent-send-preview-session.js";
import {
  createProviderVisibleUntrustedEnvelope,
  serializeProviderVisibleUntrustedEnvelope
} from "../src/agent-untrusted-envelope.js";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const conventionsChecksum = createHash("sha256")
  .update("PROJECT CONVENTIONS", "utf8")
  .digest("hex");

describe("AgentSendPreviewSession", () => {
  test("sends only the immutable server-owned payload bound by the opaque preview", async () => {
    const fixture = material();
    let currentFacts = fixture.validationFacts;
    const sent = vi.fn(async (input) => ok({ runId: "run_01", input }));
    const session = createAgentSendPreviewSession({
      materializer: {
        async materializeFirstRound() {
          return ok(fixture);
        },
        async resolveCurrentValidationFacts() {
          return ok(currentFacts);
        }
      },
      sendFrozenFirstRound: sent,
      now: () => "2026-08-04T01:00:00.000Z",
      createPreviewId: () => "preview_01"
    });

    const prepared = await session.preparePreview(command());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value).toMatchObject({
      schemaVersion: "2.0",
      previewId: "preview_01",
      canonicalPayloadChecksum: fixture.validationFacts.canonicalPayloadChecksum,
      target: {
        providerLabel: "OpenAI",
        modelLabel: "GPT Test",
        connectionLabel: "Writing account"
      },
      guidance: {
        version: "3.0",
        profileId: "writing",
        content: "SYSTEM AUTHORITY"
      },
      tools: [{ name: "list_chapters", description: "List chapters" }]
    });
    expect(prepared.value).not.toHaveProperty("semanticPayload");
    expect(JSON.stringify(prepared.value)).not.toContain("account_opaque_identity");

    fixture.semanticPayload.messages[0] = userMessage("MUTATED CALLER PAYLOAD");
    currentFacts = structuredClone(currentFacts);
    const result = await session.confirmAndSend({
      schemaVersion: "2.0",
      previewId: prepared.value.previewId,
      canonicalPayloadChecksum: prepared.value.canonicalPayloadChecksum
    });
    expect(result).toMatchObject({ ok: true, value: { value: { runId: "run_01" } } });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0].semanticPayload.messages[0]?.content).toContain(
      "PROJECT CONVENTIONS"
    );
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      previewId: "preview_01",
      canonicalRoundManifestJson: fixture.canonicalRoundManifestJson,
      providerSemanticVersionSetChecksum:
        fixture.validationFacts.providerSemanticVersionSetChecksum,
      validationFacts: {
        target: {
          connectionId: "connection_01",
          accountIdentityChecksum: c,
          adapterPolicyRevision: "openai_chat_01"
        }
      }
    });

    await expect(
      session.confirmAndSend({
        schemaVersion: "2.0",
        previewId: prepared.value.previewId,
        canonicalPayloadChecksum: prepared.value.canonicalPayloadChecksum
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_PREVIEW_STALE" }
    });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["request", (facts: MutableFacts) => (facts.requestRevision = "request_02")],
    ["provider", (facts: MutableFacts) => (facts.target.providerId = "anthropic")],
    ["model", (facts: MutableFacts) => (facts.target.modelId = "claude_test")],
    ["account", (facts: MutableFacts) => (facts.target.accountIdentityChecksum = b)],
    ["adapter policy", (facts: MutableFacts) => (facts.target.adapterPolicyChecksum = b)],
    [
      "source",
      (facts: MutableFacts) => {
        const source = facts.sourceBindings[0];
        if (source === undefined) throw new Error("source fixture missing");
        source.sourceChecksum = b;
      }
    ],
    ["sharing", (facts: MutableFacts) => (facts.sharingGrantRevision = "grant_02")],
    ["task intent", (facts: MutableFacts) => (facts.taskIntentChecksum = b)],
    ["capability", (facts: MutableFacts) => (facts.capabilityRevision = "capability_02")],
    ["tools", (facts: MutableFacts) => (facts.toolProjectionChecksum = b)],
    ["version set", (facts: MutableFacts) => (facts.providerSemanticVersionSetChecksum = b)],
    ["canonical manifest", (facts: MutableFacts) => (facts.canonicalRoundManifestChecksum = b)]
  ])("fails closed when the %s binding changes after preview", async (_name, mutate) => {
    const fixture = material();
    const current = structuredClone(fixture.validationFacts) as MutableFacts;
    mutate(current);
    const send = vi.fn(async () => ok({}));
    const session = createAgentSendPreviewSession({
      materializer: {
        async materializeFirstRound() {
          return ok(fixture);
        },
        async resolveCurrentValidationFacts() {
          return ok(current as AgentSendPreviewValidationFactsV2);
        }
      },
      sendFrozenFirstRound: send,
      now: () => "2026-08-04T01:00:00.000Z",
      createPreviewId: () => "preview_stale"
    });
    const prepared = await session.preparePreview(command());
    if (!prepared.ok) throw new Error(prepared.error.message);

    await expect(
      session.confirmAndSend({
        schemaVersion: "2.0",
        previewId: prepared.value.previewId,
        canonicalPayloadChecksum: prepared.value.canonicalPayloadChecksum
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_PREVIEW_STALE" }
    });
    expect(send).not.toHaveBeenCalled();
  });

  test("expires previews and rejects a forged checksum before revalidation", async () => {
    const fixture = material();
    let now = "2026-08-04T01:00:00.000Z";
    const revalidate = vi.fn(async () => ok(fixture.validationFacts));
    const send = vi.fn(async () => ok({}));
    const session = createAgentSendPreviewSession({
      materializer: {
        async materializeFirstRound() {
          return ok(fixture);
        },
        resolveCurrentValidationFacts: revalidate
      },
      sendFrozenFirstRound: send,
      now: () => now,
      createPreviewId: () => "preview_expiry",
      previewTtlMs: 1_000
    });
    const prepared = await session.preparePreview(command());
    if (!prepared.ok) throw new Error(prepared.error.message);

    await expect(
      session.confirmAndSend({
        schemaVersion: "2.0",
        previewId: prepared.value.previewId,
        canonicalPayloadChecksum: b
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_SEND_PREVIEW_STALE" } });
    expect(revalidate).not.toHaveBeenCalled();

    now = "2026-08-04T01:00:01.000Z";
    await expect(
      session.confirmAndSend({
        schemaVersion: "2.0",
        previewId: prepared.value.previewId,
        canonicalPayloadChecksum: prepared.value.canonicalPayloadChecksum
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_SEND_PREVIEW_STALE" } });
    expect(send).not.toHaveBeenCalled();
  });

  test("is concurrent-idempotent for one prepare command", async () => {
    const fixture = material();
    const materialize = vi.fn(async () => ok(fixture));
    const session = createAgentSendPreviewSession({
      materializer: {
        materializeFirstRound: materialize,
        async resolveCurrentValidationFacts() {
          return ok(fixture.validationFacts);
        }
      },
      async sendFrozenFirstRound() {
        return ok({});
      },
      now: () => "2026-08-04T01:00:00.000Z",
      createPreviewId: () => "preview_idempotent"
    });

    const [first, second] = await Promise.all([
      session.preparePreview(command()),
      session.preparePreview(command())
    ]);
    expect(first).toEqual(second);
    expect(materialize).toHaveBeenCalledTimes(1);

    await expect(
      session.preparePreview({ ...command(), runDraftChecksum: b })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_SEND_PREVIEW_INVALID" } });
  });

  test("reserves confirmation before asynchronous revalidation to prevent double send", async () => {
    const fixture = material();
    let releaseValidation: () => void = () => undefined;
    let announceValidation: () => void = () => undefined;
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const validationStarted = new Promise<void>((resolve) => {
      announceValidation = resolve;
    });
    const send = vi.fn(async () => ok({}));
    const session = createAgentSendPreviewSession({
      materializer: {
        async materializeFirstRound() {
          return ok(fixture);
        },
        async resolveCurrentValidationFacts() {
          announceValidation();
          await validationGate;
          return ok(fixture.validationFacts);
        }
      },
      sendFrozenFirstRound: send,
      now: () => "2026-08-04T01:00:00.000Z",
      createPreviewId: () => "preview_concurrent"
    });
    const prepared = await session.preparePreview(command());
    if (!prepared.ok) throw new Error(prepared.error.message);
    const confirmation = {
      schemaVersion: "2.0" as const,
      previewId: prepared.value.previewId,
      canonicalPayloadChecksum: prepared.value.canonicalPayloadChecksum
    };

    const first = session.confirmAndSend(confirmation);
    await validationStarted;
    await expect(session.confirmAndSend(confirmation)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_PREVIEW_STALE" }
    });
    releaseValidation();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("strict v2 parsers reject extra fields and orphan tool results", () => {
    expect(() =>
      parseAgentFirstRoundSemanticPayloadV2({ ...payload(), transportSecret: "do-not-send" })
    ).toThrow("AGENT_SEND_PREVIEW_INVALID");
    expect(() =>
      parseAgentFirstRoundSemanticPayloadV2({
        ...payload(),
        messages: [
          {
            schemaVersion: "2.0",
            role: "tool",
            content: "orphan",
            toolCallId: "call_01"
          }
        ]
      })
    ).toThrow("AGENT_SEND_PREVIEW_INVALID");
    expect(() =>
      parseAgentFirstRoundSemanticPayloadV2({ ...payload(), schemaVersion: "1.0" })
    ).toThrow("AGENT_SEND_PREVIEW_INVALID");
  });

  test("rejects a display DTO whose source body does not match the frozen manifest", async () => {
    const fixture = material();
    const source = fixture.display.sources[0];
    if (source === undefined) throw new Error("display source fixture missing");
    const session = createAgentSendPreviewSession({
      materializer: {
        async materializeFirstRound() {
          return ok({
            ...fixture,
            display: {
              ...fixture.display,
              sources: [{ ...source, content: "FORGED DISPLAY BODY" }]
            }
          });
        },
        async resolveCurrentValidationFacts() {
          return ok(fixture.validationFacts);
        }
      },
      async sendFrozenFirstRound() {
        return ok({});
      }
    });

    await expect(session.preparePreview(command())).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_PREVIEW_INVALID" }
    });
  });
});

type MutableFacts = {
  -readonly [
    K in keyof AgentSendPreviewValidationFactsV2
  ]: AgentSendPreviewValidationFactsV2[K] extends readonly (infer T)[]
    ? Array<{ -readonly [P in keyof T]: T[P] }>
    : AgentSendPreviewValidationFactsV2[K] extends object
      ? {
          -readonly [
            P in keyof AgentSendPreviewValidationFactsV2[K]
          ]: AgentSendPreviewValidationFactsV2[K][P];
        }
      : AgentSendPreviewValidationFactsV2[K];
};

function command(): PrepareAgentSendPreviewCommandV2 {
  return {
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    commandId: "command_01",
    runDraftId: "draft_01",
    expectedRunDraftRevision: 1,
    runDraftChecksum: a
  };
}

function material(): AgentSendPreviewPreparedMaterialV2 & {
  semanticPayload: MutablePayload;
} {
  const semanticPayload = payload() as MutablePayload;
  const roundManifest = manifest(semanticPayload);
  const canonicalRoundManifestJson = serializeCanonicalRoundManifestV2(roundManifest);
  return {
    semanticPayload,
    canonicalRoundManifestJson,
    validationFacts: facts(semanticPayload, roundManifest),
    display: display()
  };
}

type MutablePayload = Omit<AgentFirstRoundSemanticPayloadV2, "messages"> & {
  messages: AgentFirstRoundSemanticPayloadV2["messages"][number][];
};

function payload(): AgentFirstRoundSemanticPayloadV2 {
  const conventions = serializeProviderVisibleUntrustedEnvelope(
    createProviderVisibleUntrustedEnvelope({
      kind: "untrusted_project_data",
      source: {
        sourceKind: "project_conventions",
        refId: "project:conventions",
        dirty: false
      },
      data: "PROJECT CONVENTIONS"
    })
  );
  return {
    schemaVersion: "2.0",
    systemPrompt: "SYSTEM AUTHORITY",
    messages: [userMessage(conventions), userMessage("CURRENT USER REQUEST")],
    tools: [
      {
        schemaVersion: "2.0",
        name: "list_chapters",
        description: "List chapters",
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      }
    ],
    parameters: { temperature: 0 }
  };
}

function userMessage(content: string) {
  return { schemaVersion: "2.0" as const, role: "user" as const, content };
}

function facts(
  semanticPayload: AgentFirstRoundSemanticPayloadV2,
  roundManifest: CanonicalRoundManifestV2
): AgentSendPreviewValidationFactsV2 {
  const currentRequest = roundManifest.messages.find(
    (message) => message.kind === "current_user_request"
  );
  if (currentRequest === undefined) throw new Error("current request fixture missing");
  return {
    schemaVersion: "2.0",
    scopeBindingChecksum: a,
    runDraftId: "draft_01",
    runDraftRevision: 1,
    runDraftChecksum: a,
    requestRevision: "request_01",
    requestChecksum: currentRequest.contentChecksum,
    target: {
      providerId: "openai",
      modelId: "gpt_test",
      connectionId: "connection_01",
      accountIdentityChecksum: c,
      adapterPolicyRevision: "openai_chat_01",
      adapterPolicyChecksum: c
    },
    sourceBindings: [
      {
        sourceRef: "project:conventions",
        sourceRevision: "4",
        sourceChecksum: conventionsChecksum
      }
    ],
    sharingDefaultsRevision: "defaults_01",
    sharingGrantRevision: "grant_01",
    sharingGrantChecksum: c,
    taskIntentChecksum: c,
    capabilityRevision: "capability_01",
    capabilityChecksum: c,
    toolProjectionRevision: roundManifest.tools.catalogRevision,
    toolProjectionChecksum: roundManifest.tools.projectionChecksum,
    providerSemanticVersionSetChecksum: roundManifest.providerSemanticVersionSetChecksum,
    canonicalRoundManifestChecksum: roundManifest.manifestChecksum,
    canonicalPayloadChecksum: canonicalAgentFirstRoundSemanticPayloadChecksumV2(semanticPayload)
  };
}

function manifest(semanticPayload: AgentFirstRoundSemanticPayloadV2): CanonicalRoundManifestV2 {
  const value = createCanonicalRoundManifestV2({
    roundId: "round_00",
    runId: "run_01",
    roundNumber: 0,
    authority: semanticPayload.systemPrompt,
    toolCatalogRevision: "catalog_01",
    projectedToolDescriptors: semanticPayload.tools.map((tool) => ({
      providerName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })),
    sharing: { defaultsRevision: "defaults_01", runGrantRevision: "grant_01" },
    providerSemanticVersionSet: createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "1.0",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "all-human@1.0",
      approvalRuleSetChecksum: "07bb0f73b5a5dc515373220f62960be604bae0f4bb141572b45d6cbf336e6664"
    }),
    messages: [
      {
        kind: "project_conventions",
        role: "user",
        content: semanticPayload.messages[0]?.content ?? "",
        source: {
          refId: "project:conventions",
          sourceKind: "project_conventions",
          sourceRevision: "4",
          sourceChecksum: conventionsChecksum
        },
        envelopeKind: "untrusted_project_data"
      },
      {
        kind: "current_user_request",
        role: "user",
        content: "CURRENT USER REQUEST"
      }
    ]
  });
  return value;
}

function display(): AgentSendPreviewDisplayInputV2 {
  return {
    schemaVersion: "2.0",
    target: {
      providerLabel: "OpenAI",
      modelLabel: "GPT Test",
      connectionLabel: "Writing account",
      adapterPolicyLabel: "OpenAI Chat Completions"
    },
    guidance: {
      version: "3.0",
      profileId: "writing",
      runtimeFacts: { operationMode: "planning" }
    },
    sources: [
      {
        sourceRef: "project:conventions",
        label: "Project conventions",
        kind: "project_conventions",
        content: "PROJECT CONVENTIONS",
        tokenCount: 12,
        tokenPrecision: "reported",
        dirty: false,
        truncated: false,
        selectionState: "automatic",
        grantSource: "workspace_default"
      }
    ],
    retainedLocalProvenanceKinds: [
      "workspace_identity",
      "canonical_root_identity",
      "provider_account_identity"
    ],
    providerNativeSemanticChecksum: null
  };
}
