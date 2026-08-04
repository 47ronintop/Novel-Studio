import { describe, expect, test } from "vitest";

import {
  decideContextShareApproval,
  filterReadToolsBySharingPolicy,
  filterSensitiveEngineeringOutline,
  freezeRunModelSharingGrant,
  freezeWorkspaceModelSharingDefaults,
  parseAwaitingContextShareApproval,
  parseFrozenRunModelSharingGrant,
  parseFrozenWorkspaceModelSharingDefaults,
  preflightContextShareRead,
  type FrozenRunModelSharingGrant,
  type FrozenWorkspaceModelSharingDefaults
} from "../src/agent-model-sharing.js";

function sharingDefaults(
  overrides: Partial<FrozenWorkspaceModelSharingDefaults["defaults"]> = {}
): FrozenWorkspaceModelSharingDefaults {
  const result = freezeWorkspaceModelSharingDefaults({
    workspaceBindingId: "workspace_binding_1",
    defaults: {
      outlineMetadata: "automatic",
      activeResource: "automatic",
      conversationSummary: "ask",
      toolReadResults: "ask",
      ...overrides
    }
  });
  if (!result.ok) throw result.error;
  return result.value;
}

function runGrant(
  defaults: FrozenWorkspaceModelSharingDefaults,
  approvedResultKinds: readonly string[] = []
): FrozenRunModelSharingGrant {
  const result = freezeRunModelSharingGrant({
    profileId: "engineering",
    workspaceBindingId: defaults.workspaceBindingId,
    grant: {
      runDraftRevision: "7",
      defaultsRevision: defaults.defaultsRevision,
      includedRefIds: ["file:src/main.ts"],
      excludedRefIds: ["file:src/secret.ts"],
      approvedResultKinds
    }
  });
  if (!result.ok) throw result.error;
  return result.value;
}

describe("model sharing defaults and Run grants", () => {
  test("freezes canonical revisions independently from workspace trust", () => {
    const defaults = sharingDefaults();
    const reordered = runGrant(defaults, ["project_text", "chapter_body"]);
    const canonical = runGrant(defaults, ["chapter_body", "project_text"]);

    expect(defaults.defaultsRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered.grantRevision).toBe(canonical.grantRevision);
    expect(reordered.approvedResultKinds).toEqual(["chapter_body", "project_text"]);
    expect(Object.isFrozen(reordered)).toBe(true);
  });

  test("rejects standalone grants and included/excluded overlap", () => {
    const defaults = sharingDefaults();
    expect(
      freezeRunModelSharingGrant({
        profileId: "standalone",
        workspaceBindingId: defaults.workspaceBindingId,
        grant: {
          runDraftRevision: "1",
          defaultsRevision: defaults.defaultsRevision,
          includedRefIds: [],
          excludedRefIds: [],
          approvedResultKinds: []
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_MODEL_SHARING_GRANT_INVALID" } });
    expect(
      freezeRunModelSharingGrant({
        profileId: "writing",
        workspaceBindingId: defaults.workspaceBindingId,
        grant: {
          runDraftRevision: "1",
          defaultsRevision: defaults.defaultsRevision,
          includedRefIds: ["chapter:1"],
          excludedRefIds: ["chapter:1"],
          approvedResultKinds: []
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_MODEL_SHARING_GRANT_INVALID" } });
  });

  test("strict parsers reject unknown versions, extra fields, and tampered revisions", () => {
    const defaults = sharingDefaults();
    const grant = runGrant(defaults);
    expect(parseFrozenWorkspaceModelSharingDefaults(defaults)).toEqual(defaults);
    expect(parseFrozenRunModelSharingGrant(grant)).toEqual(grant);
    expect(() =>
      parseFrozenWorkspaceModelSharingDefaults({ ...defaults, schemaVersion: "2.0" })
    ).toThrow("AGENT_MODEL_SHARING_DEFAULTS_INVALID");
    expect(() => parseFrozenRunModelSharingGrant({ ...grant, extra: true })).toThrow(
      "AGENT_MODEL_SHARING_GRANT_INVALID"
    );
    expect(() =>
      parseFrozenRunModelSharingGrant({ ...grant, grantRevision: "f".repeat(64) })
    ).toThrow("AGENT_MODEL_SHARING_GRANT_INVALID");
  });
});

describe("JIT context read approval", () => {
  test("pauses before an ask read and binds approval without result data", () => {
    const defaults = sharingDefaults();
    const grant = runGrant(defaults);
    const preflight = preflightContextShareRead({
      defaults,
      grant,
      resultClass: "tool_read_result",
      resultKind: "project_text",
      toolCallId: "call_1"
    });
    expect(preflight).toMatchObject({
      ok: true,
      value: {
        decision: "awaiting_context_share_approval",
        approval: { status: "awaiting_context_share_approval", resultKind: "project_text" }
      }
    });
    if (!preflight.ok || preflight.value.decision !== "awaiting_context_share_approval") return;
    const pending = preflight.value.approval;
    expect(JSON.stringify(pending)).not.toContain("content");
    expect(parseAwaitingContextShareApproval(pending)).toEqual(pending);
    expect(() =>
      parseAwaitingContextShareApproval({
        ...pending,
        toolCallId: "replayed_call"
      })
    ).toThrow("AGENT_MODEL_SHARING_APPROVAL_INVALID");

    const approved = decideContextShareApproval({
      defaults,
      grant,
      pending,
      decision: "approve"
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(
      preflightContextShareRead({
        defaults,
        grant: approved.value,
        resultClass: "tool_read_result",
        resultKind: "project_text",
        toolCallId: "call_2"
      })
    ).toMatchObject({ ok: true, value: { decision: "allow", authorization: "run_grant" } });
  });

  test("omits denied read-result tools and fails closed on stale defaults", () => {
    const defaults = sharingDefaults({ toolReadResults: "deny" });
    const tools = [
      { name: "read_resource", resultClass: "tool_read_result" as const },
      { name: "finish" }
    ];
    expect(
      filterReadToolsBySharingPolicy({
        defaults: defaults.defaults,
        tools,
        resultClassFor: (tool) => tool.resultClass
      })
    ).toEqual([{ name: "finish" }]);
    expect(
      preflightContextShareRead({
        defaults: sharingDefaults(),
        grant: runGrant(defaults),
        resultClass: "tool_read_result",
        resultKind: "project_text",
        toolCallId: "call_1"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_MODEL_SHARING_BINDING_INVALID" } });
  });
});

describe("engineering outline filtering", () => {
  test("returns visible names but only a count for sensitive, ignored, managed, and invalid entries", () => {
    const result = filterSensitiveEngineeringOutline([
      { relativePath: "src/main.ts", kind: "file" },
      { relativePath: ".env.production", kind: "file" },
      { relativePath: ".ssh", kind: "directory" },
      { relativePath: "generated/client.ts", kind: "file", ignored: true },
      { relativePath: "managed/story.json", kind: "file", managed: true },
      { relativePath: "certs/app.pem", kind: "file" },
      { relativePath: "../outside.txt", kind: "file" }
    ]);

    expect(result).toEqual({
      visibleEntries: [{ relativePath: "src/main.ts", kind: "file" }],
      hiddenCount: 6
    });
    expect(JSON.stringify(result)).not.toContain("env.production");
    expect(JSON.stringify(result)).not.toContain("app.pem");
  });
});
