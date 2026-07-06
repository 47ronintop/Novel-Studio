import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";

import {
  createPluginRuntimeSession,
  type PluginRuntimeAdapter
} from "../src/plugin-runtime-session.js";
import type { PluginSettingsSnapshot } from "../src/plugin-settings-session.js";

const enabledSnapshot: PluginSettingsSnapshot = {
  schemaVersion: "1.0",
  plugins: [
    {
      pluginId: "novel.structure-tools",
      enabled: true,
      manifestPath: "plugins/novel.structure-tools/plugin.json",
      grantedPermissions: [
        { permission: "project:read", scopes: ["project"] },
        { permission: "workflow:invoke", scopes: ["project"] }
      ],
      manifestStatus: "valid",
      manifest: {
        displayName: "Structure Tools",
        version: "1.0.0",
        entryKind: "none",
        compatibleAppVersion: { min: "0.1.0" },
        capabilities: [
          { type: "command", id: "outline.audit", title: "Audit Outline" },
          { type: "workflow-step", id: "outline.score", title: "Score Outline" }
        ],
        requestedPermissions: [
          { permission: "project:read", scopes: ["project"] },
          { permission: "workflow:invoke", scopes: ["project"] }
        ],
        contributes: {
          commands: [{ id: "outline.audit", title: "Audit Outline" }],
          workflowSteps: [{ id: "outline.score", title: "Score Outline" }]
        }
      }
    }
  ]
};
const enabledPlugin = enabledSnapshot.plugins[0];
if (enabledPlugin === undefined) {
  throw new Error("Plugin runtime fixture must include a plugin.");
}

describe("PluginRuntimeSession", () => {
  test("lists enabled host command contributions as Application commands", () => {
    const session = createPluginRuntimeSession({
      snapshot: enabledSnapshot,
      adapter: fixtureAdapter()
    });

    expect(session.listCommands()).toEqual([
      {
        id: "plugin:novel.structure-tools:outline.audit",
        title: "Audit Outline",
        scope: "plugin",
        riskLevel: "safe",
        defaultShortcut: "",
        source: {
          kind: "plugin",
          pluginId: "novel.structure-tools",
          contributionId: "outline.audit"
        }
      }
    ]);
  });

  test("keeps disabled command contributions visible with disabled reasons", () => {
    const session = createPluginRuntimeSession({
      snapshot: {
        ...enabledSnapshot,
        plugins: [
          {
            ...enabledPlugin,
            enabled: false
          },
          {
            ...enabledPlugin,
            pluginId: "novel.no-grant",
            grantedPermissions: []
          }
        ]
      },
      adapter: fixtureAdapter()
    });

    expect(session.listCommands().map((command) => command.disabledReason)).toEqual([
      "Plugin is disabled.",
      "Plugin is missing project:read permission for project scope."
    ]);
  });

  test("executes a host command through the injected adapter after policy validation", () => {
    const calls: string[] = [];
    const session = createPluginRuntimeSession({
      snapshot: enabledSnapshot,
      adapter: fixtureAdapter(calls)
    });

    const result = session.executeCommand({
      commandId: "plugin:novel.structure-tools:outline.audit",
      traceId: "trace_plugin_command"
    });

    expect(result).toEqual(
      ok({
        output: { accepted: true, commandId: "outline.audit" }
      })
    );
    expect(calls).toEqual(["command:novel.structure-tools:outline.audit"]);
  });

  test("rejects command execution when the contribution is disabled", () => {
    const session = createPluginRuntimeSession({
      snapshot: {
        ...enabledSnapshot,
        plugins: [{ ...enabledPlugin, enabled: false }]
      },
      adapter: fixtureAdapter()
    });

    const result = session.executeCommand({
      commandId: "plugin:novel.structure-tools:outline.audit",
      traceId: "trace_plugin_disabled"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_RUNTIME_PERMISSION_DENIED",
        category: "PluginError"
      }
    });
  });

  test("runs workflow-step contributions through the injected adapter", () => {
    const calls: string[] = [];
    const session = createPluginRuntimeSession({
      snapshot: enabledSnapshot,
      adapter: fixtureAdapter(calls)
    });

    const result = session.runWorkflowStep({
      pluginId: "novel.structure-tools",
      contributionId: "outline.score",
      input: { chapterId: "ch_01" },
      traceId: "trace_plugin_workflow"
    });

    expect(result).toEqual(
      ok({
        output: {
          accepted: true,
          contributionId: "outline.score",
          input: { chapterId: "ch_01" }
        }
      })
    );
    expect(calls).toEqual(["workflow:novel.structure-tools:outline.score"]);
  });

  test("rejects malformed adapter workflow output", () => {
    const session = createPluginRuntimeSession({
      snapshot: enabledSnapshot,
      adapter: {
        executeHostCommand: () => ok({ output: {} }),
        executeWorkflowStep: () => ok({ output: "not-structured" })
      }
    });

    const result = session.runWorkflowStep({
      pluginId: "novel.structure-tools",
      contributionId: "outline.score",
      input: {},
      traceId: "trace_plugin_invalid_output"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_RUNTIME_INVALID_OUTPUT",
        category: "PluginError"
      }
    });
  });
});

function fixtureAdapter(calls: string[] = []): PluginRuntimeAdapter {
  return {
    executeHostCommand(input) {
      calls.push(`command:${input.pluginId}:${input.contributionId}`);
      return ok({ output: { accepted: true, commandId: input.contributionId } });
    },
    executeWorkflowStep(input) {
      calls.push(`workflow:${input.pluginId}:${input.contributionId}`);
      return ok({
        output: {
          accepted: true,
          contributionId: input.contributionId,
          input: input.input
        }
      });
    }
  };
}
