import { describe, expect, test, vi } from "vitest";

import type {
  ModelConnectionResult,
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  AgentUsageReport,
  AgentUsageQuery
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

    expect(calls).toEqual([
      "settings.listModelProfiles",
      "plugins.loadRegistry",
      "settings.discoverModelOptions:model_default"
    ]);
    expect(props.profiles[0]?.displayName).toBe("Default Model");
    expect(props.modelDiscovery).toMatchObject({
      profileId: "model_default",
      status: "loaded",
      models: [
        { id: "example-model", displayName: "example-model" },
        { id: "gpt-5", displayName: "gpt-5" }
      ]
    });
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
    expect(props.plugins?.entries[0]?.security).toEqual({
      trustState: "trusted-local",
      signing: "required",
      readiness: "blocked",
      executable: false,
      deniedCapabilities: [],
      requestedPermissions: ["asset:read:timeline"],
      grantedPermissions: ["asset:read:timeline"],
      auditEvents: [
        "Plugin package must be signed or explicitly trusted before isolated execution.",
        "Real isolated worker execution is not enabled by this spike."
      ]
    });
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
      reasoningEffortEnabled: true,
      timeoutMs: "30000"
    });
    const saved = await bridge.saveDraft({ makeDefault: true });

    expect(calls).toContain("settings.saveModelProfile:model_default:ollama:true");
    expect(saved.profiles[0]?.reasoningEffortEnabled).toBe(true);
    expect(saved.draft.reasoningEffortEnabled).toBe(true);
    expect(saved.defaultProfileId).toBe("model_default");
    expect(saved.saveStatus).toBe("saved");
    expect(saved.feedback).toEqual({
      kind: "info",
      message: "模型配置已保存。"
    });
  });

  test("stores pasted API keys through the secret API and only saves secret refs in settings", async () => {
    const calls: string[] = [];
    const savedSecrets = new Map<string, string>();
    const bridge = createSettingsBridge(createApi(calls, savedSecrets));
    await bridge.load();

    bridge.updateDraft({
      displayName: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat",
      apiKeyRefInput: "sk-real-key-from-user",
      temperature: "0.2",
      maxTokens: "2048",
      topP: "",
      timeoutMs: "30000"
    });
    const saved = await bridge.saveDraft({ makeDefault: true });

    expect(savedSecrets.get("secret://model_default/api_key")).toBe("sk-real-key-from-user");
    expect(calls).toContain("settings.saveModelSecret:secret://model_default/api_key");
    expect(calls).toContain("settings.saveModelProfile:model_default:deepseek:true");
    expect(saved.profiles[0]?.apiKeyRef).toBe("secret://model_default/api_key");
    expect(JSON.stringify(saved.profiles)).not.toContain("sk-real-key-from-user");
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

  test("redacts failed connection details before exposing settings feedback", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls, new Map(), { connectionFails: true }));
    await bridge.load();

    const tested = await bridge.testConnection("model_default");

    expect(tested.connectionStatus).toMatchObject({
      profileId: "model_default",
      status: "failed"
    });
    const exposedFeedback = JSON.stringify({
      connectionStatus: tested.connectionStatus,
      feedback: tested.feedback
    });
    expect(exposedFeedback).not.toContain("sk-secret");
    expect(exposedFeedback).not.toContain("secret://model_default/api_key");
  });

  test("switches the active settings section without reloading model profiles", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls));
    await bridge.load();

    expect(bridge.getProps().activeSection).toBe("models");

    const appearance = bridge.selectSection("appearance");
    const plugins = bridge.selectSection("plugins");

    expect(appearance.activeSection).toBe("appearance");
    expect(plugins.activeSection).toBe("plugins");
    expect(calls.filter((call) => call === "settings.listModelProfiles")).toHaveLength(1);
  });

  test("loads usage lazily and sends only bounded filters, day detail, and clear commands", async () => {
    const calls: string[] = [];
    const bridge = createSettingsBridge(createApi(calls), {
      todayLocalDate: () => "2026-07-17",
      createUsageCommandId: () => "clear_usage_test"
    });

    await bridge.load();
    expect(calls.some((call) => call.startsWith("settings.listAgentUsage"))).toBe(false);

    bridge.selectSection("usage");
    const loaded = await bridge.loadAgentUsage();
    expect(loaded.usage?.report?.query.range).toEqual({
      fromLocalDate: "2026-07-11",
      toLocalDate: "2026-07-17"
    });
    expect(calls.at(-1)).toBe("settings.listAgentUsage:2026-07-11:2026-07-17::::");

    await bridge.setAgentUsageRange("today");
    expect(calls.at(-1)).toBe("settings.listAgentUsage:2026-07-17:2026-07-17::::");
    await bridge.setAgentUsageRange("30d");
    expect(calls.at(-1)).toBe("settings.listAgentUsage:2026-06-18:2026-07-17::::");
    await bridge.setAgentUsageRange("7d");
    await bridge.setAgentUsageFilters({
      provider: "openai",
      model: "gpt-5",
      projectId: "project_01"
    });
    const detail = await bridge.selectAgentUsageDay("2026-07-16");
    expect(calls.at(-1)).toBe(
      "settings.listAgentUsage:2026-07-11:2026-07-17:openai:gpt-5:project_01:2026-07-16"
    );
    expect(detail.usage?.report?.runs[0]?.runId).toBe("run_01");

    const cleared = await bridge.clearAgentUsage();
    expect(calls.at(-1)).toBe("settings.clearAgentUsage:clear_usage_test:2026-07-11:2026-07-17");
    expect(cleared.usage?.report?.days).toEqual([]);
    expect(JSON.stringify(cleared.usage)).not.toMatch(/path|prompt|request|body|正文/i);
  });

  test("keeps only the newest range, filter, and detail response when requests finish out of order", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const pending: Array<
      Deferred<Awaited<ReturnType<NovelStudioApi["settings"]["listAgentUsage"]>>>
    > = [];
    const queries: AgentUsageQuery[] = [];
    api.settings.listAgentUsage = async (query) => {
      queries.push(query);
      const request = deferred<Awaited<ReturnType<NovelStudioApi["settings"]["listAgentUsage"]>>>();
      pending.push(request);
      return request.promise;
    };
    const bridge = createSettingsBridge(api, { todayLocalDate: () => "2026-07-17" });

    const rangeRequest = bridge.setAgentUsageRange("today");
    const filterRequest = bridge.setAgentUsageFilters({ projectId: "project_02" });
    const detailRequest = bridge.selectAgentUsageDay("2026-07-17");
    expect(queries).toHaveLength(3);
    expect(queries[1]?.projectId).toBe("project_02");
    expect(queries[2]).toMatchObject({ projectId: "project_02", detailLocalDate: "2026-07-17" });

    pending[2]!.resolve(ok(usageReport(queries[2]!, "newest")));
    await detailRequest;
    pending[0]!.resolve(ok(usageReport(queries[0]!, "stale-range")));
    pending[1]!.resolve(ok(usageReport(queries[1]!, "stale-filter")));
    await Promise.all([rangeRequest, filterRequest]);

    expect(bridge.getProps().usage?.report?.query).toEqual(queries[2]);
    expect(bridge.getProps().usage?.report?.generatedAt).toBe("newest");
  });

  test("blocks clear while a usage query is pending", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createSettingsBridge(api, { todayLocalDate: () => "2026-07-17" });
    await bridge.loadAgentUsage();
    const request = deferred<Awaited<ReturnType<NovelStudioApi["settings"]["listAgentUsage"]>>>();
    api.settings.listAgentUsage = async () => request.promise;

    const pending = bridge.setAgentUsageRange("30d");
    expect(bridge.getProps().usage?.status).toBe("loading");
    const blocked = await bridge.clearAgentUsage();
    expect(calls.some((call) => call.startsWith("settings.clearAgentUsage:"))).toBe(false);
    expect(blocked.usage?.feedback?.kind).toBe("error");
    request.resolve(
      ok(
        usageReport({ range: { fromLocalDate: "2026-07-11", toLocalDate: "2026-07-17" } }, "loaded")
      )
    );
    await pending;
  });

  test("coalesces repeated clear while one clear command is in flight", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createSettingsBridge(api, {
      todayLocalDate: () => "2026-07-17",
      createUsageCommandId: () => "clear_usage_once"
    });
    await bridge.loadAgentUsage();
    const request = deferred<Awaited<ReturnType<NovelStudioApi["settings"]["clearAgentUsage"]>>>();
    api.settings.clearAgentUsage = async (command) => {
      calls.push(`deferred-clear:${command.commandId}`);
      return request.promise;
    };

    const first = bridge.clearAgentUsage();
    const second = bridge.clearAgentUsage();
    expect(calls.filter((call) => call === "deferred-clear:clear_usage_once")).toHaveLength(1);
    request.resolve(
      ok({
        query: { range: { fromLocalDate: "2026-07-11", toLocalDate: "2026-07-17" } },
        days: [],
        runs: [],
        generatedAt: "cleared"
      })
    );
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.usage?.report).toEqual(secondResult.usage?.report);
  });

  test("removes stale report on query failure and resets filters after range-only clear", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createSettingsBridge(api, {
      todayLocalDate: () => "2026-07-17",
      createUsageCommandId: () => "clear_usage_consistent"
    });
    await bridge.loadAgentUsage();
    await bridge.setAgentUsageFilters({ projectId: "project_01" });
    const cleared = await bridge.clearAgentUsage();
    expect(cleared.usage?.filters).toEqual({ provider: "", model: "", projectId: "" });
    expect(cleared.usage?.report?.query).toEqual({
      range: { fromLocalDate: "2026-07-11", toLocalDate: "2026-07-17" }
    });

    api.settings.listAgentUsage = async () => ({
      ok: false,
      error: { message: "query failed" } as never
    });
    const failed = await bridge.setAgentUsageRange("30d");
    expect(failed.usage?.status).toBe("error");
    expect(failed.usage?.report).toBeUndefined();
  });

  test("creates distinct bounded clear command ids within the same millisecond", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const calls: string[] = [];
      const bridge = createSettingsBridge(createApi(calls), {
        todayLocalDate: () => "2026-07-17"
      });
      await bridge.loadAgentUsage();
      await bridge.clearAgentUsage();
      await bridge.clearAgentUsage();
      const commandIds = calls
        .filter((call) => call.startsWith("settings.clearAgentUsage:"))
        .map((call) => call.split(":")[1]!);

      expect(commandIds).toHaveLength(2);
      expect(new Set(commandIds).size).toBe(2);
      expect(
        commandIds.every((id) => id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
      ).toBe(true);
    } finally {
      now.mockRestore();
    }
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

function createApi(
  calls: string[],
  savedSecrets = new Map<string, string>(),
  options: { readonly connectionFails?: boolean } = {}
): NovelStudioApi {
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
      saveModelSecret: async (secretRef, secret) => {
        calls.push(`settings.saveModelSecret:${secretRef}`);
        savedSecrets.set(secretRef, secret);
        return ok(undefined);
      },
      testModelProfileConnection: async (profileId) => {
        calls.push(`settings.testModelProfileConnection:${profileId}`);
        if (options.connectionFails === true) {
          return {
            ok: false,
            error: {
              schemaVersion: "1.0",
              errorId: "err_model_secret",
              code: "MODEL_CONNECTION_FAILED",
              category: "LLMAdapterError",
              message:
                "Provider rejected sk-secret for secret://model_default/api_key during test.",
              recoverability: "user-action",
              suggestedAction: "Check the model profile.",
              traceId: "settings-bridge-test",
              createdAt: "2026-07-08T00:00:00.000Z"
            }
          };
        }
        const profile = snapshot.profiles.find((entry) => entry.id === profileId) ?? defaultProfile;
        const result: ModelConnectionResult = {
          ok: true,
          provider: profile.provider,
          modelName: profile.modelName,
          detail: "Profile validated by injected tester"
        };
        return ok(result);
      },
      discoverModelOptions: async (profileId) => {
        calls.push(`settings.discoverModelOptions:${profileId}`);
        const profile = snapshot.profiles.find((entry) => entry.id === profileId) ?? defaultProfile;
        const result: ModelDiscoverySnapshot = {
          profileId,
          provider: profile.provider,
          status: "loaded",
          models: [
            {
              id: "example-model",
              displayName: "example-model",
              provider: profile.provider
            },
            {
              id: "gpt-5",
              displayName: "gpt-5",
              provider: profile.provider,
              reasoningStrength: {
                status: "available",
                providerParamName: "reasoning_effort",
                allowedValues: ["low", "medium", "high"],
                defaultValue: "medium"
              }
            }
          ],
          reasoningStrength: {
            status: "hidden",
            reason: "Select a whitelisted reasoning model before exposing reasoning controls."
          }
        };
        return ok(result);
      },
      listAgentUsage: async (query) => {
        calls.push(
          `settings.listAgentUsage:${query.range.fromLocalDate}:${query.range.toLocalDate}:${query.provider ?? ""}:${query.model ?? ""}:${query.projectId ?? ""}:${query.detailLocalDate ?? ""}`
        );
        const report: AgentUsageReport = {
          query,
          days: [
            {
              localDate: "2026-07-16",
              inputTokens: 100,
              outputTokens: 20,
              cachedTokens: 10,
              reasoningTokens: 0,
              totalTokens: 120,
              costs: [{ currency: "USD", actualAmount: 0.01, estimatedAmount: 0.02 }],
              hasUnknownCost: true
            }
          ],
          runs:
            query.detailLocalDate === undefined
              ? []
              : [
                  {
                    usageId: "run_01:round_01:1",
                    runId: "run_01",
                    conversationId: "conversation_01",
                    projectId: "project_01",
                    provider: "openai",
                    model: "gpt-5",
                    totalTokens: 120,
                    usageStatus: "actual",
                    cost: { status: "actual", amount: 0.01, currency: "USD" },
                    timestamp: "2026-07-16T08:00:00.000Z"
                  }
                ],
          generatedAt: "2026-07-17T12:00:00.000Z"
        };
        return ok(report);
      },
      clearAgentUsage: async (command) => {
        calls.push(
          `settings.clearAgentUsage:${command.commandId}:${command.range.fromLocalDate}:${command.range.toLocalDate}`
        );
        return ok({
          query: { range: command.range },
          days: [],
          runs: [],
          generatedAt: "2026-07-17T12:01:00.000Z"
        });
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
      buildConsistencyReport: async () => {
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

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function usageReport(query: AgentUsageQuery, generatedAt: string): AgentUsageReport {
  return {
    query,
    days: [
      {
        localDate: query.range.toLocalDate,
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 2,
        costs: [],
        hasUnknownCost: true
      }
    ],
    runs: [],
    generatedAt
  };
}
