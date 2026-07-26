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
import type { AgentNetworkProviderProfile } from "@novel-studio/application";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const defaultSettings: AgentNetworkSettingsData = {
  enabled: false,
  allowedHosts: [],
  dataEgressPolicy: "require_confirmation",
  policyRevision: "v1.0-default",
  providerProfiles: [],
  defaultProviderId: ""
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
    onSaveProvider?: (
      profile: Omit<AgentNetworkProviderProfile, "policyRevision">,
      secret?: string
    ) => Promise<void>;
    onRemoveProvider?: (profileId: string) => Promise<void>;
    onSetDefaultProvider?: (profileId: string) => Promise<void>;
    onRevoke?: () => Promise<void>;
  }
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const onUpdateSettings =
    overrideCallbacks?.onUpdateSettings ?? vi.fn().mockResolvedValue(undefined);
  const onTestConnection =
    overrideCallbacks?.onTestConnection ?? vi.fn().mockResolvedValue({ latencyMs: 50 });
  const onRevoke = overrideCallbacks?.onRevoke ?? vi.fn().mockResolvedValue(undefined);
  const onSaveProvider = overrideCallbacks?.onSaveProvider ?? vi.fn().mockResolvedValue(undefined);
  const onRemoveProvider =
    overrideCallbacks?.onRemoveProvider ?? vi.fn().mockResolvedValue(undefined);
  const onSetDefaultProvider =
    overrideCallbacks?.onSetDefaultProvider ?? vi.fn().mockResolvedValue(undefined);

  act(() => {
    root.render(
      <AgentNetworkSettingsPanel
        settings={{ ...defaultSettings, ...settings }}
        onUpdateSettings={onUpdateSettings}
        onTestConnection={onTestConnection}
        onSaveProvider={onSaveProvider}
        onRemoveProvider={onRemoveProvider}
        onSetDefaultProvider={onSetDefaultProvider}
        onRevoke={onRevoke}
      />
    );
  });

  return {
    container,
    onUpdateSettings,
    onTestConnection,
    onSaveProvider,
    onRemoveProvider,
    onSetDefaultProvider,
    onRevoke
  };
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

  it("submits a new provider with a deterministic secret ref", async () => {
    const onSaveProvider = vi.fn().mockResolvedValue(undefined);
    const rendered = renderPanel(
      { enabled: true, allowedHosts: ["search.example.com"] },
      { onSaveProvider }
    );
    const setValue = (label: string, value: string) => {
      const input = rendered.container.querySelector(`[aria-label='${label}']`) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue("网络 Provider ID", "primary");
      setValue("网络 Provider 名称", "Primary Search");
      setValue("网络 Provider 端点", "https://search.example.com/query");
      setValue("网络 Provider API Key", "network-secret");
    });

    const save = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "新增 Provider"
    );
    await act(async () => {
      (save as HTMLButtonElement).click();
    });

    expect(onSaveProvider).toHaveBeenCalledWith(
      {
        providerId: "primary",
        name: "Primary Search",
        endpoint: "https://search.example.com/query",
        apiKeyRef: "secret://agent-network/primary/api_key"
      },
      "network-secret"
    );
  });

  it("can select and remove a configured provider", async () => {
    const onSetDefaultProvider = vi.fn().mockResolvedValue(undefined);
    const onRemoveProvider = vi.fn().mockResolvedValue(undefined);
    const rendered = renderPanel(
      {
        enabled: true,
        defaultProviderId: "primary",
        providerProfiles: [
          {
            providerId: "primary",
            name: "Primary",
            endpoint: "https://search.example.com/query",
            apiKeyRef: "secret://network/primary",
            policyRevision: "v1"
          },
          {
            providerId: "backup",
            name: "Backup",
            endpoint: "https://backup.example.com/query",
            apiKeyRef: "secret://network/backup",
            policyRevision: "v1"
          }
        ]
      },
      { onSetDefaultProvider, onRemoveProvider }
    );

    await act(async () => {
      (
        rendered.container.querySelector(
          "[aria-label='设为默认 Provider Backup']"
        ) as HTMLButtonElement
      ).click();
      (
        rendered.container.querySelector("[aria-label='删除 Provider Backup']") as HTMLButtonElement
      ).click();
    });
    expect(onSetDefaultProvider).toHaveBeenCalledWith("backup");
    expect(onRemoveProvider).toHaveBeenCalledWith("backup");
  });
});
