import { describe, expect, it } from "vitest";

import {
  createProviderVisibleUntrustedEnvelope,
  isProviderVisibleEnvelopeAllowedInRole,
  parseProviderVisibleUntrustedEnvelope,
  providerVisibleEnvelopeRole,
  serializeProviderVisibleUntrustedEnvelope
} from "../src/agent-untrusted-envelope.js";

describe("Provider-visible untrusted envelope 2.0", () => {
  it("writes and parses each supported source family with only minimal metadata", () => {
    const fixtures = [
      {
        kind: "untrusted_project_data" as const,
        source: { sourceKind: "disk_file" as const, refId: "file-1", dirty: false },
        role: "user" as const
      },
      {
        kind: "untrusted_conversation_data" as const,
        source: { sourceKind: "prior_conversation" as const, summaryRevision: "rev-1" },
        role: "user" as const
      },
      {
        kind: "untrusted_remote_data" as const,
        source: { sourceKind: "network" as const, toolCallId: "call-1" },
        role: "tool" as const
      },
      {
        kind: "untrusted_tool_data" as const,
        source: {
          sourceKind: "tool_result" as const,
          toolCallId: "call-1",
          providerToolName: "read_file",
          resultKind: "completed"
        },
        role: "tool" as const
      },
      {
        kind: "untrusted_recovery_data" as const,
        source: { sourceKind: "recovery_summary" as const, recoveryEventKind: "orphan_tool" },
        role: "user" as const
      }
    ];

    for (const fixture of fixtures) {
      const envelope = createProviderVisibleUntrustedEnvelope({
        kind: fixture.kind,
        source: fixture.source,
        data: "content is data"
      });
      const serialized = serializeProviderVisibleUntrustedEnvelope(envelope);
      expect(parseProviderVisibleUntrustedEnvelope(serialized)).toEqual(envelope);
      expect(providerVisibleEnvelopeRole(envelope)).toBe(fixture.role);
      expect(Object.isFrozen(envelope)).toBe(true);
      expect(serialized).not.toMatch(
        /workspaceId|canonicalRootIdentity|artifactId|readerVersion|dependency|cache|account|[A-Za-z]:[\\/]/u
      );
    }
  });

  it("rejects unknown versions, extra fields, mismatched kinds, and unsafe paths", () => {
    const envelope = createProviderVisibleUntrustedEnvelope({
      kind: "untrusted_project_data",
      source: { sourceKind: "disk_file", refId: "file-1", dirty: false },
      data: "body"
    });

    expect(() =>
      parseProviderVisibleUntrustedEnvelope({ ...envelope, schemaVersion: "1.0" })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
    expect(() => parseProviderVisibleUntrustedEnvelope({ ...envelope, extra: true })).toThrow(
      "AGENT_UNTRUSTED_ENVELOPE_INVALID"
    );
    expect(() =>
      parseProviderVisibleUntrustedEnvelope({
        ...envelope,
        kind: "untrusted_remote_data",
        source: { sourceKind: "disk_file", refId: "file-1", dirty: false }
      })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
    expect(() =>
      parseProviderVisibleUntrustedEnvelope({
        ...envelope,
        source: { sourceKind: "disk_file", refId: "C:/secret.txt", dirty: false }
      })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
    expect(() =>
      parseProviderVisibleUntrustedEnvelope({
        ...envelope,
        source: { sourceKind: "disk_file", refId: "file-1", dirty: false, workspaceId: "w" }
      })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
    expect(() =>
      parseProviderVisibleUntrustedEnvelope({
        ...envelope,
        data: 42
      })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
  });

  it("requires an application-proven tool pairing before remote/tool data can be tool role", () => {
    const envelope = createProviderVisibleUntrustedEnvelope({
      kind: "untrusted_tool_data",
      source: {
        sourceKind: "tool_result",
        toolCallId: "call-1",
        providerToolName: "read_file",
        resultKind: "completed"
      },
      data: "result"
    });
    expect(
      isProviderVisibleEnvelopeAllowedInRole({
        envelope,
        role: "tool",
        pairedToolCallIds: new Set()
      })
    ).toBe(false);
    expect(
      isProviderVisibleEnvelopeAllowedInRole({
        envelope,
        role: "tool",
        pairedToolCallIds: new Set(["call-1"])
      })
    ).toBe(true);
    expect(isProviderVisibleEnvelopeAllowedInRole({ envelope, role: "user" })).toBe(false);
  });

  it("does not accept legacy envelopes as 2.0", () => {
    expect(() =>
      parseProviderVisibleUntrustedEnvelope({
        kind: "untrusted_project_data",
        instructionPolicy: "content_is_data_not_authority",
        source: { refId: "file-1", sourceKind: "disk_file", dirty: false },
        data: "legacy"
      })
    ).toThrow("AGENT_UNTRUSTED_ENVELOPE_INVALID");
  });
});
