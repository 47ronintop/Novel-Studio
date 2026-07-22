// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { WorkbenchSwitcher } from "../src/workbench-switcher.js";

describe("WorkbenchSwitcher", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("opens an accessible radio menu and returns focus after Escape", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(<WorkbenchSwitcher mode="creative" onSelect={onSelect} />);
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="当前工作台：创作工作台"]'
    );
    expect(trigger).not.toBeNull();
    expect(host.querySelector('.ns-workbench-switcher[data-mode="creative"]')).not.toBeNull();
    expect(trigger?.querySelector(".ns-workbench-mode-icon")).not.toBeNull();
    act(() => trigger?.click());

    expect(
      host.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent
    ).toContain("创作工作台");
    expect(host.querySelector('[role="menuitemradio"]')).not.toBeNull();

    const engineering = host.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-label="工程工作台"]'
    );
    act(() =>
      engineering?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    );

    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("supports Arrow/Home/End and exposes a disabled creative reason", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <WorkbenchSwitcher
          mode="engineering"
          creativeDisabledReason="当前工作区不是创作项目。"
          onSelect={onSelect}
        />
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="当前工作台：工程工作台"]'
    );
    act(() => trigger?.click());

    const creative = host.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-label="创作工作台"]'
    );
    const engineering = host.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-label="工程工作台"]'
    );
    expect(creative?.getAttribute("aria-disabled")).toBe("true");
    expect(engineering?.getAttribute("data-selected")).toBe("true");
    expect(engineering?.querySelector(".ns-workbench-menu-check")).not.toBeNull();
    expect(creative?.getAttribute("aria-describedby")).toBeTruthy();
    expect(host.textContent).toContain("当前工作区不是创作项目。");

    act(() =>
      engineering?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    );
    expect(document.activeElement).toBe(engineering);
    act(() =>
      engineering?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    );
    expect(document.activeElement).toBe(engineering);
    act(() =>
      engineering?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    );
    expect(document.activeElement).toBe(engineering);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
