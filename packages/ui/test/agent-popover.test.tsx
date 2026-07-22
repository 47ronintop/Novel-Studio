// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import { AgentPopover, rovePopoverOptions } from "../src/agent-popover.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentPopover", () => {
  afterEach(() => document.body.replaceChildren());

  test("toggles a dialog panel and reflects open state on the trigger", () => {
    const { host } = render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="打开"]');
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel?.getAttribute("aria-label")).toBe("面板");
    expect(trigger?.getAttribute("aria-controls")).toBe(panel?.id);
    expect(panel?.parentElement?.classList).toContain("ns-agent-popover-layer");

    act(() => trigger?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("opens with Enter/Space and focuses the first control by default", () => {
    const { host } = render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="打开"]');
    act(() =>
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    );
    expect(document.activeElement).toBe(document.querySelector('[data-option="a"]'));
  });

  test("focuses the initialFocus ref when provided", () => {
    const { host } = render({ initialFocus: "second" });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="打开"]');
    act(() => trigger?.click());
    expect(document.activeElement).toBe(document.querySelector('[data-option="b"]'));
  });

  test("closes on Escape and returns focus to the trigger", () => {
    const { host } = render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="打开"]');
    act(() => trigger?.click());
    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    act(() => panel?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("closes when disabled becomes true", () => {
    const { host, rerender } = render();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开"]')?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    rerender({ disabled: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="打开"]')?.disabled).toBe(true);
  });

  test("does not open while disabled", () => {
    const { host } = render({ disabled: true });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开"]')?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("rovePopoverOptions wraps arrow focus across sibling buttons", () => {
    const { host } = render();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开"]')?.click());
    const first = document.querySelector<HTMLButtonElement>('[data-option="a"]');
    act(() =>
      first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(document.activeElement).toBe(document.querySelector('[data-option="b"]'));
    const second = document.querySelector<HTMLButtonElement>('[data-option="b"]');
    act(() =>
      second?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(document.activeElement).toBe(first);
  });
});

interface HarnessOverrides {
  readonly disabled?: boolean;
  readonly initialFocus?: "first" | "second";
}

function Harness(props: HarnessOverrides) {
  const secondRef = useRef<HTMLButtonElement>(null);
  return (
    <AgentPopover
      disabled={props.disabled ?? false}
      initialFocus={props.initialFocus === "second" ? secondRef : "first"}
      panelLabel="面板"
      triggerContent="打开"
      triggerLabel="打开"
    >
      {({ close }) => (
        <>
          <div role="group">
            <button data-option="a" onKeyDown={rovePopoverOptions} type="button">
              A
            </button>
            <button data-option="b" onKeyDown={rovePopoverOptions} ref={secondRef} type="button">
              B
            </button>
          </div>
          <button data-option="close" onClick={close} type="button">
            关闭
          </button>
        </>
      )}
    </AgentPopover>
  );
}

function render(overrides: HarnessOverrides = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;
  const rerender = (next: HarnessOverrides = {}) => {
    act(() => {
      root ??= createRoot(host);
      root.render(<Harness {...overrides} {...next} />);
    });
  };
  rerender();
  return { host, rerender };
}
