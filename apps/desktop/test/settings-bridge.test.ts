import { describe, expect, test } from "vitest";

import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi
} from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createSettingsBridge } from "../src/renderer/settings-bridge.js";

const defaultProfile: ModelProfile = {
  id: "model_default",
  provider: "openai-compatible",
  displayName: "Default Model",
  baseUrl: "https://api.example.com/v1",
  apiKeyRef: "secret://model_default/api_key",
  modelName: "example-model",
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  timeoutMs: 60000
};

describe("M22 settings bridge", () => {
  test("loads model settings and keeps secret references out of the editable draft by default", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));

    const props = await bridge.load();

    expect(calls).toEqual(["settings.listModelProfiles", "plugins.loadRegistry"]);
    expect(props.profiles[0]?.displayName).toBe("Default Model");
    expect(props.providerOptions.map((provider) => provider.id)).toEqual([
      "openai-compatible",
      "openai",
      "anthropic",
      "google-gemini",
      "openrouter",
      "deepseek",
      "zhipu",
      "tongyi-qianwen",
      "ollama",
      "lm-studio",
      "vllm"
    ]);
    expect(props.plugins?.entries[0]?.pluginId).toBe("novel.timeline-tools");
    expect(props.plugins?.entries[0]?.manifest?.displayName).toBe("Timeline Tools");
    expect(props.plugins?.entries[0]?.manifest?.version).toBe("1.2.3");
    expect(props.draft.apiKeyRefInput).toBe("");
    expect(props.feedback).toEqual({
      kind: "info",
      message: "模型配置已加载。"
    });
  });

  test("saves edited profile drafts and can make them default through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));
    await bridge.load();

    bridge.updateDraft({
      displayName: "Local Ollama",
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelName: "llama3.1",
      apiKeyRefInput: "secret://model_default/api_key",
      temperature: "0.2",
      maxTokens: "2048",
      topP: "",
      timeoutMs: "30000"
    });
    const saved = await bridge.saveDraft({ makeDefault: true });

    expect(calls).toContain("settings.saveModelProfile:model_default:ollama:true");
    expect(saved.defaultProfileId).toBe("model_default");
    expect(saved.saveStatus).toBe("saved");
    expect(saved.feedback).toEqual({
      kind: "info",
      message: "模型配置已保存。"
    });
  });

  test("tests the selected model profile through the injected desktop tester", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));
    await bridge.load();

    const testing = bridge.beginTestConnection("model_default");
    expect(testing.connectionStatus).toEqual({
      profileId: "model_default",
      status: "testing",
      detail: "正在测试连接..."
    });

    const tested = await bridge.testConnection("model_default");

    expect(calls).toContain("settings.testModelProfileConnection:model_default");
    expect(tested.connectionStatus).toEqual({
      profileId: "model_default",
      status: "success",
      detail: "Profile validated by injected tester"
    });
  });

  test("refreshes plugin registry through the preload API without blocking model settings", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));
    await bridge.load();

    const refreshed = await bridge.loadPlugins();

    expect(calls.filter((call) => call === "plugins.loadRegistry")).toHaveLength(2);
    expect(refreshed.plugins?.feedback).toEqual({
      kind: "info",
      message: "插件注册表已加载。"
    });
  });

  test("toggles plugin enabled state through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));
    await bridge.load();

    const updated = await bridge.setPluginEnabled("novel.timeline-tools", false);

    expect(calls).toContain("plugins.setEnabled:novel.timeline-tools:false");
    expect(updated.plugins?.entries[0]?.enabled).toBe(false);
    expect(updated.plugins?.feedback).toMatchObject({ kind: "info" });
  });
});

function createApi(calls: string[]): NovelStudioApi {
  let snapshot: ModelSettingsSnapshot = {
    defaultProfileId: "model_default",
    profiles: [defaultProfile]
  };
  let pluginEnabled = true;

  return {
    getShellState: async () => ({
      projectTitle: "M22",
      activeActivity: "settings",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: []
    }),
    commands: {
      list: async () => [],
      execute: async () =>
        ok({
          projectTitle: "M22",
          activeActivity: "settings",
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          commandPaletteOpen: false,
          saveStatus: "Saved",
          navigatorSections: [],
          bottomPanelTabs: []
        })
    },
    project: {
      chooseOpenDirectory: async () => {
        throw new Error("not used");
      },
      chooseCreateDirectory: async () => {
        throw new Error("not used");
      },
      open: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      listChapters: async () => {
        throw new Error("not used");
      },
      createChapter: async () => {
        throw new Error("not used");
      },
      selectChapter: async () => {
        throw new Error("not used");
      }
    },
    search: {
      rebuildIndex: async () => {
        throw new Error("not used");
      },
      query: async () => {
        throw new Error("not used");
      }
    },
    ai: {
      generateChapterSuggestion: async () => {
        throw new Error("not used");
      },
      applyChapterSuggestion: async () => {
        throw new Error("not used");
      }
    },
    chapter: {
      load: async () => {
        throw new Error("not used");
      },
      edit: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listVersions: async () => {
        throw new Error("not used");
      },
      previewVersion: async () => {
        throw new Error("not used");
      },
      restoreVersion: async () => {
        throw new Error("not used");
      },
      previewSuggestionDiff: async () => {
        throw new Error("not used");
      }
    },
    settings: {
      listModelProfiles: async () => {
        calls.push("settings.listModelProfiles");
        return ok(snapshot);
      },
      saveModelProfile: async (profile, options) => {
        calls.push(
          `settings.saveModelProfile:${profile.id}:${profile.provider}:${options?.makeDefault === true}`
        );
        snapshot = {
          defaultProfileId: options?.makeDefault === true ? profile.id : snapshot.defaultProfileId,
          profiles: snapshot.profiles.map((entry) => (entry.id === profile.id ? profile : entry))
        };
        return ok(snapshot);
      },
      testModelProfileConnection: async (profileId) => {
        calls.push(`settings.testModelProfileConnection:${profileId}`);
        const profile = snapshot.profiles.find((entry) => entry.id === profileId) ?? defaultProfile;
        const result: ModelConnectionResult = {
          ok: true,
          provider: profile.provider,
          modelName: profile.modelName,
          detail: "Profile validated by injected tester"
        };
        return ok(result);
      }
    },
    plugins: {
      loadRegistry: async () => {
        calls.push("plugins.loadRegistry");
        return ok(pluginSnapshot(pluginEnabled));
      },
      setEnabled: async (pluginId, enabled) => {
        calls.push(`plugins.setEnabled:${pluginId}:${enabled}`);
        pluginEnabled = enabled;
        return ok(pluginSnapshot(pluginEnabled));
      }
    },
    storyBible: {
      load: async () => {
        throw new Error("not used");
      },
      saveAsset: async () => {
        throw new Error("not used");
      },
      saveMemory: async () => {
        throw new Error("not used");
      },
      buildContextCandidates: async () => {
        throw new Error("not used");
      }
    },
    studio: {
      loadConfigAsset: async () => {
        throw new Error("not used");
      },
      saveConfigAsset: async () => {
        throw new Error("not used");
      },
      restoreConfigAssetVersion: async () => {
        throw new Error("not used");
      }
    }
  };
}

function pluginSnapshot(enabled: boolean) {
  return {
    schemaVersion: "1.0" as const,
    plugins: [
      {
        pluginId: "novel.timeline-tools",
        enabled,
        manifestPath: "plugins/novel.timeline-tools/plugin.json",
        grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
        manifestStatus: "valid" as const,
        manifest: {
          displayName: "Timeline Tools",
          version: "1.2.3",
          entryKind: "none" as const,
          compatibleAppVersion: { min: "0.1.0", max: "0.2.0" },
          capabilities: [
            { type: "asset-view" as const, id: "timeline.rail", title: "Timeline Rail" }
          ],
          requestedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
          contributes: {
            commands: [{ id: "timeline.open-map", title: "Open timeline map" }],
            workflowSteps: []
          }
        }
      }
    ]
  };
}
