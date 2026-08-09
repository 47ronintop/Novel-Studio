// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ProjectCreateDialog } from "../src/project-create-dialog.js";
import type { ProjectCreateDialogProps } from "../src/project-create-dialog.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectCreateDialog", () => {
  afterEach(() => document.body.replaceChildren());

  test("renders nothing when closed", () => {
    const { host } = renderDialog({ open: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  test("owns title, folder name, and parent-directory selection controls", () => {
    const { host } = renderDialog();

    expect(host.querySelector('[role="dialog"][aria-label="新建创作项目"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="项目标题"]')?.value).toBe(
      "长安旧梦"
    );
    expect(host.querySelector<HTMLInputElement>('input[aria-label="项目文件夹名称"]')?.value).toBe(
      "长安旧梦"
    );
    expect(host.querySelector('button[aria-label="选择项目父文件夹"]')).not.toBeNull();
  });

  test("focuses the title input on open and returns focus to the trigger on Escape", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();

    const { host } = renderDialog({ onCancel });
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="项目标题"]'));

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("propagates title and folder name edits and requests parent directory selection", () => {
    const onTitleChange = vi.fn();
    const onFolderNameChange = vi.fn();
    const onChooseParentDirectory = vi.fn();
    const { host } = renderDialog({ onTitleChange, onFolderNameChange, onChooseParentDirectory });

    const titleInput = host.querySelector<HTMLInputElement>('input[aria-label="项目标题"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(titleInput, "长安旧梦：终章");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onTitleChange).toHaveBeenCalledWith("长安旧梦：终章");

    const folderInput = host.querySelector<HTMLInputElement>('input[aria-label="项目文件夹名称"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(folderInput, "长安旧梦-终章");
      folderInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onFolderNameChange).toHaveBeenCalledWith("长安旧梦-终章");

    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="选择项目父文件夹"]')?.click()
    );
    expect(onChooseParentDirectory).toHaveBeenCalledTimes(1);
  });

  test("shows only the relative creation preview, never an absolute path", () => {
    const { host } = renderDialog({
      creationPreview: {
        folderName: "长安旧梦",
        parentDisplayName: "文档",
        targetDisplayName: "文档 / 长安旧梦"
      }
    });

    expect(host.querySelector('[aria-label="项目创建位置"]')?.textContent).toContain(
      "文档 / 长安旧梦"
    );
    expect(host.textContent).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
  });

  test("disables create while busy and surfaces failure feedback", () => {
    const onCreate = vi.fn();
    const { host, rerender } = renderDialog({
      busy: true,
      feedback: { kind: "error", message: "文件夹名称不能包含非法字符。" },
      onCreate
    });

    expect(host.querySelector<HTMLButtonElement>('button[aria-label="创建项目"]')?.disabled).toBe(
      true
    );
    expect(host.textContent).toContain("文件夹名称不能包含非法字符。");

    rerender({ busy: false });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="创建项目"]')?.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("calls onCancel from the cancel button", () => {
    const onCancel = vi.fn();
    const { host } = renderDialog({ onCancel });

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="取消创建项目"]')?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("positions the form as a bounded responsive modal overlay", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    expect(css).toMatch(
      /\.ns-project-create-dialog\s*\{[^}]*display:\s*grid[^}]*inset:\s*0[^}]*overflow:\s*auto[^}]*position:\s*fixed[^}]*z-index:\s*130/s
    );
    expect(css).toMatch(
      /\.ns-project-create-dialog-backdrop\s*\{[^}]*inset:\s*0[^}]*position:\s*absolute/s
    );
    expect(css).toMatch(
      /\.ns-project-create-dialog-content\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*48px\)[^}]*overflow:\s*auto[^}]*position:\s*relative[^}]*width:\s*min\(520px,\s*calc\(100vw\s*-\s*48px\)\)/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.ns-project-create-dialog-content\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*24px\)[^}]*width:\s*100%/s
    );
    expect(css).toMatch(
      /\.ns-project-create-dialog-form input\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%/s
    );
  });
});

function renderDialog(overrides: Partial<ProjectCreateDialogProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;

  const render = (next: Partial<ProjectCreateDialogProps> = {}) => {
    const props: ProjectCreateDialogProps = {
      open: true,
      titleInput: "长安旧梦",
      folderNameInput: "长安旧梦",
      busy: false,
      onTitleChange: () => undefined,
      onFolderNameChange: () => undefined,
      onChooseParentDirectory: () => undefined,
      onCancel: () => undefined,
      onCreate: () => undefined,
      ...overrides,
      ...next
    };
    act(() => {
      root ??= createRoot(host);
      root.render(<ProjectCreateDialog {...props} />);
    });
  };

  render();
  return { host, rerender: render };
}
