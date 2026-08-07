import { describe, expect, test, vi } from "vitest";

import type { EngineeringEditorStateReport, NovelStudioApi } from "@novel-studio/application";

import {
  createEngineeringEditorStateReporter,
  type EngineeringEditorStateSnapshot
} from "../src/renderer/engineering-editor-state-reporter.js";

const snapshot: EngineeringEditorStateSnapshot = {
  rootBindingId: "root-binding-01",
  relativePath: "src/main.ts",
  editorInstanceId: "editor-01",
  dirty: true,
  bufferContent: "Unsaved engineering buffer"
};

describe("engineering editor state reporter", () => {
  test("echoes Main acknowledgement before it exposes the connected editor state", async () => {
    const reports: EngineeringEditorStateReport[] = [];
    const reporter = createEngineeringEditorStateReporter({
      engineeringEditor: {
        reportState: async (report) => {
          reports.push(report);
          return { ok: true as const, acknowledgement: acknowledgementFor(report) };
        }
      }
    } as NovelStudioApi);

    await expect(reporter.open(snapshot)).resolves.toEqual({
      status: "connected",
      rendererRevision: 1
    });
    await expect(
      reporter.report({ ...snapshot, dirty: false, bufferContent: "Persisted disk text" })
    ).resolves.toEqual({ status: "connected", rendererRevision: 2 });

    expect(reports.map((report) => [report.rendererRevision, report.acknowledgedRevision])).toEqual(
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2]
      ]
    );
    expect(reports.map((report) => report.bufferContent)).toEqual([
      "Unsaved engineering buffer",
      "Unsaved engineering buffer",
      "",
      ""
    ]);
    expect(reports.every((report) => /^[a-f0-9]{64}$/u.test(report.bufferChecksum))).toBe(true);
    expect(reports[2]).toMatchObject({
      bufferChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bufferContent: ""
    });
  });

  test("fails closed when the preload capability is missing or acknowledgement is malformed", async () => {
    await expect(
      createEngineeringEditorStateReporter({} as NovelStudioApi).open(snapshot)
    ).resolves.toEqual({ status: "unknown", code: "EDITOR_STATE_UNAVAILABLE" });

    const reporter = createEngineeringEditorStateReporter({
      engineeringEditor: {
        reportState: vi.fn(async (report: EngineeringEditorStateReport) => ({
          ok: true as const,
          acknowledgement: {
            ...acknowledgementFor(report),
            rendererRevision: report.rendererRevision + 1
          }
        }))
      }
    } as NovelStudioApi);
    await expect(reporter.open(snapshot)).resolves.toEqual({
      status: "unknown",
      code: "EDITOR_STATE_ACK_INVALID"
    });
  });

  test("reports a dirty close as unknown, preserving the fail-closed mutation guard", async () => {
    const reports: EngineeringEditorStateReport[] = [];
    const reporter = createEngineeringEditorStateReporter({
      engineeringEditor: {
        reportState: async (report) => {
          reports.push(report);
          return { ok: true as const, acknowledgement: acknowledgementFor(report) };
        }
      }
    } as NovelStudioApi);

    await reporter.open(snapshot);
    await expect(reporter.disconnect()).resolves.toEqual({
      status: "connected",
      rendererRevision: 2
    });
    expect(reports.slice(-2)).toMatchObject([
      { connection: "unknown", dirty: false, bufferContent: "" },
      { connection: "unknown", dirty: false, bufferContent: "" }
    ]);
  });
});

function acknowledgementFor(report: EngineeringEditorStateReport) {
  return {
    rootBindingId: report.rootBindingId,
    relativePath: report.relativePath,
    editorInstanceId: report.editorInstanceId,
    rendererRevision: report.rendererRevision
  };
}
