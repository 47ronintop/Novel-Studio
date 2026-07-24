/**
 * Task D.1 + E.2 — MCP settings session tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createMcpSettingsSession,
  DEFAULT_MCP_SETTINGS,
  type LocalMcpSettingsPort,
  type McpServerConfig,
  type McpSettingsData,
  type McpSettingsPort
} from "../src/mcp-settings-session.js";
import { ok, err, createUnifiedError } from "@novel-studio/shared";

function makePort(initial: McpSettingsData = DEFAULT_MCP_SETTINGS): McpSettingsPort {
  let stored = initial;
  return {
    readMcpSettings: vi.fn(() => Promise.resolve(ok(stored))),
    writeMcpSettings: vi.fn((settings) => {
      stored = settings;
      return Promise.resolve(ok(settings));
    })
  };
}

const sampleServer: McpServerConfig = {
  serverId: "mcp-test-1",
  displayName: "Test MCP Server",
  transport: "remote_http",
  endpointUrl: "https://mcp.example.com/rpc",
  apiKeyRef: "secret://mcp-key",
  enabled: true
};

describe("createMcpSettingsSession", () => {
  it("returns empty server list by default", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    const result = await session.listServers();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("addServer stores new server", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    await session.addServer(sampleServer);
    const result = await session.listServers();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.serverId).toBe("mcp-test-1");
    }
  });

  it("addServer updates existing server by ID", async () => {
    const port = makePort({ servers: [sampleServer], revision: "v1" });
    const session = createMcpSettingsSession({ port });
    await session.addServer({ ...sampleServer, displayName: "Updated" });
    const result = await session.listServers();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.displayName).toBe("Updated");
    }
  });

  it("removeServer removes by ID", async () => {
    const port = makePort({ servers: [sampleServer], revision: "v1" });
    const session = createMcpSettingsSession({ port });
    await session.removeServer("mcp-test-1");
    const result = await session.listServers();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("testConnection returns error when server not found", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    const result = await session.testConnection("non-existent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MCP_SERVER_NOT_FOUND");
  });

  it("testConnection calls testRemoteConnection when server exists", async () => {
    const port = makePort({ servers: [sampleServer], revision: "v1" });
    const testRemoteConnection = vi.fn().mockResolvedValue(ok({ latencyMs: 42 }));
    const session = createMcpSettingsSession({ port, testRemoteConnection });
    const result = await session.testConnection("mcp-test-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.latencyMs).toBe(42);
    expect(testRemoteConnection).toHaveBeenCalledWith(sampleServer);
  });

  it("revokeServer disables server without removing it", async () => {
    const port = makePort({ servers: [sampleServer], revision: "v1" });
    const session = createMcpSettingsSession({ port });
    await session.revokeServer("mcp-test-1");
    const result = await session.listServers();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.enabled).toBe(false);
    }
  });

  it("getMcpSettings returns full settings", async () => {
    const port = makePort({ servers: [sampleServer], revision: "v1.0-custom" });
    const session = createMcpSettingsSession({ port });
    const result = await session.getMcpSettings();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revision).toBe("v1.0-custom");
      expect(result.value.servers).toHaveLength(1);
    }
  });
});

// ── Task E.2 — local_stdio ──────────────────────────────────────────────────

const sampleLocalServer: McpServerConfig = {
  serverId: "local-test-1",
  displayName: "Test Local MCP Server",
  transport: "local_stdio",
  enabled: true
};

function makeLocalPort(initial: readonly McpServerConfig[] = []): LocalMcpSettingsPort {
  let stored = initial;
  return {
    listLocalServers: vi.fn(() => Promise.resolve(ok(stored))),
    setLocalServerEnabled: vi.fn((serverId: string, enabled: boolean) => {
      stored = stored.map((s) => (s.serverId === serverId ? { ...s, enabled } : s));
      return Promise.resolve(ok(stored));
    })
  };
}

describe("createMcpSettingsSession — local_stdio", () => {
  it("listLocalServers returns MCP_LOCAL_UNAVAILABLE when no localPort is configured", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    const result = await session.listLocalServers();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MCP_LOCAL_UNAVAILABLE");
  });

  it("setLocalServerEnabled returns MCP_LOCAL_UNAVAILABLE when no localPort is configured", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    const result = await session.setLocalServerEnabled("local-test-1", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MCP_LOCAL_UNAVAILABLE");
  });

  it("revokeLocalServer returns MCP_LOCAL_UNAVAILABLE when no localPort is configured", async () => {
    const port = makePort();
    const session = createMcpSettingsSession({ port });
    const result = await session.revokeLocalServer("local-test-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MCP_LOCAL_UNAVAILABLE");
  });

  it("listLocalServers delegates to the injected localPort", async () => {
    const port = makePort();
    const localPort = makeLocalPort([sampleLocalServer]);
    const session = createMcpSettingsSession({ port, localPort });
    const result = await session.listLocalServers();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.serverId).toBe("local-test-1");
      expect(result.value[0]?.transport).toBe("local_stdio");
    }
    expect(localPort.listLocalServers).toHaveBeenCalled();
  });

  it("setLocalServerEnabled delegates to the injected localPort", async () => {
    const port = makePort();
    const localPort = makeLocalPort([sampleLocalServer]);
    const session = createMcpSettingsSession({ port, localPort });
    const result = await session.setLocalServerEnabled("local-test-1", false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.enabled).toBe(false);
    expect(localPort.setLocalServerEnabled).toHaveBeenCalledWith("local-test-1", false);
  });

  it("revokeLocalServer disables the server without removing it", async () => {
    const port = makePort();
    const localPort = makeLocalPort([sampleLocalServer]);
    const session = createMcpSettingsSession({ port, localPort });
    const result = await session.revokeLocalServer("local-test-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.enabled).toBe(false);
    }
    expect(localPort.setLocalServerEnabled).toHaveBeenCalledWith("local-test-1", false);
  });

  it("listLocalServers propagates errors from the localPort", async () => {
    const port = makePort();
    const localPort: LocalMcpSettingsPort = {
      listLocalServers: vi.fn(() =>
        Promise.resolve(
          err(
            createUnifiedError({
              code: "MCP_LOCAL_SETTINGS_READ_FAILED",
              category: "StorageError",
              message: "boom",
              recoverability: "user-action",
              suggestedAction: "retry",
              traceId: "test"
            })
          )
        )
      ),
      setLocalServerEnabled: vi.fn(() => Promise.resolve(ok([])))
    };
    const session = createMcpSettingsSession({ port, localPort });
    const result = await session.listLocalServers();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MCP_LOCAL_SETTINGS_READ_FAILED");
  });
});
