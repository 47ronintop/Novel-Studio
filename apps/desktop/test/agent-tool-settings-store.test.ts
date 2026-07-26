import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  createDesktopAgentNetworkSettingsPort,
  createDesktopMcpSettingsPort
} from "../src/main/agent-tool-settings-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop Agent tool settings store", () => {
  test("fails closed for missing network settings and persists settings across port instances", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-network-settings-"));
    roots.push(userDataRoot);
    const port = createDesktopAgentNetworkSettingsPort({ userDataRoot });

    expect(await port.readNetworkSettings()).toMatchObject({
      ok: true,
      value: { enabled: false, providerProfiles: [] }
    });
    expect(
      await port.writeNetworkSettings({
        enabled: true,
        defaultProviderId: "search",
        providerProfiles: [
          {
            providerId: "search",
            name: "Search",
            apiKeyRef: "secret://agent-network/search/api_key",
            endpoint: "https://search.example.test/api",
            policyRevision: "network-test-1"
          }
        ],
        allowedHosts: ["search.example.test"],
        dataEgressPolicy: "require_confirmation",
        policyRevision: "network-test-1"
      })
    ).toMatchObject({ ok: true });

    expect(
      await createDesktopAgentNetworkSettingsPort({ userDataRoot }).readNetworkSettings()
    ).toMatchObject({
      ok: true,
      value: {
        enabled: true,
        providerProfiles: [
          expect.objectContaining({ apiKeyRef: "secret://agent-network/search/api_key" })
        ]
      }
    });
  });

  test("persists remote MCP settings without exposing plaintext credentials", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-mcp-settings-"));
    roots.push(userDataRoot);
    const port = createDesktopMcpSettingsPort({ userDataRoot });
    expect(
      await port.writeMcpSettings({
        revision: "mcp-test-1",
        servers: [
          {
            serverId: "docs",
            displayName: "Docs",
            transport: "remote_http",
            endpointUrl: "https://mcp.example.test/",
            apiKeyRef: "secret://remote-mcp/docs/api_key",
            enabled: true
          }
        ]
      })
    ).toMatchObject({ ok: true });

    expect(await createDesktopMcpSettingsPort({ userDataRoot }).readMcpSettings()).toMatchObject({
      ok: true,
      value: {
        revision: "mcp-test-1",
        servers: [expect.objectContaining({ apiKeyRef: "secret://remote-mcp/docs/api_key" })]
      }
    });
  });
});
