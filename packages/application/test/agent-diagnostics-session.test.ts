import { describe, expect, test } from "vitest";

import * as applicationExports from "../src/index.js";

type JsonObject = Record<string, unknown>;

function createMemoryRepository() {
  const runErrors = new Map<string, JsonObject>();
  const preflightErrors = new Map<string, JsonObject>();
  const writes: string[] = [];
  return {
    writes,
    async writeRunError(runId: string, record: JsonObject) {
      writes.push(`run:${runId}:${String(record["errorId"])}`);
      runErrors.set(`${runId}:${String(record["errorId"])}`, structuredClone(record));
      return { ok: true as const, value: record };
    },
    async readRunError(runId: string, errorId: string) {
      return { ok: true as const, value: runErrors.get(`${runId}:${errorId}`) };
    },
    async writePreflightError(record: JsonObject) {
      writes.push(`draft:${String(record["runDraftId"])}:${String(record["errorId"])}`);
      preflightErrors.set(String(record["errorId"]), structuredClone(record));
      return { ok: true as const, value: record };
    },
    async readPreflightError(errorId: string) {
      return { ok: true as const, value: preflightErrors.get(errorId) };
    }
  };
}

function createSession(repository: ReturnType<typeof createMemoryRepository>) {
  const factory = (applicationExports as unknown as Record<string, unknown>)[
    "createAgentDiagnosticsSession"
  ];
  expect(typeof factory).toBe("function");
  return (factory as (options: JsonObject) => Record<string, (...args: never[]) => Promise<unknown>>)({
    repository
  });
}

function unifiedError(overrides: JsonObject = {}): JsonObject {
  return {
    schemaVersion: "1.0",
    errorId: "err_source_01",
    code: "AGENT_PROVIDER_DISCONNECTED",
    category: "ModelProviderError",
    message: "The provider connection was interrupted.",
    recoverability: "retryable",
    suggestedAction: "Retry the interrupted model round.",
    traceId: "test",
    createdAt: "2026-07-17T12:00:00.000Z",
    redactedDetail: { requestId: "provider_request_01", stack: "must not persist" },
    ...overrides
  };
}

describe("AgentDiagnosticsSession", () => {
  test("normalizes and persists run errors before returning the renderer-safe record", async () => {
    const repository = createMemoryRepository();
    const session = createSession(repository);
    const result = (await session["recordRunError"]?.({
      projectId: "project_01",
      runId: "run_01",
      sequence: 7,
      checkpointId: "checkpoint_01",
      provider: "openai",
      model: "gpt-5",
      error: unifiedError(),
      recoveryState: "retryable",
      retryTargets: [{ kind: "model_round", id: "round_02" }]
    } as never)) as { ok: boolean; value?: JsonObject };

    expect(result).toMatchObject({
      ok: true,
      value: {
        errorId: "err_source_01",
        runId: "run_01",
        recoveryState: "retryable",
        suggestedActions: ["Retry the interrupted model round."],
        retryTargets: [{ kind: "model_round", id: "round_02" }]
      }
    });
    expect(repository.writes).toEqual(["run:run_01:err_source_01"]);
    expect(JSON.stringify(result.value)).not.toContain("must not persist");
  });

  test("persists preflight errors by runDraftId and reloads the same errorId", async () => {
    const repository = createMemoryRepository();
    const first = createSession(repository);
    const recorded = (await first["recordPreflightError"]?.({
      projectId: "project_01",
      runDraftId: "draft_01",
      error: unifiedError({
        errorId: "err_preflight_01",
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        category: "ValidationError",
        recoverability: "user-action",
        suggestedAction: "Choose a compatible model."
      }),
      recoveryState: "terminal"
    } as never)) as { ok: boolean; value?: JsonObject };
    expect(recorded).toMatchObject({
      ok: true,
      value: { errorId: "err_preflight_01", runDraftId: "draft_01" }
    });

    const reloaded = createSession(repository);
    expect(await reloaded["readPreflightError"]?.("err_preflight_01" as never)).toMatchObject({
      ok: true,
      value: {
        errorId: "err_preflight_01",
        runDraftId: "draft_01",
        recoveryState: "terminal"
      }
    });
  });

  test("rejects a malformed persisted record instead of forwarding it to the renderer", async () => {
    const repository = createMemoryRepository();
    await repository.writeRunError("run_01", {
      schemaVersion: "1.0",
      errorId: "err_bad",
      projectId: "project_01",
      runId: "run_01",
      runDraftId: "draft_01"
    });
    const session = createSession(repository);
    expect(await session["readRunError"]?.("run_01" as never, "err_bad" as never)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" }
    });
  });

  test("rejects valid records whose identifiers do not match the repository query", async () => {
    const repository = createMemoryRepository();
    const writer = createSession(repository);
    expect(
      await writer["recordRunError"]?.({
        projectId: "project_01",
        runId: "run_other",
        error: unifiedError({ errorId: "err_other" }),
        recoveryState: "retryable",
        retryTargets: [{ kind: "model_round", id: "round_02" }]
      } as never)
    ).toMatchObject({ ok: true });
    expect(
      await writer["recordPreflightError"]?.({
        projectId: "project_01",
        runDraftId: "draft_other",
        error: unifiedError({ errorId: "err_preflight_other" }),
        recoveryState: "terminal"
      } as never)
    ).toMatchObject({ ok: true });

    const mismatchedRepository = {
      ...repository,
      async readRunError() {
        return repository.readRunError("run_other", "err_other");
      },
      async readPreflightError() {
        return repository.readPreflightError("err_preflight_other");
      }
    };
    const reader = createSession(mismatchedRepository);
    expect(await reader["readRunError"]?.("run_requested" as never, "err_requested" as never)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" }
    });
    expect(await reader["readPreflightError"]?.("err_requested" as never)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" }
    });
  });
});
