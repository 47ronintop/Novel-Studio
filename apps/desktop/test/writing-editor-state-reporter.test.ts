import { describe, expect, test, vi } from "vitest";

import type { NovelStudioApi, WritingEditorStateReport } from "@novel-studio/application";

import {
  createWritingEditorStateReporter,
  type WritingEditorStateSnapshot
} from "../src/renderer/writing-editor-state-reporter.js";

const snapshot: WritingEditorStateSnapshot = {
  workspaceId: "project-01",
  resourceKind: "chapter",
  resourceId: "chapter-01",
  editorInstanceId: "editor-01",
  dirty: true,
  bufferContent: "Unsaved chapter buffer"
};

describe("writing editor state reporter", () => {
  test("echoes each Main acknowledgement before exposing a connected state", async () => {
    const reports: WritingEditorStateReport[] = [];
    const reportState = vi.fn(async (report: WritingEditorStateReport) => {
      reports.push(report);
      return {
        ok: true as const,
        acknowledgement: {
          workspaceId: report.workspaceId,
          resourceKind: report.resourceKind,
          resourceId: report.resourceId,
          editorInstanceId: report.editorInstanceId,
          rendererRevision: report.rendererRevision
        }
      };
    });
    const reporter = createWritingEditorStateReporter({
      writingEditor: { reportState }
    } as NovelStudioApi);

    await expect(reporter.open(snapshot)).resolves.toEqual({
      status: "connected",
      rendererRevision: 1
    });
    await expect(
      reporter.report({ ...snapshot, dirty: false, bufferContent: "Saved chapter buffer" })
    ).resolves.toEqual({ status: "connected", rendererRevision: 2 });
    await expect(reporter.disconnect()).resolves.toEqual({
      status: "connected",
      rendererRevision: 3
    });

    expect(reports).toHaveLength(6);
    expect(
      reports.map((report) => [
        report.connection,
        report.rendererRevision,
        report.acknowledgedRevision
      ])
    ).toEqual([
      ["connected", 1, 0],
      ["connected", 1, 1],
      ["connected", 2, 1],
      ["connected", 2, 2],
      ["disconnected", 3, 2],
      ["disconnected", 3, 3]
    ]);
    expect(reports.every((report) => /^[a-f0-9]{64}$/u.test(report.bufferChecksum))).toBe(true);
    expect(reports.map((report) => report.bufferContent)).toEqual([
      "Unsaved chapter buffer",
      "Unsaved chapter buffer",
      "Saved chapter buffer",
      "Saved chapter buffer",
      "",
      ""
    ]);
  });

  test("reports a dirty close as unknown rather than dropping its buffer", async () => {
    const reports: WritingEditorStateReport[] = [];
    const reporter = createWritingEditorStateReporter({
      writingEditor: {
        reportState: async (report) => {
          reports.push(report);
          return {
            ok: true as const,
            acknowledgement: {
              workspaceId: report.workspaceId,
              resourceKind: report.resourceKind,
              resourceId: report.resourceId,
              editorInstanceId: report.editorInstanceId,
              rendererRevision: report.rendererRevision
            }
          };
        }
      }
    } as NovelStudioApi);

    await reporter.open(snapshot);
    await reporter.disconnect();

    expect(reports.slice(-2)).toMatchObject([
      { connection: "unknown", dirty: true, bufferContent: "Unsaved chapter buffer" },
      { connection: "unknown", dirty: true, bufferContent: "Unsaved chapter buffer" }
    ]);
  });

  test("does not silently switch a report to another workspace or resource", async () => {
    const reportState = vi.fn(async (report: WritingEditorStateReport) => ({
      ok: true as const,
      acknowledgement: {
        workspaceId: report.workspaceId,
        resourceKind: report.resourceKind,
        resourceId: report.resourceId,
        editorInstanceId: report.editorInstanceId,
        rendererRevision: report.rendererRevision
      }
    }));
    const reporter = createWritingEditorStateReporter({
      writingEditor: { reportState }
    } as NovelStudioApi);

    await reporter.open(snapshot);
    await expect(reporter.report({ ...snapshot, workspaceId: "project-02" })).resolves.toEqual({
      status: "unknown",
      code: "EDITOR_STATE_RESOURCE_MISMATCH"
    });
    expect(reportState).toHaveBeenCalledTimes(2);
  });

  test("keeps the editor unknown when the preload capability is missing or rejects the report", async () => {
    const unavailable = createWritingEditorStateReporter({} as NovelStudioApi);
    await expect(unavailable.open(snapshot)).resolves.toEqual({
      status: "unknown",
      code: "EDITOR_STATE_UNAVAILABLE"
    });

    const rejected = createWritingEditorStateReporter({
      writingEditor: {
        reportState: async () => ({
          ok: false as const,
          error: { code: "EDITOR_STATE_UNAVAILABLE" as const, message: "Unavailable" }
        })
      }
    } as NovelStudioApi);
    await expect(rejected.open(snapshot)).resolves.toEqual({
      status: "unknown",
      code: "EDITOR_STATE_REJECTED"
    });
  });
});
