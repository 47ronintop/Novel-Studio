import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import { APPLICATION_IPC_CHANNELS } from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createWritingEditorStateRegistry } from "../src/main/writing-editor-state-registry.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const bufferContent = "Writing editor buffer";
const checksum = createHash("sha256").update(bufferContent, "utf8").digest("hex");

describe("writing editor state IPC", () => {
  test("allowlists a strictly parsed report and returns an acknowledgement for the next revision", async () => {
    const registry = createWritingEditorStateRegistry();
    const handlers = createApplicationIpcHandlers({} as never, {
      writingEditorStateRegistry: registry,
      getActiveWritingEditorWorkspaceId: () => "project-01"
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    expect(APPLICATION_IPC_CHANNELS).toContain("application:writing-editor:report-state");
    await expect(
      handlers["application:writing-editor:report-state"]({
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01",
        editorInstanceId: "editor-01",
        connection: "connected",
        rendererRevision: 1,
        acknowledgedRevision: 0,
        dirty: true,
        bufferChecksum: checksum,
        bufferContent
      })
    ).resolves.toEqual({
      ok: true,
      acknowledgement: {
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01",
        editorInstanceId: "editor-01",
        rendererRevision: 1
      }
    });
    expect(
      registry.observe({
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01"
      })
    ).toMatchObject({
      status: "unknown",
      reason: "ack_pending"
    });

    await expect(
      handlers["application:writing-editor:report-state"]({
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01",
        editorInstanceId: "editor-01",
        connection: "connected",
        rendererRevision: 2,
        acknowledgedRevision: 1,
        dirty: false,
        bufferChecksum: checksum,
        bufferContent
      })
    ).resolves.toMatchObject({ ok: true, acknowledgement: { rendererRevision: 2 } });
    await expect(
      handlers["application:writing-editor:report-state"]({
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01",
        editorInstanceId: "editor-01",
        connection: "connected",
        rendererRevision: 2,
        acknowledgedRevision: 2,
        dirty: false,
        bufferChecksum: checksum,
        bufferContent
      })
    ).resolves.toMatchObject({ ok: true, acknowledgement: { rendererRevision: 2 } });
    expect(
      registry.observe({
        workspaceId: "project-01",
        resourceKind: "chapter",
        resourceId: "chapter-01"
      })
    ).toMatchObject({ status: "connected", state: { dirty: false } });
  });

  test("fails closed for malformed, inactive-workspace, and unavailable reports", async () => {
    const registry = createWritingEditorStateRegistry();
    const handlers = createApplicationIpcHandlers({} as never, {
      writingEditorStateRegistry: registry,
      getActiveWritingEditorWorkspaceId: () => "project-01"
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    const report = {
      workspaceId: "project-01",
      resourceKind: "story_bible",
      resourceId: "chr_hero",
      editorInstanceId: "editor-01",
      connection: "connected",
      rendererRevision: 1,
      acknowledgedRevision: 0,
      dirty: false,
      bufferChecksum: checksum,
      bufferContent
    };

    await expect(
      handlers["application:writing-editor:report-state"]({ ...report, unexpected: true })
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_INPUT_INVALID" } });
    const oversizedBuffer = "x".repeat(256 * 1024 + 1);
    await expect(
      handlers["application:writing-editor:report-state"]({
        ...report,
        bufferContent: oversizedBuffer,
        bufferChecksum: createHash("sha256").update(oversizedBuffer, "utf8").digest("hex")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_INPUT_INVALID" } });
    await expect(
      handlers["application:writing-editor:report-state"]({ ...report, workspaceId: "project-02" })
    ).resolves.toMatchObject({ ok: false, error: { code: "EDITOR_STATE_WORKSPACE_MISMATCH" } });
    expect(registry.readInstance({ ...report })).toBeUndefined();

    const unavailable = createApplicationIpcHandlers({} as never) as unknown as Record<
      string,
      (input: unknown) => Promise<unknown>
    >;
    await expect(
      unavailable["application:writing-editor:report-state"](report)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EDITOR_STATE_UNAVAILABLE" }
    });
  });

  test("preload exposes the report endpoint without widening the channel", async () => {
    const calls: unknown[][] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push([channel, ...args]);
        return { ok: true, acknowledgement: { rendererRevision: 1 } };
      }
    });
    const report = {
      workspaceId: "project-01",
      resourceKind: "chapter" as const,
      resourceId: "chapter-01",
      editorInstanceId: "editor-01",
      connection: "connected" as const,
      rendererRevision: 1,
      acknowledgedRevision: 0,
      dirty: false,
      bufferChecksum: checksum,
      bufferContent
    };

    await expect(api.writingEditor.reportState(report)).resolves.toEqual({
      ok: true,
      acknowledgement: { rendererRevision: 1 }
    });
    expect(calls).toEqual([["application:writing-editor:report-state", report]]);
  });
});
