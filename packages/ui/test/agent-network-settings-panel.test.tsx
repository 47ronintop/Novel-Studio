// @vitest-environment jsdom
/**
 * Task D.1 — Network settings panel UI tests.
 * Uses react-dom/client pattern consistent with existing UI tests.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentNetworkSettingsPanel } from "../src/agent-network-settings-panel.js";
import type { AgentNetworkSettingsData } from "@novel-studio/application";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const defaultSettings: AgentNetworkSettingsData = {
  enabled: false,
  allowedHosts: [],
  dataEgressPolicy: "require_confirmation",
  policyRevision: "v1.0-default",
  providerProfiles: []
};

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount();
    });
  }
  container?.remove();
});

function renderPanel(
  settings: Partial<AgentNetworkSettingsData> = {},
  overrideCallbacks?: {
    onUpdateSettings?: (partial: Partial<AgentNetworkSettingsData>) => Promise<void>;
    onTestConnection?: (profileId: string) => Promise<{ readonly latencyMs: number }>;
    onRevoke?: () => Promise<void>;
  }
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const onUpdateSettings = overrideCallbacks?.onUpdateSettings ?? vi.fn().mockResolvedValue(undefined);
  const onTestConnection = overrideCallbacks?.onTestConnection ?? vi.fn().mockResolvedValue({ latencyMs: 50 });
  const onRevoke = overrideCallbacks?.onRevoke ?? vi.fn().mockResolvedValue(undefined);

  act(() => {
    root.render(
      <AgentNetworkSettingsPanel
        settings={{ ...defaultSettings, ...settings }}
        onUpdateSettings={onUpdateSettings}
        onTestConnection={onTestConnection}
        onRevoke={onRevoke}
      />
    );
  });

  return { container, onUpdateSettings, onTestConnection, onRevoke };
}

describe("AgentNetworkSettingsPanel", () => {
  it("renders without crashing", () => {
    const { container } = renderPanel();
    expect(container.querySelector("[data-testid='agent-network-settings-panel']")).toBeTruthy();
  });

  it("shows enable toggle unchecked when disabled", () => {
    const { container } = renderPanel({ enabled: false });
    const checkbox = container.querySelector(
      "[aria-label='启用 Agent 网络访问']"
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it("shows enable toggle checked when enabled", () => {
    const { container } = renderPanel({ enabled: true });
    const checkbox = container.querySelector(
      "[aria-label='启用 Agent 网络访问']"
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("calls onUpdateSettings when toggle is clicked", async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);
    const { container } = renderPanel({ enabled: false }, { onUpdateSettings });
    const checkbox = container.querySelector(
      "[aria-label='启用 Agent 网络访问']"
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith({ enabled: true });
  });

  it("shows allowed hosts", () => {
    const { container } = renderPanel({
      enabled: true,
      allowedHosts: ["api.example.com", "*.search.com"]
    });
    expect(container.textContent).toContain("api.example.com");
    expect(container.textContent).toContain("*.search.com");
  });

  it("calls onRevoke when revoke button is clicked", async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    const { container } = renderPanel({ enabled: true }, { onRevoke });
    const revokeBtn = container.querySelector(
      "[aria-label='撤销所有网络访问']"
    ) as HTMLButtonElement;
    expect(revokeBtn).toBeTruthy();
    await act(async () => {
      revokeBtn.click();
    });
    expect(onRevoke).toHaveBeenCalled();
  });

  it("shows api key status for provider profiles", () => {
    const { container } = renderPanel({
      enabled: true,
      providerProfiles: [
        {
          providerId: "p1",
          name: "Test Provider",
          apiKeyRef: "secret://mykey123",
          endpoint: "https://api.example.com/search",
          policyRevision: "v1.0"
        }
      ]
    });
    const statusEl = container.querySelector("[data-testid='api-key-status-p1']");
    expect(statusEl?.textContent).toContain("已设置");
  });

  it("shows api key not configured when apiKeyRef is bare secret://", () => {
    const { container } = renderPanel({
      enabled: true,
      providerProfiles: [
        {
          providerId: "p2",
          name: "No Key Provider",
          apiKeyRef: "secret://",
          endpoint: "https://api.example.com/search",
          policyRevision: "v1.0"
        }
      ]
    });
    const statusEl = container.querySelector("[data-testid='api-key-status-p2']");
    expect(statusEl?.textContent).toContain("未配置");
  });

  it("disables controls when loading", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <AgentNetworkSettingsPanel
          settings={{ ...defaultSettings, enabled: true }}
          onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
          onTestConnection={vi.fn().mockResolvedValue({ latencyMs: 50 })}
          onRevoke={vi.fn().mockResolvedValue(undefined)}
          loading
        />
      );
    });
    const checkbox = container.querySelector(
      "[aria-label='启用 Agent 网络访问']"
    ) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("shows egress policy selector with correct value", () => {
    const { container } = renderPanel({
      enabled: true,
      dataEgressPolicy: "auto_approve_search_queries"
    });
    const select = container.querySelector("[aria-label='数据外发策略']") as HTMLSelectElement;
    expect(select?.value).toBe("auto_approve_search_queries");
  });
});
