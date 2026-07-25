/**
 * Task E.2 — Local stdio MCP settings repository tests.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  McpSettingsFileRepository,
  type LocalMcpServerLaunchConfig
} from "../src/mcp-settings-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const sampleServer: LocalMcpServerLaunchConfig = {
  serverId: "local-test-1",
  displayName: "Test Local MCP Server",
  command: "node",
  argv: ["server.js", "--port", "3000"],
  cwd: "workspace/tools",
  envAllowlist: ["PATH", "HOME"],
  enabled: true
};

describe("McpSettingsFileRepository", () => {
  test("returns empty array when the file does not exist", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const result = await repository.readLocalServers();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  test("writes and reads local servers with full launch config", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const written = await repository.writeLocalServers([sampleServer]);
    const readBack = await repository.readLocalServers();

    expect(written.ok).toBe(true);
    expect(readBack.ok).toBe(true);
    if (readBack.ok) {
      expect(readBack.value).toHaveLength(1);
      expect(readBack.value[0]).toEqual(sampleServer);
    }
  });

  test("listLocalServerSummaries returns redacted view without command/argv/cwd/env", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    await repository.writeLocalServers([sampleServer]);
    const summaries = await repository.listLocalServerSummaries();

    expect(summaries.ok).toBe(true);
    if (summaries.ok) {
      expect(summaries.value).toHaveLength(1);
      const summary = summaries.value[0];
      expect(summary).toEqual({
        serverId: "local-test-1",
        displayName: "Test Local MCP Server",
        transport: "local_stdio",
        enabled: true
      });
      // Verify no leakage
      expect(summary).not.toHaveProperty("command");
      expect(summary).not.toHaveProperty("argv");
      expect(summary).not.toHaveProperty("cwd");
      expect(summary).not.toHaveProperty("envAllowlist");
    }
  });

  test("rejects duplicate serverId", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const duplicate = { ...sampleServer, displayName: "Duplicate" };
    const result = await repository.writeLocalServers([sampleServer, duplicate]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MCP_LOCAL_SERVER_ID_DUPLICATE");
    }
  });

  test("rejects empty serverId", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const invalid = { ...sampleServer, serverId: "" };
    const result = await repository.writeLocalServers([invalid]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MCP_LOCAL_SERVER_ID_EMPTY");
    }
  });

  test("rejects empty command", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const invalid = { ...sampleServer, command: "" };
    const result = await repository.writeLocalServers([invalid]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MCP_LOCAL_SERVER_COMMAND_EMPTY");
    }
  });

  test("rejects command with shell metacharacters", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const invalid = { ...sampleServer, command: "node && echo malicious" };
    const result = await repository.writeLocalServers([invalid]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MCP_LOCAL_SERVER_COMMAND_INVALID");
    }
  });

  test("rejects empty cwd", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    const invalid = { ...sampleServer, cwd: "" };
    const result = await repository.writeLocalServers([invalid]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MCP_LOCAL_SERVER_CWD_EMPTY");
    }
  });

  test("returns empty array for corrupt file", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });
    const filePath = join(root, "agent-mcp", "local-servers.json");

    await import("node:fs/promises").then((fs) =>
      fs.mkdir(join(root, "agent-mcp"), { recursive: true })
    );
    await writeFile(filePath, "{ invalid json", "utf8");

    const result = await repository.readLocalServers();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  test("persists file in agent-mcp subdirectory", async () => {
    const root = await createTempRoot();
    const repository = new McpSettingsFileRepository({ userDataRoot: root });

    await repository.writeLocalServers([sampleServer]);

    const filePath = join(root, "agent-mcp", "local-servers.json");
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"schemaVersion": "1.0"');
    expect(raw).toContain('"serverId": "local-test-1"');
    expect(raw).toContain('"command": "node"');
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-mcp-settings-"));
  tempRoots.push(root);
  return root;
}
