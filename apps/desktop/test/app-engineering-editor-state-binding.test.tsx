// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import type { EngineeringWorkspaceSnapshot } from "@novel-studio/application";

import { useEngineeringEditorStateBinding } from "../src/renderer/App.js";
import type { EngineeringEditorStateBinding } from "../src/renderer/plain-file-editor-bridge.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useEngineeringEditorStateBinding", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  test("uses only Main's qualified opaque binding and refreshes the editor instance on root change", () => {
    let binding: EngineeringEditorStateBinding | undefined;

    function Harness({
      workspace
    }: {
      readonly workspace: EngineeringWorkspaceSnapshot | undefined;
    }) {
      binding = useEngineeringEditorStateBinding(workspace);
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(<Harness workspace={workspace()} />));
    expect(binding).toBeUndefined();

    act(() => root?.render(<Harness workspace={workspace("root-binding-a")} />));
    const first = binding;
    expect(first).toMatchObject({ rootBindingId: "root-binding-a" });
    expect(first?.editorInstanceId).toMatch(/^engineering_file_editor_/u);

    act(() => root?.render(<Harness workspace={workspace("root-binding-a")} />));
    expect(binding).toBe(first);

    act(() => root?.render(<Harness workspace={workspace("root-binding-b")} />));
    expect(binding).toMatchObject({ rootBindingId: "root-binding-b" });
    expect(binding?.editorInstanceId).not.toBe(first?.editorInstanceId);
  });
});

function workspace(rootBindingId?: string): EngineeringWorkspaceSnapshot {
  return {
    workspaceId: "workspace-id-must-not-be-used-as-a-root-binding",
    displayName: "Engineering workspace",
    tree: { nodes: [], truncated: false },
    ...(rootBindingId === undefined ? {} : { rootBindingId })
  } as EngineeringWorkspaceSnapshot;
}
