// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import type { DesktopShellState, UserPreferencesSaveInput } from "@novel-studio/application";
import { rendererShellState } from "../src/renderer/app-shell-support.js";
import { useShellPreferenceActions } from "../src/renderer/shell-preference-actions.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useShellPreferenceActions", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  test("updates and persists creative mode and legacy engineering expansion preferences", () => {
    let shellState: DesktopShellState = rendererShellState;
    const saved: UserPreferencesSaveInput[] = [];
    let actions: ReturnType<typeof useShellPreferenceActions> | undefined;

    function Harness() {
      actions = useShellPreferenceActions(
        (next) => {
          shellState = typeof next === "function" ? next(shellState) : next;
        },
        (input) => saved.push(input)
      );
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    act(() => actions?.handleCreativeNavigatorModeSelect("story"));
    act(() => actions?.handleNavigatorExpandedSectionIdsChange(["files", "src"]));

    expect(shellState.creativeNavigatorMode).toBe("story");
    expect(shellState.navigatorExpandedSectionIds).toEqual(["files", "src"]);
    expect(saved).toHaveLength(2);
    expect(saved[0]?.shell?.creativeNavigatorMode).toBe("story");
    expect(saved[1]?.shell?.navigatorExpandedSectionIds).toEqual(["files", "src"]);
    expect(saved[0]?.shell).not.toHaveProperty("workspaceContext");
  });
});
