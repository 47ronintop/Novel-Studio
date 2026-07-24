/**
 * Task E.1 — authorizePluginToolCall covers every hard-deny branch plus the allowed path.
 * Pure/I-O free: no PluginSandboxPort is invoked here.
 */
import { describe, expect, test } from "vitest";

import {
  authorizePluginToolCall,
  type AuthorizePluginToolCallInput,
  type PluginSandboxToolManifestLike,
  type PluginSandboxToolRegistryEntryLike
} from "../src/plugin-sandbox-port.js";

const validManifest: PluginSandboxToolManifestLike = {
  capabilities: [{ type: "tool", id: "tool-plugin.summarise", title: "Summarise" }],
  requestedPermissions: [{ permission: "tool:invoke", scopes: ["project"] }],
  contributes: {
    tools: [
      {
        id: "tool-plugin.summarise",
        title: "Summarise",
        description: "Summarises the active chapter.",
        inputSchema: { type: "object", additionalProperties: false }
      }
    ]
  }
};

const grantedEntry: PluginSandboxToolRegistryEntryLike = {
  enabled: true,
  grantedPermissions: [{ permission: "tool:invoke", scopes: ["project"] }]
};

function baseInput(
  overrides: Partial<AuthorizePluginToolCallInput> = {}
): AuthorizePluginToolCallInput {
  return {
    pluginId: "novel.tool-plugin",
    toolId: "tool-plugin.summarise",
    entry: grantedEntry,
    manifest: validManifest,
    manifestStatus: "valid",
    trustState: "trusted-local",
    sandboxProfileVerified: true,
    ...overrides
  };
}

describe("authorizePluginToolCall", () => {
  test("allows a fully authorized tool call", () => {
    const result = authorizePluginToolCall(baseInput());

    expect(result).toEqual({ ok: true, value: true });
  });

  test("denies when the plugin is disabled", () => {
    const result = authorizePluginToolCall(
      baseInput({ entry: { ...grantedEntry, enabled: false } })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_DISABLED", category: "PluginError" }
    });
  });

  test("denies when the manifest is missing", () => {
    const result = authorizePluginToolCall(
      baseInput({ manifest: undefined, manifestStatus: "missing" })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_MANIFEST_INVALID", category: "PluginError" }
    });
  });

  test("denies when the manifest is invalid", () => {
    const result = authorizePluginToolCall(baseInput({ manifestStatus: "invalid" }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_MANIFEST_INVALID", category: "PluginError" }
    });
  });

  test("denies when the tool id is not declared in contributes.tools", () => {
    const result = authorizePluginToolCall(
      baseInput({
        manifest: {
          ...validManifest,
          contributes: { tools: [] }
        }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_NOT_DECLARED", category: "PluginError" }
    });
  });

  test("denies when contributes.tools is absent entirely (pre-Task-E.1 manifest)", () => {
    const result = authorizePluginToolCall(
      baseInput({
        manifest: {
          ...validManifest,
          contributes: {}
        }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_NOT_DECLARED", category: "PluginError" }
    });
  });

  test("denies when no matching tool capability is declared", () => {
    const result = authorizePluginToolCall(
      baseInput({
        manifest: {
          ...validManifest,
          capabilities: []
        }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_CAPABILITY_MISSING", category: "PluginError" }
    });
  });

  test("denies when tool:invoke is missing from the manifest's requested permissions", () => {
    const result = authorizePluginToolCall(
      baseInput({
        manifest: {
          ...validManifest,
          requestedPermissions: []
        }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_PERMISSION_DENIED", category: "PluginError" }
    });
  });

  test("denies when tool:invoke is missing from the entry's granted permissions", () => {
    const result = authorizePluginToolCall(
      baseInput({
        entry: { ...grantedEntry, grantedPermissions: [] }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_PERMISSION_DENIED", category: "PluginError" }
    });
  });

  test("denies when granted permission scope does not include project", () => {
    const result = authorizePluginToolCall(
      baseInput({
        entry: {
          ...grantedEntry,
          grantedPermissions: [{ permission: "tool:invoke", scopes: ["characters"] }]
        }
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_PERMISSION_DENIED", category: "PluginError" }
    });
  });

  test("denies when trust state is untrusted", () => {
    const result = authorizePluginToolCall(baseInput({ trustState: "untrusted" }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_UNTRUSTED", category: "PluginError" }
    });
  });

  test("denies when the sandbox profile attestation is not verified", () => {
    const result = authorizePluginToolCall(baseInput({ sandboxProfileVerified: false }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_SANDBOX_TOOL_PROFILE_UNVERIFIED", category: "PluginError" }
    });
  });

  test("redacts pluginId and toolId in denial details without leaking arguments", () => {
    const result = authorizePluginToolCall(baseInput({ trustState: "untrusted" }));

    expect(result).toMatchObject({
      ok: false,
      error: {
        redactedDetail: {
          pluginId: "novel.tool-plugin",
          toolId: "tool-plugin.summarise"
        }
      }
    });
  });
});
