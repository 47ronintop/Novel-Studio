import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createCanonicalRoundManifestV2,
  createProviderSemanticVersionSetV1,
  providerSemanticVersionSetChecksum,
  serializeCanonicalRoundManifestV2,
  type CanonicalRoundManifestV2
} from "@novel-studio/agent-engine";
import {
  AgentSendLedgerFileRepository,
  createAgentSendLedgerEntryV2,
  parseAgentSendLedgerEntryV2,
  serializeAgentSendLedgerEntryV2,
  type AgentSendLedgerAdditionV2,
  type AgentSendLedgerEntryV2
} from "../src/agent-send-ledger-repository.js";

const roots: string[] = [];
const payloadChecksum = "a".repeat(64);
const nativeChecksum = "b".repeat(64);
const proofChecksum = "c".repeat(64);

describe("AgentSendLedgerFileRepository", () => {
  test("persists an immutable first-send binding and incremental later-round manifest", async () => {
    const projectRoot = await createRoot();
    const repository = new AgentSendLedgerFileRepository({ projectRoot });
    const first = firstEntry();
    const later = subsequentEntry();

    await expect(repository.appendEntry("run_01", first)).resolves.toEqual({
      ok: true,
      value: first
    });
    await expect(repository.appendEntry("run_01", later)).resolves.toEqual({
      ok: true,
      value: later
    });
    await expect(repository.readEntries("run_01")).resolves.toEqual({
      ok: true,
      value: [first, later]
    });
    expect(
      await readFile(
        join(projectRoot, "history", "agent-runs", "run_01", "send-ledger", "round-000001.json"),
        "utf8"
      )
    ).toBe(serializeAgentSendLedgerEntryV2(later));
    expect(later.previewBinding).toBeNull();
    expect(later.additions).toEqual([
      expect.objectContaining({
        kind: "assistant",
        messageOrder: 1,
        content: "ROUND TWO ASSISTANT CONTENT"
      })
    ]);
  });

  test("is idempotent only for identical canonical bytes and rejects round gaps", async () => {
    const projectRoot = await createRoot();
    const repository = new AgentSendLedgerFileRepository({ projectRoot });
    const first = firstEntry();
    await repository.appendEntry("run_01", first);
    await expect(repository.appendEntry("run_01", first)).resolves.toEqual({
      ok: true,
      value: first
    });

    const divergent = createAgentSendLedgerEntryV2({
      ...entryInput(first),
      sentAt: "2026-08-04T00:00:00.500Z"
    });
    await expect(repository.appendEntry("run_01", divergent)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_LEDGER_CONFLICT" }
    });

    const roundTwo = subsequentEntry(2);
    await expect(repository.appendEntry("run_01", roundTwo)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_LEDGER_SEQUENCE_INVALID" }
    });
  });

  test("binds additions to exact manifest messages and enforces first/later semantics", () => {
    const laterManifest = manifest(1);
    const laterManifestJson = serializeCanonicalRoundManifestV2(laterManifest);
    expect(() =>
      createAgentSendLedgerEntryV2({
        ...entryInput(subsequentEntry()),
        additions: [
          addition({ content: "FORGED CONTENT", contentChecksum: sha256("FORGED CONTENT") })
        ]
      })
    ).toThrow("AGENT_SEND_LEDGER_INVALID");
    expect(() =>
      createAgentSendLedgerEntryV2({
        ...entryInput(firstEntry()),
        previewBinding: null
      })
    ).toThrow("AGENT_SEND_LEDGER_INVALID");
    expect(() =>
      createAgentSendLedgerEntryV2({
        ...entryInput(subsequentEntry()),
        canonicalRoundManifestJson: laterManifestJson,
        canonicalRoundManifestChecksum: laterManifest.manifestChecksum,
        additions: []
      })
    ).toThrow("AGENT_SEND_LEDGER_INVALID");
  });

  test("rejects provider-version drift and mismatched native serialization proof", async () => {
    const projectRoot = await createRoot();
    const repository = new AgentSendLedgerFileRepository({ projectRoot });
    await repository.appendEntry("run_01", firstEntry());

    const later = subsequentEntry();
    const nativeProof = later.providerNativeSemanticProof;
    if (nativeProof === null) throw new Error("native proof fixture missing");
    const mismatchedNative = {
      ...entryInput(later),
      providerNativeSemanticProof: {
        ...nativeProof,
        providerSemanticVersionSetChecksum: "d".repeat(64)
      }
    };
    expect(() => createAgentSendLedgerEntryV2(mismatchedNative)).toThrow(
      "AGENT_SEND_LEDGER_INVALID"
    );

    // The manifest identity is authoritative, so the entry cannot merely relabel the version set.
    expect(() =>
      createAgentSendLedgerEntryV2({
        ...entryInput(later),
        providerSemanticVersionSetChecksum: "d".repeat(64),
        providerNativeSemanticProof: null
      })
    ).toThrow("AGENT_SEND_LEDGER_INVALID");

    const drifted = subsequentEntry(1, "not_applicable");
    await expect(repository.appendEntry("run_01", drifted)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_LEDGER_SEQUENCE_INVALID" }
    });
  });

  test("fails closed on extra fields, noncanonical bytes, and corrupt history", async () => {
    const first = firstEntry();
    expect(() => parseAgentSendLedgerEntryV2({ ...first, transportSecret: "forbidden" })).toThrow(
      "AGENT_SEND_LEDGER_INVALID"
    );
    expect(() => parseAgentSendLedgerEntryV2({ ...first, schemaVersion: "1.0" })).toThrow(
      "AGENT_SEND_LEDGER_INVALID"
    );

    const projectRoot = await createRoot();
    const repository = new AgentSendLedgerFileRepository({ projectRoot });
    await expect(repository.readEntries("../run_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_LEDGER_INVALID" }
    });
    await repository.appendEntry("run_01", first);
    const path = join(
      projectRoot,
      "history",
      "agent-runs",
      "run_01",
      "send-ledger",
      "round-000000.json"
    );
    await writeFile(path, `${serializeAgentSendLedgerEntryV2(first)}\n`, "utf8");
    await expect(repository.readEntries("run_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_SEND_LEDGER_CORRUPT" }
    });
  });
});

function firstEntry(): AgentSendLedgerEntryV2 {
  const roundManifest = manifest(0);
  return createAgentSendLedgerEntryV2({
    entryId: "send_01",
    runId: "run_01",
    roundNumber: 0,
    roundKind: "first_send",
    providerSemanticVersionSetChecksum: roundManifest.providerSemanticVersionSetChecksum,
    canonicalRoundManifestJson: serializeCanonicalRoundManifestV2(roundManifest),
    canonicalRoundManifestChecksum: roundManifest.manifestChecksum,
    canonicalPayloadChecksum: payloadChecksum,
    previewBinding: {
      schemaVersion: "2.0",
      previewId: "preview_01",
      canonicalPayloadChecksum: payloadChecksum
    },
    additions: [],
    providerNativeSemanticProof: {
      schemaVersion: "2.0",
      adapterPolicyRevision: "openai_chat_01",
      providerSemanticVersionSetChecksum: roundManifest.providerSemanticVersionSetChecksum,
      providerNativeSemanticChecksum: nativeChecksum,
      serializationProofChecksum: proofChecksum
    },
    sentAt: "2026-08-04T00:00:00.000Z"
  });
}

function subsequentEntry(
  roundNumber = 1,
  writingTaskIntentSchemaVersion: "1.0" | "not_applicable" = "1.0"
): AgentSendLedgerEntryV2 {
  const roundManifest = manifest(roundNumber, writingTaskIntentSchemaVersion);
  return createAgentSendLedgerEntryV2({
    entryId: `send_${String(roundNumber + 1).padStart(2, "0")}`,
    runId: "run_01",
    roundNumber,
    roundKind: "subsequent_send",
    providerSemanticVersionSetChecksum: roundManifest.providerSemanticVersionSetChecksum,
    canonicalRoundManifestJson: serializeCanonicalRoundManifestV2(roundManifest),
    canonicalRoundManifestChecksum: roundManifest.manifestChecksum,
    canonicalPayloadChecksum: "e".repeat(64),
    previewBinding: null,
    additions: [addition()],
    providerNativeSemanticProof: {
      schemaVersion: "2.0",
      adapterPolicyRevision: "openai_chat_01",
      providerSemanticVersionSetChecksum: roundManifest.providerSemanticVersionSetChecksum,
      providerNativeSemanticChecksum: nativeChecksum,
      serializationProofChecksum: proofChecksum
    },
    sentAt: `2026-08-04T00:00:0${roundNumber}.000Z`
  });
}

function addition(
  overrides: Partial<Extract<AgentSendLedgerAdditionV2, { kind: "assistant" }>> = {}
): Extract<AgentSendLedgerAdditionV2, { kind: "assistant" }> {
  const content = overrides.content ?? "ROUND TWO ASSISTANT CONTENT";
  return {
    schemaVersion: "2.0",
    additionId: "addition_assistant_01",
    messageOrder: 1,
    kind: "assistant",
    role: "assistant",
    content,
    contentChecksum: overrides.contentChecksum ?? sha256(content)
  };
}

function manifest(
  roundNumber: number,
  writingTaskIntentSchemaVersion: "1.0" | "not_applicable" = "1.0"
): CanonicalRoundManifestV2 {
  return createCanonicalRoundManifestV2({
    roundId: `round_${roundNumber}`,
    runId: "run_01",
    roundNumber,
    authority: "SYSTEM AUTHORITY",
    toolCatalogRevision: "catalog_01",
    projectedToolDescriptors: [],
    sharing: { defaultsRevision: "defaults_01", runGrantRevision: "grant_01" },
    providerSemanticVersionSet: providerVersionSet(writingTaskIntentSchemaVersion),
    messages: [
      { kind: "current_user_request", role: "user", content: "CURRENT USER REQUEST" },
      ...(roundNumber === 0
        ? []
        : [
            {
              kind: "assistant" as const,
              role: "assistant" as const,
              content: "ROUND TWO ASSISTANT CONTENT"
            }
          ])
    ]
  });
}

function providerVersionSet(writingTaskIntentSchemaVersion: "1.0" | "not_applicable" = "1.0") {
  const value = createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion,
    writingGenerationGuidanceVersion: "not_applicable",
    approvalRuleSetVersion: "all-human@1.0",
    approvalRuleSetChecksum: "07bb0f73b5a5dc515373220f62960be604bae0f4bb141572b45d6cbf336e6664"
  });
  expect(providerSemanticVersionSetChecksum(value)).toMatch(/^[a-f0-9]{64}$/u);
  return value;
}

function entryInput(entry: AgentSendLedgerEntryV2) {
  const { schemaVersion, entryChecksum, ...input } = entry;
  void schemaVersion;
  void entryChecksum;
  return input;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-send-ledger-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
