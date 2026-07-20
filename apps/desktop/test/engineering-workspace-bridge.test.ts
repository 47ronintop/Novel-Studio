import { describe, expect, test } from "vitest";

import type { NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createEngineeringWorkspaceBridge } from "../src/renderer/engineering-workspace-bridge.js";

describe("engineering workspace bridge", () => {
  test("opens from an opaque selection and stores only the renderer-safe snapshot", async () => {
    const calls: unknown[] = [];
    const api = createApi(calls);
    const bridge = createEngineeringWorkspaceBridge(api);

    const opened = await bridge.openEngineeringWorkspace();

    expect(opened).toMatchObject({
      status: "ready",
      workspace: {
        workspaceId: "ws_source",
        displayName: "Source",
        tree: { nodes: [{ path: "README.md" }], truncated: false }
      }
    });
    expect(JSON.stringify(opened)).not.toContain("selectionId");
    expect(JSON.stringify(opened)).not.toContain("contentRoot");
    expect(JSON.stringify(opened)).not.toContain("stateRoot");
    expect(calls).toEqual([["choose"], ["open", "selection_engineering"]]);
  });

  test("refreshes the active tree through the workspace API", async () => {
    const calls: unknown[] = [];
    const bridge = createEngineeringWorkspaceBridge(createApi(calls));
    await bridge.openEngineeringWorkspace();

    const refreshed = await bridge.refreshEngineeringTree();

    expect(refreshed.workspace?.tree.nodes).toEqual([
      { id: "file:src.ts", name: "src.ts", kind: "file", path: "src.ts" }
    ]);
    expect(calls.at(-1)).toEqual(["refresh"]);
  });

  test("attaches the active creative project without sending a project root to the renderer", async () => {
    const calls: unknown[] = [];
    const bridge = createEngineeringWorkspaceBridge(createApi(calls));

    const attached = await bridge.attachCreativeProject();

    expect(attached).toMatchObject({
      status: "ready",
      workspace: {
        workspaceId: "prj_creative",
        tree: { nodes: [{ readOnlyReason: expect.any(String) }] }
      }
    });
    expect(JSON.stringify(attached)).not.toContain("projectRoot");
    expect(calls).toContainEqual(["attach"]);
  });
});

function createApi(calls: unknown[]): NovelStudioApi {
  return {
    workspace: {
      async chooseEngineeringDirectory() {
        calls.push(["choose"]);
        return ok({
          canceled: false,
          selectionId: "selection_engineering",
          displayName: "Source"
        });
      },
      async openEngineeringWorkspace(selectionId) {
        calls.push(["open", selectionId]);
        return ok({
          context: {
            kind: "engineeringWorkspace" as const,
            workspaceId: "ws_source",
            displayName: "Source",
            capabilities: ["engineeringWorkbench", "generalFileContext"] as const
          },
          engineeringWorkspace: {
            workspaceId: "ws_source",
            displayName: "Source",
            tree: {
              nodes: [
                { id: "file:README.md", name: "README.md", kind: "file" as const, path: "README.md" }
              ],
              truncated: false
            }
          }
        });
      },
      async refreshEngineeringTree() {
        calls.push(["refresh"]);
        return ok({
          workspaceId: "ws_source",
          displayName: "Source",
          tree: {
            nodes: [{ id: "file:src.ts", name: "src.ts", kind: "file" as const, path: "src.ts" }],
            truncated: false
          }
        });
      },
      async attachActiveCreativeProjectEngineeringWorkspace() {
        calls.push(["attach"]);
        return ok({
          workspaceId: "prj_creative",
          displayName: "Creative",
          tree: {
            nodes: [
              {
                id: "file:project.json",
                name: "project.json",
                kind: "file" as const,
                path: "project.json",
                readOnlyReason: "managed"
              }
            ],
            truncated: false
          }
        });
      },
      async readTextFile() {
        throw new Error("not used");
      },
      async saveTextFile() {
        throw new Error("not used");
      }
    }
  } as unknown as NovelStudioApi;
}
