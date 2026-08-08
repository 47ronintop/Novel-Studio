import { describe, expect, test, vi } from "vitest";

import {
  ENGINEERING_MUTATION_RENDERER_SYNC_EVENT,
  createEngineeringMutationRendererSyncCoordinatorV2
} from "../src/main/engineering-mutation-renderer-sync-v2.js";

const REQUEST_ID = `engineering_sync_${"a".repeat(48)}`;

describe("Engineering mutation Renderer synchronization V2", () => {
  test("accepts only the matching one-shot renderer acknowledgement", async () => {
    let payload: unknown;
    const coordinator = createEngineeringMutationRendererSyncCoordinatorV2({
      resolveTarget: () => ({
        send(channel, value) {
          expect(channel).toBe(ENGINEERING_MUTATION_RENDERER_SYNC_EVENT);
          payload = value;
        }
      }),
      createRequestId: () => REQUEST_ID
    });

    const requested = coordinator.request({
      operationKind: "replace_file",
      relativePaths: ["src/file.ts"]
    });
    expect(payload).toMatchObject({ requestId: REQUEST_ID, relativePaths: ["src/file.ts"] });
    expect(
      coordinator.complete({ schemaVersion: "2.0", requestId: REQUEST_ID, status: "synchronized" })
    ).toEqual({ ok: true, value: undefined });
    await expect(requested).resolves.toEqual({ ok: true, value: undefined });
    expect(
      coordinator.complete({ schemaVersion: "2.0", requestId: REQUEST_ID, status: "synchronized" })
    ).toMatchObject({ ok: false });
  });

  test("fails closed on renderer failure or timeout", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createEngineeringMutationRendererSyncCoordinatorV2({
        resolveTarget: () => ({ send: vi.fn() }),
        timeoutMs: 10,
        createRequestId: () => REQUEST_ID
      });
      const requested = coordinator.request({
        operationKind: "create_file",
        relativePaths: ["src/new.ts"]
      });
      await vi.advanceTimersByTimeAsync(11);
      await expect(requested).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_RENDERER_SYNC_TIMEOUT" }
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
