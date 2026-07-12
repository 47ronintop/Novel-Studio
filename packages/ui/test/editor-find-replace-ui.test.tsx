// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EditorFindReplace } from "../src/editor-find-replace.js";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorFindReplace UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  test("renders replacement controls and closes through its button", async () => {
    const bodies: string[] = [];
    const modes: string[] = [];
    const focusCalls: string[] = [];

    await act(async () => {
      root.render(
        <EditorFindReplace
          body="Moon over moon."
          mode="replace"
          onBodyChange={(body) => bodies.push(body)}
          onModeChange={(mode) => modes.push(mode)}
          onRequestEditorFocus={() => focusCalls.push("focus")}
          onSelectionChange={() => undefined}
        />
      );
    });

    expect(container.querySelector('[aria-label="查找内容"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="替换为"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="全部替换"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="关闭查找替换"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(bodies).toEqual([]);
    expect(modes).toEqual(["closed"]);
    expect(focusCalls).toEqual(["focus"]);
  });

  test("closes on Escape and restores editor focus", async () => {
    const modes: string[] = [];
    const focusCalls: string[] = [];

    await act(async () => {
      root.render(
        <EditorFindReplace
          body="Moon over moon."
          mode="find"
          onModeChange={(mode) => modes.push(mode)}
          onRequestEditorFocus={() => focusCalls.push("focus")}
        />
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="查找替换"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(modes).toEqual(["closed"]);
    expect(focusCalls).toEqual(["focus"]);
  });

  test("clamps the active match when the result set shrinks", async () => {
    const bodies: string[] = [];

    await act(async () => {
      root.render(
        <EditorFindReplace
          body="one one one"
          mode="replace"
          onBodyChange={(body) => bodies.push(body)}
        />
      );
    });

    const query = container.querySelector<HTMLInputElement>('[aria-label="查找内容"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(query, "one");
      query?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const next = container.querySelector<HTMLButtonElement>('[aria-label="下一处"]');
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      const next = container.querySelector<HTMLButtonElement>('[aria-label="下一处"]');
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="查找结果数量"]')?.textContent).toBe("3/3");

    await act(async () => {
      root.render(
        <EditorFindReplace
          body="one one"
          mode="replace"
          onBodyChange={(body) => bodies.push(body)}
        />
      );
    });

    expect(container.querySelector('[aria-label="查找结果数量"]')?.textContent).toBe("2/2");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="替换当前"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bodies).toEqual(["one "]);
  });
});
