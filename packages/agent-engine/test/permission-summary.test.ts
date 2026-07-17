import { describe, expect, test } from "vitest";

import {
  findPermissionSummaryDrift,
  generatePermissionSummary,
  listAgentTools,
  type AgentContextMode,
  type AgentOperationMode,
  type AgentToolDescriptor,
  type AgentWritePolicy,
  type GeneratePermissionSummaryInput,
  type ListAgentToolsInput,
  type PermissionSummary
} from "../src/index.js";

function baseInput(
  overrides: Partial<GeneratePermissionSummaryInput> = {}
): GeneratePermissionSummaryInput {
  return {
    permissionSummaryId: "permission_summary_01",
    projectId: "project_01",
    runDraftId: "run_draft_01",
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    rootFingerprint: "f".repeat(64),
    generatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

const operationModes: readonly AgentOperationMode[] = ["planning", "execution"];
const contextModes: readonly AgentContextMode[] = ["writing", "general_file"];
const writePolicies: readonly AgentWritePolicy[] = [
  "write_before_confirmation",
  "user_preapproved_run"
];

describe("generatePermissionSummary capability derivation", () => {
  for (const operationMode of operationModes) {
    for (const contextMode of contextModes) {
      for (const writePolicy of writePolicies) {
        test(`derives read/proposal capabilities for ${operationMode}/${contextMode}/${writePolicy} from the real Tool Registry`, () => {
          const summary = generatePermissionSummary(
            baseInput({ operationMode, contextMode, writePolicy })
          );
          const effectiveWritePolicy: AgentWritePolicy =
            operationMode === "planning" ? "write_before_confirmation" : writePolicy;
          const expectedTools = listAgentTools({
            operationMode,
            contextMode,
            writePolicy: effectiveWritePolicy
          });
          expect([...summary.readCapabilities]).toEqual(
            sortedNames(expectedTools, "read")
          );
          expect([...summary.proposalCapabilities]).toEqual(
            sortedNames(expectedTools, "propose")
          );
          expect(summary.writePolicy).toBe(effectiveWritePolicy);
        });
      }
    }
  }

  test("forbidden capabilities are always the fixed Shell/Git/network/delete/move/rename/create-directory list", () => {
    const summary = generatePermissionSummary(baseInput());
    expect([...summary.forbiddenCapabilities]).toEqual([
      "shell",
      "git",
      "network",
      "delete",
      "move",
      "rename",
      "create_directory"
    ]);
  });

  test("planning mode always resolves to write_before_confirmation and exposes no proposal capabilities, even when the draft carries user_preapproved_run", () => {
    const summary = generatePermissionSummary(
      baseInput({ operationMode: "planning", writePolicy: "user_preapproved_run" })
    );
    expect(summary.writePolicy).toBe("write_before_confirmation");
    expect(summary.proposalCapabilities).toEqual([]);
  });

  test("planning mode is read-only: only read-effect tools are ever surfaced as capabilities", () => {
    const summary = generatePermissionSummary(baseInput({ operationMode: "planning" }));
    const tools = listAgentTools({
      operationMode: "planning",
      contextMode: summary.contextMode,
      writePolicy: summary.writePolicy
    });
    expect(tools.every((tool) => tool.effect !== "propose")).toBe(true);
    expect(summary.proposalCapabilities).toEqual([]);
  });
});

describe("generatePermissionSummary checksum stability and drift sensitivity", () => {
  test("regenerating from identical inputs produces an identical checksum", () => {
    const first = generatePermissionSummary(baseInput({ permissionSummaryId: "a", generatedAt: "t1" }));
    const second = generatePermissionSummary(baseInput({ permissionSummaryId: "b", generatedAt: "t2" }));
    expect(first.checksum).toBe(second.checksum);
  });

  test("a changed root fingerprint changes the checksum", () => {
    const original = generatePermissionSummary(baseInput());
    const changedRoot = generatePermissionSummary(baseInput({ rootFingerprint: "0".repeat(64) }));
    expect(changedRoot.checksum).not.toBe(original.checksum);
    const drift = findPermissionSummaryDrift(original, changedRoot);
    expect(drift.map((entry) => entry.field)).toContain("rootFingerprint");
    expect(drift.map((entry) => entry.field)).toContain("checksum");
  });

  test("a Tool Registry revision change (a tool added upstream) changes toolRegistryRevision and the checksum", () => {
    const original = generatePermissionSummary(baseInput());
    const widenedListTools = (input: ListAgentToolsInput): readonly AgentToolDescriptor[] => [
      ...listAgentTools(input),
      {
        name: "read_project_text",
        kind: "file_tool",
        effect: "read",
        inputSchema: { type: "object" }
      } as AgentToolDescriptor
    ];
    const regenerated = generatePermissionSummary(baseInput({ listTools: widenedListTools }));
    expect(regenerated.toolRegistryRevision).not.toBe(original.toolRegistryRevision);
    expect(regenerated.checksum).not.toBe(original.checksum);
    const drift = findPermissionSummaryDrift(original, regenerated);
    expect(drift.map((entry) => entry.field)).toContain("toolRegistryRevision");
  });

  test("findPermissionSummaryDrift reports no drift when a stored summary is regenerated unchanged", () => {
    const stored = generatePermissionSummary(baseInput());
    const regenerated = generatePermissionSummary(
      baseInput({ permissionSummaryId: "different_id", generatedAt: "2026-07-16T01:00:00.000Z" })
    );
    expect(findPermissionSummaryDrift(stored, regenerated)).toEqual([]);
  });

  test("ignores an out-of-band permissionSummaryId/runId/generatedAt difference (expected to vary across generations)", () => {
    const stored = generatePermissionSummary(baseInput({ runId: "run_01" }));
    const regenerated = generatePermissionSummary(
      baseInput({ permissionSummaryId: "regenerated_id", runId: "run_02", generatedAt: "2026-07-16T02:00:00.000Z" })
    );
    expect(findPermissionSummaryDrift(stored, regenerated)).toEqual([]);
  });
});

describe("generatePermissionSummary rejects renderer-authored capability facts", () => {
  test("capability arrays injected onto the input (as an untyped renderer payload) are never trusted; output is derived fresh from the registry", () => {
    const tampered = {
      ...baseInput(),
      readCapabilities: ["shell", "network"],
      proposalCapabilities: ["propose_chapter_write", "delete_everything"],
      forbiddenCapabilities: [],
      checksum: "attacker-supplied-checksum"
    } as GeneratePermissionSummaryInput & {
      readCapabilities: readonly string[];
      proposalCapabilities: readonly string[];
      forbiddenCapabilities: readonly string[];
      checksum: string;
    };
    const summary = generatePermissionSummary(tampered);
    const honest = generatePermissionSummary(baseInput());
    expect([...summary.readCapabilities]).toEqual([...honest.readCapabilities]);
    expect([...summary.proposalCapabilities]).toEqual([...honest.proposalCapabilities]);
    expect([...summary.forbiddenCapabilities]).toEqual([...honest.forbiddenCapabilities]);
    expect(summary.checksum).toBe(honest.checksum);
    expect(summary.checksum).not.toBe("attacker-supplied-checksum");
  });

  test("a writePolicy value smuggled in via model/file-derived text that is not a recognized policy still resolves through the fixed union (TypeScript rejects it; a runtime cast is neutralized by re-deriving from the registry)", () => {
    const modelSuppliedPolicy = "grant_shell_access" as unknown as AgentWritePolicy;
    const summary = generatePermissionSummary(
      baseInput({ operationMode: "execution", writePolicy: modelSuppliedPolicy })
    );
    // The generator does not validate writePolicy itself (the coordinator/draft layer already
    // rejects unrecognized policies before this point); what matters here is that an unrecognized
    // policy can never smuggle in extra capabilities — the Tool Registry only ever returns the
    // fixed, known tool set regardless of what string writePolicy carries.
    const knownToolNames = new Set(
      listAgentTools({ operationMode: "execution", contextMode: "writing", writePolicy: "write_before_confirmation" })
        .concat(
          listAgentTools({ operationMode: "execution", contextMode: "writing", writePolicy: "user_preapproved_run" })
        )
        .map((tool) => tool.name)
    );
    for (const name of [...summary.readCapabilities, ...summary.proposalCapabilities]) {
      expect(knownToolNames.has(name as never)).toBe(true);
    }
  });
});

describe("PermissionSummary schema", () => {
  test("carries the fixed schemaVersion and the runDraftId/projectId facts verbatim", () => {
    const summary: PermissionSummary = generatePermissionSummary(baseInput());
    expect(summary.schemaVersion).toBe("1.0");
    expect(summary.projectId).toBe("project_01");
    expect(summary.runDraftId).toBe("run_draft_01");
    expect(summary.runId).toBeUndefined();
  });

  test("binds an optional runId when provided", () => {
    const summary = generatePermissionSummary(baseInput({ runId: "run_01" }));
    expect(summary.runId).toBe("run_01");
  });
});

function sortedNames(
  tools: readonly AgentToolDescriptor[],
  effect: AgentToolDescriptor["effect"]
): readonly string[] {
  return tools
    .filter((tool) => tool.effect === effect)
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));
}
