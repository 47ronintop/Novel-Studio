import { describe, expect, test } from "vitest";

import {
  applyAgentRunDraftMutation,
  bindContextDraft,
  createAgentRunDraft,
  type AgentRunDraft,
  type CreateAgentRunDraftInput
} from "../src/index.js";

function baseDraft(overrides: Partial<CreateAgentRunDraftInput> = {}): AgentRunDraft {
  return createAgentRunDraft({
    runDraftId: "run_draft_01",
    projectId: "project_01",
    conversationId: "conv_01",
    userRequest: "",
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    modelProfileId: "model_01",
    contextDraftId: "context_draft_01",
    contextDraftRevision: 1,
    contextDraftChecksum: "c".repeat(64),
    contextBudgetSnapshotId: null,
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  });
}

describe("Agent Run Draft value object", () => {
  test("creates revision 1 with a checksum and is frozen", () => {
    const draft = baseDraft();
    expect(draft.schemaVersion).toBe("1.0");
    expect(draft.revision).toBe(1);
    expect(draft.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  test("set_request produces one next revision and a changed checksum", () => {
    const draft = baseDraft();
    const result = applyAgentRunDraftMutation(
      draft,
      { kind: "set_request", request: "续写第三章" },
      "t1"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(2);
    expect(result.value.userRequest).toBe("续写第三章");
    expect(result.value.checksum).not.toBe(draft.checksum);
  });

  test("planning forces write_before_confirmation and clears acknowledgement on create", () => {
    const draft = baseDraft({
      operationMode: "planning",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    expect(draft.writePolicy).toBe("write_before_confirmation");
    expect(draft.writePolicyAcknowledged).toBe(false);
  });

  test("switching operation mode resets the automatic-write acknowledgement", () => {
    const execution = baseDraft({
      operationMode: "execution",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    expect(execution.writePolicyAcknowledged).toBe(true);
    const toPlanning = applyAgentRunDraftMutation(
      execution,
      { kind: "set_operation_mode", operationMode: "planning" },
      "t1"
    );
    expect(toPlanning.ok).toBe(true);
    if (!toPlanning.ok) return;
    expect(toPlanning.value.writePolicy).toBe("write_before_confirmation");
    expect(toPlanning.value.writePolicyAcknowledged).toBe(false);
  });

  test("rejects pre-approved automatic writes for a planning run", () => {
    const draft = baseDraft({ operationMode: "planning" });
    const result = applyAgentRunDraftMutation(
      draft,
      { kind: "set_write_policy", writePolicy: "user_preapproved_run", acknowledged: true },
      "t1"
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_WRITE_POLICY_NOT_AVAILABLE" }
    });
  });

  test("accepts an acknowledged automatic-write policy for an execution run", () => {
    const draft = baseDraft({ operationMode: "execution" });
    const result = applyAgentRunDraftMutation(
      draft,
      { kind: "set_write_policy", writePolicy: "user_preapproved_run", acknowledged: true },
      "t1"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.writePolicy).toBe("user_preapproved_run");
    expect(result.value.writePolicyAcknowledged).toBe(true);
  });

  test("set_model persists a model override and clears stale choices when switching", () => {
    const draft = baseDraft({ operationMode: "execution" });
    const modeled = applyAgentRunDraftMutation(
      draft,
      {
        kind: "set_model",
        modelProfileId: "model_02",
        modelName: "gpt-5.6",
        reasoningEffort: "ultra"
      },
      "t1"
    );
    expect(modeled.ok).toBe(true);
    if (!modeled.ok) return;
    expect(modeled.value.modelProfileId).toBe("model_02");
    expect(modeled.value.modelName).toBe("gpt-5.6");
    expect(modeled.value.reasoningEffort).toBe("ultra");

    const reasoned = applyAgentRunDraftMutation(
      modeled.value,
      { kind: "set_reasoning", reasoningEffort: "low" },
      "t2"
    );
    expect(reasoned.ok).toBe(true);
    if (!reasoned.ok) return;
    expect(reasoned.value.reasoningEffort).toBe("low");

    const switched = applyAgentRunDraftMutation(
      reasoned.value,
      { kind: "set_model", modelProfileId: "model_03", modelName: "gpt-5" },
      "t3"
    );
    expect(switched).toMatchObject({
      ok: true,
      value: { modelProfileId: "model_03", modelName: "gpt-5" }
    });
    if (switched.ok) {
      expect(switched.value).not.toHaveProperty("reasoningEffort");
    }
  });

  test("bindContextDraft re-points at a new context revision and checksum", () => {
    const draft = baseDraft();
    const bound = bindContextDraft(
      draft,
      {
        contextDraftId: "context_draft_01",
        contextDraftRevision: 5,
        contextDraftChecksum: "d".repeat(64)
      },
      "t1"
    );
    expect(bound.revision).toBe(draft.revision + 1);
    expect(bound.contextDraftRevision).toBe(5);
    expect(bound.contextDraftChecksum).toBe("d".repeat(64));
    expect(bound.checksum).not.toBe(draft.checksum);
    expect(structuredClone(bound)).toEqual(bound);
  });

  test("one checksum binds every pre-run choice", () => {
    const draft = baseDraft({ operationMode: "execution" });
    const changed = baseDraft({ operationMode: "execution", userRequest: "different" });
    expect(changed.checksum).not.toBe(draft.checksum);
    const sameContent = baseDraft({ operationMode: "execution" });
    expect(sameContent.checksum).toBe(draft.checksum);
  });
});
