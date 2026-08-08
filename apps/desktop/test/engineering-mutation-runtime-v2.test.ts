import { describe, expect, test } from "vitest";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
  createEngineeringMutationRuntimeV2,
  type EngineeringMutationEditorPreflightV2,
  type EngineeringMutationRuntimeApplyRequestV2,
  type EngineeringMutationRuntimeV2,
  type EngineeringMutationSyncPortV2,
  type EngineeringMutationSyncRequiredRecordV2,
  type EngineeringMutationSyncRequiredPortV2
} from "../src/main/engineering-mutation-runtime-v2.js";

const CHECKSUM = "a".repeat(64);
const FIXED_NOW = "2030-01-02T03:04:05.000Z";

type VoidResult = Result<undefined, UnifiedError>;

describe("Engineering mutation runtime V2", () => {
  test("runs the strict Main-only preflight, transaction, sync, and release sequence", async () => {
    const harness = createRuntimeHarness();
    const request = createRequest("root-alpha");

    const result = await harness.runtime.apply(request);

    expect(result).toEqual(
      ok({
        schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
        status: "committed",
        contentRootBindingId: "root-alpha",
        transactionId: transactionIdFor("root-alpha")
      })
    );
    expect(harness.calls).toEqual([
      "gate",
      "sync-required-check",
      "lease",
      "lease-current",
      "save-pause-drain",
      "editor",
      "revalidate",
      "gate",
      "lease-current",
      "transaction",
      "sync",
      "save-release",
      "lease-release"
    ]);
    expect(harness.transactionInputs).toEqual([request.transactionInput]);
    expect(harness.syncInputs).toEqual([
      {
        contentRootBindingId: "root-alpha",
        operationKind: "replace_file",
        relativeIdentities: ["src/index.ts"],
        transactionId: transactionIdFor("root-alpha")
      }
    ]);
  });

  test("does not write when an affected editor is dirty, unknown, or disconnected", async () => {
    for (const { status, expectedCode } of [
      { status: "dirty" as const, expectedCode: "ENGINEERING_MUTATION_RUNTIME_EDITOR_DIRTY" },
      {
        status: "unknown" as const,
        expectedCode: "ENGINEERING_MUTATION_RUNTIME_EDITOR_STATE_UNKNOWN"
      },
      {
        status: "disconnected" as const,
        expectedCode: "ENGINEERING_MUTATION_RUNTIME_EDITOR_STATE_UNKNOWN"
      }
    ]) {
      const harness = createRuntimeHarness();
      harness.state.editorDecision = { status };

      const result = await harness.runtime.apply(createRequest("root-alpha"));

      expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
      expect(harness.transactionInputs).toHaveLength(0);
      expect(harness.calls).not.toContain("transaction");
    }
  });

  test("does not write when the recovery gate fails or the root lease drifts", async () => {
    const gateFailure = createRuntimeHarness();
    gateFailure.state.gateResponses.push(err(testError("RECOVERY_BLOCKED")));

    const blocked = await gateFailure.runtime.apply(createRequest("root-alpha"));

    expect(blocked).toMatchObject({ ok: false, error: { code: "RECOVERY_BLOCKED" } });
    expect(gateFailure.acquiredRoots).toHaveLength(0);
    expect(gateFailure.transactionInputs).toHaveLength(0);
    expect(gateFailure.mutationUnavailableNotifications).toEqual(["notified"]);

    const leaseDrift = createRuntimeHarness();
    leaseDrift.state.leaseResponses.push(ok<undefined>(undefined), err(testError("LEASE_DRIFT")));

    const drifted = await leaseDrift.runtime.apply(createRequest("root-alpha"));

    expect(drifted).toMatchObject({ ok: false, error: { code: "LEASE_DRIFT" } });
    expect(leaseDrift.acquiredRoots).toEqual(["root-alpha"]);
    expect(leaseDrift.transactionInputs).toHaveLength(0);
    expect(leaseDrift.calls).not.toContain("transaction");
  });

  test("persists sync_required after a committed sync failure and blocks another apply", async () => {
    const harness = createRuntimeHarness();
    harness.state.synchronizeResult = err(testError("SYNC_FAILED"));
    const request = createRequest("root-alpha");

    const first = await harness.runtime.apply(request);

    expect(first).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_RUNTIME_SYNC_REQUIRED" }
    });
    expect(harness.transactionInputs).toHaveLength(1);
    expect(harness.syncRequiredRecords).toEqual([
      {
        schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
        kind: "sync_required",
        contentRootBindingId: "root-alpha",
        transactionId: transactionIdFor("root-alpha"),
        operationKind: "replace_file",
        relativeIdentities: ["src/index.ts"],
        recordedAt: FIXED_NOW
      }
    ]);
    expect(harness.mutationUnavailableNotifications).toEqual(["notified"]);

    const second = await harness.runtime.apply(request);

    expect(second).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_RUNTIME_SYNC_REQUIRED" }
    });
    expect(harness.transactionInputs).toHaveLength(1);
    expect(harness.acquiredRoots).toEqual(["root-alpha"]);
  });

  test("uses separate root-bound leases for different content roots", async () => {
    const harness = createRuntimeHarness();
    const alpha = createRequest("root-alpha");
    const beta = createRequest("root-beta");

    const [alphaResult, betaResult] = await Promise.all([
      harness.runtime.apply(alpha),
      harness.runtime.apply(beta)
    ]);

    expect(alphaResult).toMatchObject({
      ok: true,
      value: { contentRootBindingId: "root-alpha", transactionId: transactionIdFor("root-alpha") }
    });
    expect(betaResult).toMatchObject({
      ok: true,
      value: { contentRootBindingId: "root-beta", transactionId: transactionIdFor("root-beta") }
    });
    expect(harness.acquiredRoots).toHaveLength(2);
    expect(new Set(harness.acquiredRoots)).toEqual(new Set(["root-alpha", "root-beta"]));
    expect(new Set(harness.syncInputs.map((input) => input.contentRootBindingId))).toEqual(
      new Set(["root-alpha", "root-beta"])
    );
  });
});

interface RuntimeHarnessState {
  editorDecision: EngineeringMutationEditorPreflightV2;
  gateResponses: VoidResult[];
  leaseResponses: VoidResult[];
  synchronizeResult: VoidResult;
  syncRequiredClearResult: VoidResult;
  syncRequiredWriteResult: VoidResult;
}

interface RuntimeHarness {
  readonly runtime: EngineeringMutationRuntimeV2;
  readonly state: RuntimeHarnessState;
  readonly calls: string[];
  readonly acquiredRoots: string[];
  readonly transactionInputs: unknown[];
  readonly syncInputs: Parameters<EngineeringMutationSyncPortV2["synchronize"]>[0][];
  readonly syncRequiredRecords: EngineeringMutationSyncRequiredRecordV2[];
  readonly mutationUnavailableNotifications: string[];
}

function createRuntimeHarness(): RuntimeHarness {
  const calls: string[] = [];
  const acquiredRoots: string[] = [];
  const transactionInputs: unknown[] = [];
  const syncInputs: Parameters<EngineeringMutationSyncPortV2["synchronize"]>[0][] = [];
  const syncRequiredRecords: EngineeringMutationSyncRequiredRecordV2[] = [];
  const mutationUnavailableNotifications: string[] = [];
  const state: RuntimeHarnessState = {
    editorDecision: { status: "ready" },
    gateResponses: [],
    leaseResponses: [],
    synchronizeResult: ok<undefined>(undefined),
    syncRequiredClearResult: ok<undefined>(undefined),
    syncRequiredWriteResult: ok<undefined>(undefined)
  };
  const syncRequired: EngineeringMutationSyncRequiredPortV2 = {
    async assertNoSyncRequired() {
      calls.push("sync-required-check");
      return state.syncRequiredClearResult;
    },
    async writeSyncRequired(record) {
      calls.push("sync-required-write");
      syncRequiredRecords.push(record);
      return state.syncRequiredWriteResult;
    }
  };
  const runtime = createEngineeringMutationRuntimeV2({
    recoveryGate: {
      async assertMutationAllowed() {
        calls.push("gate");
        return nextVoidResult(state.gateResponses);
      }
    },
    rootLease: {
      async acquire(contentRootBindingId) {
        calls.push("lease");
        acquiredRoots.push(contentRootBindingId);
        return ok({
          contentRootBindingId,
          async assertCurrent() {
            calls.push("lease-current");
            return nextVoidResult(state.leaseResponses);
          },
          async release() {
            calls.push("lease-release");
          }
        });
      }
    },
    saveCoordinator: {
      async pauseAndDrainRoot() {
        calls.push("save-pause-drain");
        return ok({
          async release() {
            calls.push("save-release");
          }
        });
      }
    },
    editorState: {
      async inspectAll() {
        calls.push("editor");
        return ok(state.editorDecision);
      }
    },
    proposalApproval: {
      async revalidate(request) {
        calls.push("revalidate");
        return ok(validatedRequest(request));
      }
    },
    transaction: {
      async apply(input) {
        calls.push("transaction");
        transactionInputs.push(input);
        const transactionInput = input as {
          readonly contentRootBindingId: string;
          readonly transactionId: string;
        };
        return ok({
          prepared: {
            transactionId: transactionInput.transactionId,
            contentRootBindingId: transactionInput.contentRootBindingId
          },
          commit: {
            transactionId: transactionInput.transactionId,
            contentRootBindingId: transactionInput.contentRootBindingId
          }
        });
      }
    },
    synchronizer: {
      async synchronize(input) {
        calls.push("sync");
        syncInputs.push(input);
        return state.synchronizeResult;
      }
    },
    syncRequired,
    onMutationUnavailable: () => mutationUnavailableNotifications.push("notified"),
    now: () => FIXED_NOW
  });

  return {
    runtime,
    state,
    calls,
    acquiredRoots,
    transactionInputs,
    syncInputs,
    syncRequiredRecords,
    mutationUnavailableNotifications
  };
}

function createRequest(contentRootBindingId: string): EngineeringMutationRuntimeApplyRequestV2 {
  const transactionId = transactionIdFor(contentRootBindingId);
  return Object.freeze({
    schemaVersion: ENGINEERING_MUTATION_RUNTIME_V2_SCHEMA_VERSION,
    operationKind: "replace_file",
    contentRootBindingId,
    relativeIdentities: Object.freeze(["src/index.ts"]),
    proposalRevision: "proposal-revision-1",
    proposalBindingChecksum: CHECKSUM,
    approvalBindingId: "approval-binding-1",
    approvalBindingChecksum: CHECKSUM,
    capabilityRevision: "capability-revision-1",
    transactionInput: Object.freeze({ contentRootBindingId, transactionId })
  });
}

function validatedRequest(
  request: EngineeringMutationRuntimeApplyRequestV2
): EngineeringMutationRuntimeApplyRequestV2 & Readonly<{ transactionId: string }> {
  return Object.freeze({
    ...request,
    transactionId: transactionIdFor(request.contentRootBindingId)
  });
}

function transactionIdFor(contentRootBindingId: string): string {
  return `transaction-${contentRootBindingId}`;
}

function nextVoidResult(responses: VoidResult[]): VoidResult {
  return responses.shift() ?? ok<undefined>(undefined);
}

function testError(code: string): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: `engineering-mutation-runtime-test-${code.toLowerCase()}`,
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Fix the injected runtime test port.",
    traceId: "engineering-mutation-runtime-v2-test"
  };
}
