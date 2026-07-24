/**
 * Task D.1 — MCP settings session tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createMcpSettingsSession,
  DEFAULT_MCP_SETTINGS,
  type McpServerConfig,
  type McpSettingsData,
  type McpSettingsPort
} from "../src/mcp-settings-session.js";
import { ok } from "@novel-studio/shared";

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
