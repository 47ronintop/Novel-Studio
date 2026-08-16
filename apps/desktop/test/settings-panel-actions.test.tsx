// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import type { ModelSettingsPanelProps } from "@novel-studio/ui";
import type { SettingsBridge } from "../src/renderer/settings-bridge.js";
import {
  useModelSettingsActions,
  useSettingsPanelActions
} from "../src/renderer/settings-panel-actions.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSettingsPanelActions", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  test("publishes the final bridge state and preserves a rejected settings action", async () => {
    const loading = { feedback: { kind: "info", message: "loading" } } as ModelSettingsPanelProps;
    const failed = {
      feedback: { kind: "error", message: "update failed" }
    } as ModelSettingsPanelProps;
    let current = loading;
    let rejectUpdate: ((error: Error) => void) | undefined;
    const bridge = {
      getProps: () => current,
      updateNetworkSettings: () =>
        new Promise<ModelSettingsPanelProps>((_resolve, reject) => {
          rejectUpdate = (error) => {
            current = failed;
            reject(error);
          };
        })
    } as unknown as SettingsBridge;
    const published: ModelSettingsPanelProps[] = [];
    let actions: ReturnType<typeof useSettingsPanelActions> | undefined;

    function Harness() {
      actions = useSettingsPanelActions(bridge, (settings) => published.push(settings));
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const pending = actions?.network.onUpdateSettings({ enabled: true });
    expect(published).toEqual([loading]);
    rejectUpdate?.(new Error("update failed"));
    await expect(pending).rejects.toThrow("update failed");
    expect(published).toEqual([loading, failed]);
  });

  test("preserves model discovery and section loading publication order", async () => {
    const profileSelected = { activeProfileId: "model_b" } as ModelSettingsPanelProps;
    const profileDiscovered = {
      feedback: { kind: "info", message: "models ready" }
    } as ModelSettingsPanelProps;
    const profileDiscovering = {
      feedback: { kind: "info", message: "models loading" }
    } as ModelSettingsPanelProps;
    const usageSelected = { activeSection: "usage" } as ModelSettingsPanelProps;
    const usageLoading = {
      feedback: { kind: "info", message: "usage loading" }
    } as ModelSettingsPanelProps;
    const usageLoaded = {
      feedback: { kind: "info", message: "usage ready" }
    } as ModelSettingsPanelProps;
    let current = profileSelected;
    const bridge = {
      getProps: () => current,
      selectProfile: () => profileSelected,
      discoverModelOptions: async () => {
        current = profileDiscovering;
        await Promise.resolve();
        current = profileDiscovered;
        return current;
      },
      selectSection: () => usageSelected,
      loadAgentUsage: async () => {
        current = usageLoading;
        await Promise.resolve();
        current = usageLoaded;
        return current;
      }
    } as unknown as SettingsBridge;
    const published: ModelSettingsPanelProps[] = [];
    let actions: ReturnType<typeof useModelSettingsActions> | undefined;

    function Harness() {
      actions = useModelSettingsActions(bridge, (settings) => published.push(settings));
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      actions?.handleSettingsProfileSelect("model_b");
      await Promise.resolve();
    });
    expect(published).toEqual([profileSelected, profileDiscovering, profileDiscovered]);

    await act(async () => {
      actions?.handleSettingsSectionSelect("usage");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(published).toEqual([
      profileSelected,
      profileDiscovering,
      profileDiscovered,
      usageSelected,
      usageLoading,
      usageLoaded
    ]);
  });
});
