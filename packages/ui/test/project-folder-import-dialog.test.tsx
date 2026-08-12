// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ProjectFolderImportDialog } from "../src/project-folder-import-dialog.js";

describe("ProjectFolderImportDialog", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  test("renders candidates and reports checkbox selection by relative path", () => {
    const onCandidateToggle = vi.fn();
    ({ root, container } = renderDialog({ onCandidateToggle }));

    expect(container.textContent).toContain("源文件夹不会被修改");
    expect(container.textContent).toContain("创建项目并导入 2 章");

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    act(() => {
      checkboxes[1]?.click();
    });

    expect(onCandidateToggle).toHaveBeenCalledWith("02.txt", false);
  });

  test("disables confirmation when every candidate is unselected", () => {
    ({ root, container } = renderDialog({
      candidates: [
        {
          relativePath: "01.md",
          sizeBytes: 12,
          defaultTitle: "01",
          selected: false
        }
      ]
    }));

    expect(container.querySelector<HTMLButtonElement>(".ns-ai-send-button")?.disabled).toBe(true);
  });
});

function renderDialog(overrides: Partial<Parameters<typeof ProjectFolderImportDialog>[0]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ProjectFolderImportDialog
        open
        sourceDisplayName="Draft"
        targetDisplayName="Draft - ShanHai"
        candidates={[
          { relativePath: "01.md", sizeBytes: 12, defaultTitle: "01", selected: true },
          { relativePath: "02.txt", sizeBytes: 24, defaultTitle: "02", selected: true }
        ]}
        busy={false}
        onCandidateToggle={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
        {...overrides}
      />
    );
  });
  return { root, container };
}
