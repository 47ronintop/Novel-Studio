import { describe, expect, test } from "vitest";

import * as agentEngineExports from "../src/index.js";

type JsonObject = Record<string, unknown>;

function api() {
  const exports = agentEngineExports as unknown as Record<string, unknown>;
  const create = exports["createAgentRunErrorRecord"];
  const validate = exports["validateAgentRunErrorRecord"];
  const resolveLegacy = exports["resolveLegacyRetryTarget"];
  expect(typeof create).toBe("function");
  expect(typeof validate).toBe("function");
  expect(typeof resolveLegacy).toBe("function");
  return {
    create: create as (input: JsonObject) =>
      | { readonly ok: true; readonly value: JsonObject }
      | { readonly ok: false; readonly error: JsonObject },
    validate: validate as (input: JsonObject) =>
      | { readonly ok: true; readonly value: JsonObject }
      | { readonly ok: false; readonly error: JsonObject },
    resolveLegacy: resolveLegacy as (record: JsonObject) =>
      | { readonly ok: true; readonly value: JsonObject }
      | { readonly ok: false; readonly error: JsonObject }
  };
}

function baseInput(overrides: JsonObject = {}): JsonObject {
  return {
    errorId: "err_run_01",
    projectId: "project_01",
    runId: "run_01",
    sequence: 8,
    category: "ModelProviderError",
    code: "AGENT_PROVIDER_DISCONNECTED",
    message: "The provider connection was interrupted.",
    recoverability: "retryable",
    suggestedActions: ["Retry the interrupted model round."],
    provider: "openai",
    model: "gpt-5",
    redactedDetail: {},
    recoveryState: "retryable",
    retryTargets: [{ kind: "model_round", id: "round_02" }],
    createdAt: "2026-07-17T12:00:00.000Z",
    ...overrides
  };
}

describe("AgentRunErrorRecord", () => {
  test("separates preflight draft errors from errors belonging to a created run", () => {
    const { create } = api();
    const preflight = create(
      baseInput({
        errorId: "err_draft_01",
        runId: undefined,
        runDraftId: "draft_01",
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        recoveryState: "terminal",
        retryTargets: []
      })
    );
    expect(preflight).toMatchObject({
      ok: true,
      value: { runDraftId: "draft_01", code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED" }
    });
    expect(preflight.ok && preflight.value).not.toHaveProperty("runId");

    expect(create(baseInput({ runId: undefined }))).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_SCOPE_INVALID" }
    });
    expect(create(baseInput({ runDraftId: "draft_01" }))).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_SCOPE_INVALID" }
    });
  });

  test("redacts sensitive fields, removes stack recursively, and never persists an Error stack", () => {
    const { create } = api();
    const created = create(
      baseInput({
        redactedDetail: {
          apiKey: "sk-secret",
          authorization: "Bearer secret",
          providerFrame: {
            requestId: "request_01",
            stack: "provider stack",
            nested: { stack: "nested stack", safeCode: "disconnect" }
          },
          stack: "top-level stack"
        }
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const serialized = JSON.stringify(created.value);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("provider stack");
    expect(serialized).not.toContain("nested stack");
    expect(serialized).not.toContain('"stack"');
    expect(serialized).toContain("request_01");
    expect(serialized).toContain("disconnect");
  });

  test("rejects persisted records that reintroduce stack fields outside normalization", () => {
    const { create, validate } = api();
    const created = create(baseInput({ redactedDetail: { requestId: "request_01" } }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(validate({ ...created.value, stack: "top-level stack" })).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" }
    });
    expect(
      validate({
        ...created.value,
        redactedDetail: { nested: { stack: "nested stack", safeCode: "disconnect" } }
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" }
    });
  });

  test("caps serialized redactedDetail at 8 KiB with a field-level truncation summary", () => {
    const { create } = api();
    const created = create(
      baseInput({
        redactedDetail: {
          responseBody: "x".repeat(32 * 1024),
          secondField: "y".repeat(32 * 1024)
        }
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detail = created.value["redactedDetail"] as JsonObject;
    expect(Buffer.byteLength(JSON.stringify(detail), "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(detail).toMatchObject({ truncated: true });
    expect(Array.isArray(detail["fields"])).toBe(true);
  });

  test("persists explicit targets and maps legacy retry only when exactly one target is available", () => {
    const { create, resolveLegacy } = api();
    const single = create(
      baseInput({
        toolCallId: "tool_01",
        retryTargets: [{ kind: "tool_call", id: "tool_01" }]
      })
    );
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(resolveLegacy(single.value)).toEqual({
      ok: true,
      value: { kind: "tool_call", id: "tool_01" }
    });

    const ambiguous = create(
      baseInput({
        checkpointId: "checkpoint_01",
        toolCallId: "tool_01",
        retryTargets: [
          { kind: "tool_call", id: "tool_01" },
          { kind: "checkpoint", id: "checkpoint_01" }
        ]
      })
    );
    expect(ambiguous.ok).toBe(true);
    if (!ambiguous.ok) return;
    expect(resolveLegacy(ambiguous.value)).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_RETRY_TARGET_AMBIGUOUS",
        suggestedAction: expect.stringContaining("refresh")
      }
    });

    expect(
      create(baseInput({ retryTargets: [{ kind: "tool_call", id: "x".repeat(513) }] }))
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" } });
    expect(
      create(
        baseInput({
          retryTargets: [{ kind: "tool_call", id: "tool_01", stack: "must not persist" }]
        })
      )
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" } });
  });

  test("supports context stale, base conflict, and partial failure journal references", () => {
    const { create } = api();
    expect(
      create(
        baseInput({
          code: "AGENT_CONTEXT_STALE",
          recoveryState: "awaiting_context_refresh",
          retryTargets: [],
          redactedDetail: { staleRefs: ["chapter:01"] }
        })
      )
    ).toMatchObject({ ok: true, value: { recoveryState: "awaiting_context_refresh" } });
    expect(
      create(
        baseInput({
          code: "CHANGE_SET_BASE_HASH_CONFLICT",
          toolCallId: "tool_conflict",
          retryTargets: [{ kind: "tool_call", id: "tool_conflict" }]
        })
      )
    ).toMatchObject({ ok: true, value: { code: "CHANGE_SET_BASE_HASH_CONFLICT" } });
    expect(
      create(
        baseInput({
          code: "AGENT_WRITE_PARTIAL_FAILURE",
          recoveryState: "recovery_review",
          retryTargets: [],
          redactedDetail: {
            recoveryJournal: { versionGroupId: "version_group_01" }
          }
        })
      )
    ).toMatchObject({
      ok: true,
      value: {
        recoveryState: "recovery_review",
        redactedDetail: { recoveryJournal: { versionGroupId: "version_group_01" } }
      }
    });
  });

  test("keeps only the recovery journal ID for partial failure diagnostics", () => {
    const { create } = api();
    const created = create(
      baseInput({
        code: "AGENT_WRITE_PARTIAL_FAILURE",
        recoveryState: "recovery_review",
        retryTargets: [],
        redactedDetail: {
          recoveryJournal: {
            versionGroupId: "version_group_01",
            copiedJournalPayload: { writes: ["notes/private.md"] }
          },
          failedFiles: ["notes/private.md"]
        }
      })
    );

    expect(created).toEqual({
      ok: true,
      value: expect.objectContaining({
        redactedDetail: {
          recoveryJournal: { versionGroupId: "version_group_01" }
        }
      })
    });
  });
});
