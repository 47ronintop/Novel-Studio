// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import type { AiWritingWorkflowProps } from "../src/workspace-shell-types.js";
import { WorkspaceShell } from "../src/workspace-shell.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

describe("Diff Review", () => {
  test("replaces the editor and exposes only the three approval commands", () => {
    const host = renderReview();
    const review = host.querySelector<HTMLElement>('[aria-label="变更集差异审阅"]');

    expect(review).not.toBeNull();
    expect(host.querySelector('[aria-label="章节编辑器表面"]')).toBeNull();
    expect(buttonLabels(review)).toEqual(["返回对话", "拒绝全部", "应用所选"]);
    expect(review?.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);

    cleanup(host);
  });

  test("replaces approval commands with run undo after the Change Set is applied", () => {
    const onUndoRun = vi.fn();
    const host = renderReview({
      changeSetStatus: "applied",
      canUndoRun: true,
      onUndoRun
    });
    const review = host.querySelector<HTMLElement>('[aria-label="变更集差异审阅"]');

    expect(buttonLabels(review)).toEqual(["返回对话", "撤销本次运行"]);
    const undo = review?.querySelector<HTMLButtonElement>('button[aria-label="撤销本次运行"]');
    act(() => undo?.click());
    expect(onUndoRun).toHaveBeenCalledTimes(1);

    cleanup(host);
  });

  test("requests an immutable revision using ids and selection state only", () => {
    const selections: unknown[] = [];
    const host = renderReview({ onSelectionChange: (selection) => selections.push(selection) });
    const hunk = host.querySelector<HTMLInputElement>(
      'input[aria-label="包含变更块：第 5 段"]'
    );

    expect(hunk).not.toBeNull();
    act(() => hunk?.click());
    expect(hunk?.checked).toBe(true);
    expect(selections).toEqual([
      {
        files: [
          {
            relativePath: "chapters/ch_03.md",
            selected: false,
            selectedHunkIds: []
          }
        ]
      }
    ]);
    expect(JSON.stringify(selections)).not.toContain("她停在门外");

    cleanup(host);
  });

  test("renders chapter changes as paragraph blocks with word-level highlighting", () => {
    const host = renderReview({
      baseText: "She waits outside the door.",
      candidateText: "She pauses outside the red door."
    });
    const diff = host.querySelector<HTMLElement>('[data-diff-view="paragraph"]');

    expect(diff).not.toBeNull();
    expect(diff?.querySelectorAll('[data-diff-block="paragraph"]')).toHaveLength(2);
    expect(
      diff?.querySelector('del[data-diff-highlight="word"]')?.textContent
    ).toBe("waits");
    expect(
      Array.from(diff?.querySelectorAll('ins[data-diff-highlight="word"]') ?? []).map(
        (element) => element.textContent
      )
    ).toEqual(["pauses", "red"]);

    cleanup(host);
  });

  test("renders ordinary text as line-level diff with intra-line highlighting", () => {
    const host = renderReview({
      assetType: "text",
      relativePath: "notes/outline.txt",
      baseText: "status = draft\nshared line",
      candidateText: "status = ready\nshared line\nnext line"
    });
    const diff = host.querySelector<HTMLElement>('[data-diff-view="lines"]');

    expect(diff).not.toBeNull();
    expect(
      diff?.querySelector('[data-diff-line][data-kind="deletion"]')?.textContent
    ).toContain("status = draft");
    expect(
      diff?.querySelector('[data-diff-line][data-kind="addition"]')?.textContent
    ).toContain("status = ready");
    expect(
      diff?.querySelector('del[data-diff-highlight="inline"]')?.textContent
    ).toBe("draft");
    expect(
      diff?.querySelector('ins[data-diff-highlight="inline"]')?.textContent
    ).toBe("ready");
    expect(
      diff?.querySelectorAll('[data-diff-line][data-kind="context"]')
    ).toHaveLength(1);

    cleanup(host);
  });

  test("uses a bounded fallback for oversized chapter diffs while preserving semantic changes", () => {
    const baseText = Array.from({ length: 512 }, (_, index) => `base-${index}`).join(" ");
    const candidateText = Array.from({ length: 512 }, (_, index) => `candidate-${index}`).join(" ");
    const host = renderReview({ baseText, candidateText });
    const diff = host.querySelector<HTMLElement>('[data-diff-view="paragraph"]');

    expect(diff?.getAttribute("data-diff-fallback")).toBe("bounded");
    expect(diff?.querySelector('del[data-diff-highlight="word"]')?.textContent).toContain("base-0");
    expect(diff?.querySelector('ins[data-diff-highlight="word"]')?.textContent).toContain("candidate-0");

    cleanup(host);
  });

  test("uses a bounded fallback for oversized ordinary text diffs while preserving lines", () => {
    const baseText = Array.from({ length: 512 }, (_, index) => `base line ${index}`).join("\n");
    const candidateText = Array.from({ length: 512 }, (_, index) => `candidate line ${index}`).join("\n");
    const host = renderReview({ assetType: "text", baseText, candidateText });
    const diff = host.querySelector<HTMLElement>('[data-diff-view="lines"]');

    expect(diff?.getAttribute("data-diff-fallback")).toBe("bounded");
    expect(diff?.querySelector('[data-diff-line][data-kind="deletion"]')?.textContent).toContain("base line 0");
    expect(diff?.querySelector('[data-diff-line][data-kind="addition"]')?.textContent).toContain("candidate line 0");
    expect(diff?.querySelector('del[data-diff-highlight="inline"]')?.textContent).toContain("base line 0");
    expect(diff?.querySelector('ins[data-diff-highlight="inline"]')?.textContent).toContain("candidate line 0");

    cleanup(host);
  });

  test("requests file selection through ids without embedding file text", () => {
    const selections: unknown[] = [];
    const host = renderReview({ onSelectionChange: (selection) => selections.push(selection) });
    const file = host.querySelector<HTMLInputElement>('input[aria-label="包含文件：chapters/ch_03.md"]');

    expect(file?.checked).toBe(true);
    act(() => file?.click());
    expect(file?.checked).toBe(true);
    expect(selections).toEqual([
      {
        files: [
          {
            relativePath: "chapters/ch_03.md",
            selected: false,
            selectedHunkIds: []
          }
        ]
      }
    ]);
    expect(JSON.stringify(selections)).not.toContain("她停在门外");

    cleanup(host);
  });

  test("routes reject all through the review callback", () => {
    const onReject = vi.fn();
    const host = renderReview({ onReject });
    const reject = host.querySelector<HTMLButtonElement>('button[aria-label="拒绝全部"]');

    act(() => reject?.click());
    expect(onReject).toHaveBeenCalledTimes(1);

    cleanup(host);
  });

  test.each([
    ["empty selection", { selectFile: false }],
    ["invalid selection", { valid: false }],
    ["base hash conflict", { baseHashConflictPaths: ["chapters/ch_03.md"] }],
    ["stale revision", { stale: true }],
    ["applying transaction", { applying: true }],
    ["dirty target", { dirtyTargetPaths: ["chapters/ch_03.md"] }]
  ])("disables apply for %s", (_label, overrides) => {
    const host = renderReview(overrides);

    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="应用所选"]')?.disabled
    ).toBe(true);

    cleanup(host);
  });
});

interface RenderOverrides {
  readonly assetType?: "chapter" | "text";
  readonly applying?: boolean;
  readonly baseText?: string;
  readonly candidateText?: string;
  readonly stale?: boolean;
  readonly valid?: boolean;
  readonly selectFile?: boolean;
  readonly relativePath?: string;
  readonly baseHashConflictPaths?: readonly string[];
  readonly dirtyTargetPaths?: readonly string[];
  readonly onSelectionChange?: (selection: unknown) => void;
  readonly onReject?: () => void;
  readonly canUndoRun?: boolean;
  readonly onUndoRun?: () => void;
  readonly changeSetStatus?: string;
}

function renderReview(overrides: RenderOverrides = {}): HTMLElement {
  const application = createDesktopApplication();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const selected = overrides.selectFile ?? true;
  const workflow = {
    status: "idle",
    instruction: "",
    onInstructionChange: () => undefined,
    onGenerateSuggestion: () => undefined,
    onApplySuggestion: () => undefined,
    onRetrySuggestion: () => undefined,
    onCancelStreaming: () => undefined,
    agentRun: {
      projectId: "project-01",
      runId: "run-01",
      operationMode: "execution",
      contextMode: "writing",
      status: overrides.applying ? "applying_changes" : "awaiting_write_approval",
      userRequest: "调整第三章",
      assistantText: "候选修改已经准备好。",
      events: [],
      onOperationModeChange: () => undefined,
      onContextModeChange: () => undefined,
      onSend: () => undefined,
      onStop: () => undefined,
      onAnswerUserInput: () => undefined,
      onResume: () => undefined,
      onRetryStep: () => undefined,
      onRefreshContext: () => undefined,
      onDecidePlan: () => undefined,
      changeSetReview: {
        changeSet: {
          changeSetId: "change-set-01",
          revision: 4,
          checksum: "cs-checksum-r4",
          status: overrides.changeSetStatus ?? "pending",
          files: [
            {
              relativePath: overrides.relativePath ?? "chapters/ch_03.md",
              assetType: overrides.assetType ?? "chapter",
              baseChecksum: "base-ch03",
              candidateChecksum: "candidate-ch03",
              selected,
              validation: {
                valid: overrides.valid ?? true,
                issues: overrides.valid === false ? ["章节结构无效"] : []
              },
              hunks: [
                {
                  hunkId: "hunk-ch03-p5",
                  label: "第 5 段",
                  baseText: overrides.baseText ?? "她停在门外。",
                  candidateText:
                    overrides.candidateText ?? "她在门外停住，听见里面压低的争执。",
                  baseRange: { start: 5, end: 5 },
                  candidateRange: { start: 5, end: 5 },
                  selected,
                  additions: 2,
                  deletions: 1
                }
              ]
            }
          ]
        },
        runRevision: 12,
        applying: overrides.applying ?? false,
        stale: overrides.stale ?? false,
        selectionPending: false,
        baseHashConflictPaths: overrides.baseHashConflictPaths ?? [],
        dirtyTargetPaths: overrides.dirtyTargetPaths ?? [],
        onSelectionChange: overrides.onSelectionChange ?? (() => undefined),
        onApply: () => undefined,
        onReject: overrides.onReject ?? (() => undefined),
        onReturn: () => undefined,
        canUndoRun: overrides.canUndoRun ?? false,
        onUndoRun: overrides.onUndoRun ?? (() => undefined)
      }
    }
  } as unknown as AiWritingWorkflowProps;

  act(() => {
    root.render(
      <WorkspaceShell
        aiWritingWorkflow={workflow}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={application.getShellState()}
      />
    );
  });
  Reflect.set(host, "__root", root);
  return host;
}

function cleanup(host: HTMLElement): void {
  const root = Reflect.get(host, "__root") as ReturnType<typeof createRoot>;
  act(() => root.unmount());
  host.remove();
}

function buttonLabels(root: HTMLElement | null): string[] {
  return Array.from(root?.querySelectorAll("button") ?? []).map(
    (button) => button.getAttribute("aria-label") ?? ""
  );
}

const chapterEditor = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_03",
      type: "chapter",
      title: "第三章",
      order: 3,
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z"
    },
    body: "她停在门外。"
  },
  dirty: false,
  saveStatus: "Saved",
  versionHistory: []
} as const;
