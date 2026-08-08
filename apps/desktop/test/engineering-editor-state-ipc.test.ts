import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import { APPLICATION_IPC_CHANNELS } from "@novel-studio/application";

import { createEngineeringEditorStateRegistry } from "../src/main/engineering-editor-state-registry.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const activeRootBindingId = "native-root-binding-01";
const bufferContent = "Engineering editor buffer";
const bufferChecksum = checksum(bufferContent);

describe("engineering editor state IPC", () => {
  test("accepts only the active opaque root binding and records the acknowledged state in Main", async () => {
    const registry = createEngineeringEditorStateRegistry();
    const handlers = createApplicationIpcHandlers({} as never, {
      engineeringEditorStateRegistry: registry,
      getActiveEngineeringEditorRootBindingId: () => activeRootBindingId
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    const report = stateReport({ acknowledgedRevision: 0 });

    expect(APPLICATION_IPC_CHANNELS).toContain("application:engineering-editor:report-state");
    await expect(handlers["application:engineering-editor:report-state"](report)).resolves.toEqual({
      ok: true,
      acknowledgement: {
        rootBindingId: activeRootBindingId,
        relativePath: "src/main.ts",
        editorInstanceId: "editor-01",
        rendererRevision: 1
      }
    });
    expect(
      registry.observe({ rootBindingId: activeRootBindingId, relativePath: "src/main.ts" })
    ).toMatchObject({ status: "unknown", reason: "ack_pending" });

    await expect(
      handlers["application:engineering-editor:report-state"](
        stateReport({ acknowledgedRevision: 1 })
      )
    ).resolves.toMatchObject({ ok: true, acknowledgement: { rendererRevision: 1 } });
    expect(
      registry.observe({ rootBindingId: activeRootBindingId, relativePath: "src/main.ts" })
    ).toMatchObject({
      status: "connected",
      state: { rootBindingId: activeRootBindingId, relativePath: "src/main.ts", dirty: true }
    });
  });

  test("fails closed when the binding is missing, mismatched, or renderer input tries to authorize paths or workspace ids", async () => {
    const registry = createEngineeringEditorStateRegistry();
    const handlers = createApplicationIpcHandlers({} as never, {
      engineeringEditorStateRegistry: registry,
      getActiveEngineeringEditorRootBindingId: () => activeRootBindingId
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    await expect(
      handlers["application:engineering-editor:report-state"](
        stateReport({ rootBindingId: "renderer-supplied-root" })
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EDITOR_STATE_ROOT_BINDING_MISMATCH" }
    });
    await expect(
      handlers["application:engineering-editor:report-state"]({
        ...stateReport(),
        workspaceId: "renderer-workspace-id"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_INPUT_INVALID" } });
    await expect(
      handlers["application:engineering-editor:report-state"]({
        ...stateReport(),
        workspaceRootPath: "C:\\renderer-controlled-root"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_INPUT_INVALID" } });
    expect(
      registry.observe({ rootBindingId: activeRootBindingId, relativePath: "src/main.ts" })
    ).toMatchObject({ status: "unknown", reason: "missing" });

    const unavailable = createApplicationIpcHandlers({} as never, {
      engineeringEditorStateRegistry: registry
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    await expect(
      unavailable["application:engineering-editor:report-state"](stateReport())
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UNAVAILABLE" } });
  });

  test("records unknown and disconnected reports as fail-closed editor state", async () => {
    const registry = createEngineeringEditorStateRegistry();
    const handlers = createApplicationIpcHandlers({} as never, {
      engineeringEditorStateRegistry: registry,
      getActiveEngineeringEditorRootBindingId: () => activeRootBindingId
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    const target = { rootBindingId: activeRootBindingId, relativePath: "src/main.ts" };

    await expect(
      handlers["application:engineering-editor:report-state"](
        stateReport({
          connection: "unknown",
          acknowledgedRevision: 1,
          dirty: false,
          bufferContent: "",
          bufferChecksum: checksum("")
        })
      )
    ).resolves.toMatchObject({ ok: true });
    expect(registry.observe(target)).toMatchObject({
      status: "unknown",
      reason: "reported_unknown"
    });

    await expect(
      handlers["application:engineering-editor:report-state"](
        stateReport({
          connection: "disconnected",
          rendererRevision: 2,
          acknowledgedRevision: 2,
          dirty: false,
          bufferContent: "",
          bufferChecksum: checksum("")
        })
      )
    ).resolves.toMatchObject({ ok: true });
    expect(registry.observe(target)).toMatchObject({ status: "disconnected" });
  });

  test("preload exposes only the typed report endpoint", async () => {
    const calls: unknown[][] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push([channel, ...args]);
        return { ok: true, acknowledgement: { rendererRevision: 1 } };
      }
    });

    await expect(api.engineeringEditor.reportState(stateReport())).resolves.toEqual({
      ok: true,
      acknowledgement: { rendererRevision: 1 }
    });
    expect(calls).toEqual([["application:engineering-editor:report-state", stateReport()]]);
  });
});

function stateReport(overrides: Record<string, unknown> = {}) {
  return {
    rootBindingId: activeRootBindingId,
    relativePath: "src/main.ts",
    editorInstanceId: "editor-01",
    connection: "connected",
    rendererRevision: 1,
    acknowledgedRevision: 1,
    dirty: true,
    bufferChecksum,
    bufferContent,
    ...overrides
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
