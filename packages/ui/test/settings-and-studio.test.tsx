// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AgentToolSourcePanel, ModelSettingsPanel } from "../src/index.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("M8 Settings UI", () => {
  test("renders only functional model appearance and plugin settings", () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="appearance"
        appearancePreferences={{ theme: "dark", accentColor: "teal" }}
        editorPreferences={{ fontFamily: "serif", fontSize: 16, lineHeight: 1.8 }}
      />
    );
    const modelHtml = renderToStaticMarkup(
      <ModelSettingsPanel {...createModelSettingsPanelProps()} activeSection="models" />
    );

    expect(html).toContain("模型");
    expect(html).toContain("外观");
    expect(html).toContain("插件");
    expect(html).toContain('aria-label="浅色主题"');
    expect(html).toContain('aria-label="强调色 蓝色"');
    expect(html).not.toContain(">写作</button>");
    expect(html).not.toContain(">编辑器</button>");
    expect(html).not.toContain(">高级</button>");
    expect(html).not.toContain("界面密度");
    expect(html).not.toContain("编辑器外观预览");
    expect(html).not.toContain("自动保存与历史");
    expect(html).not.toContain("隐私与安全");
    expect(modelHtml).not.toContain('aria-label="完整 URL"');
    expect(modelHtml).toContain('aria-label="模型上下文窗口"');
    expect(modelHtml).toContain("这不是单次响应的 Max Tokens");
    expect(modelHtml).toContain("Max Tokens（可选）");
    expect(modelHtml).toContain("留空时使用模型或服务商默认值");
  });

  test("renders VSCode settings structure with editor preferences in appearance", () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="appearance"
        appearancePreferences={{
          theme: "dark",
          accentColor: "teal",
          editor: {
            fontFamily: "serif",
            fontSize: 16,
            lineHeight: 1.8
          }
        }}
      />
    );

    expect(html).toContain('data-settings-layout="vscode"');
    expect(html).toContain('aria-label="搜索设置"');
    expect(html).toContain('class="model-settings-category-list"');
    expect(html).toContain('class="model-settings-section"');
    expect(html).toContain("model-settings-item");
    expect(html).not.toContain("model-settings-card");
    expect(html).toContain("外观: 编辑器字体");
    expect(html).toContain("外观: 编辑器字号");
    expect(html).toContain("外观: 编辑器行高");
    expect(html).toContain('aria-label="外观编辑器字体"');
    expect(html).toContain('aria-label="外观编辑器字号"');
    expect(html).toContain('aria-label="外观编辑器行高"');
  });

  test("keeps the desktop settings navigation fixed while only its content scrolls", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    expect(css).toMatch(
      /\.ns-shell\[data-settings-mode="true"\] \.ns-editor-area\s*\{[^}]*overflow:\s*hidden/s
    );
    expect(css).toMatch(
      /\.model-settings-nav\s*\{[^}]*overflow:\s*visible[^}]*position:\s*relative/s
    );
    expect(css).toMatch(
      /\.model-settings-main\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s
    );
  });

  test("uses the shared themed settings structure for tool sources", () => {
    const html = renderToStaticMarkup(
      <AgentToolSourcePanel
        servers={[
          {
            config: {
              serverId: "mcp_example",
              displayName: "Example MCP",
              transport: "remote_http",
              endpointUrl: "https://mcp.example.com/api",
              apiKeyRef: "secret://remote-mcp/mcp_example/api_key",
              apiKeyRequired: true,
              enabled: true
            }
          }
        ]}
        onAddServer={async () => undefined}
        onRemoveServer={async () => undefined}
        onRevokeServer={async () => undefined}
        onSetEnabled={async () => undefined}
        onTestConnection={async () => ({ latencyMs: 12 })}
      />
    );

    expect(html).toContain('class="model-settings-section agent-tool-source-settings"');
    expect(html).toContain('class="agent-tool-source-card"');
    expect(html).toContain('class="agent-tool-source-badge"');
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/#(?:111|1a1a1a|333|555|666|888|aaa|4caf50|f44336)/i);
  });

  test("filters settings by search query", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <ModelSettingsPanel {...createModelSettingsPanelProps()} activeSection="models" />
      );
    });

    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
    expect(search).not.toBeNull();
    if (search === null) {
      throw new Error("Expected settings search input to render.");
    }

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(search, "API Key");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.textContent).toContain("模型: API Key");
    expect(host.textContent).not.toContain("模型: Timeout");

    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  test("renders VSCode-like settings tabs with one active functional panel", () => {
    const appearanceHtml = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="appearance"
        appearancePreferences={{
          theme: "dark",
          accentColor: "teal",
          editor: {
            fontFamily: "serif",
            fontSize: 16,
            lineHeight: 1.8
          }
        }}
      />
    );
    const pluginHtml = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="plugins"
        plugins={{ status: "loaded", entries: [] }}
      />
    );

    expect(appearanceHtml).toContain('aria-label="设置分类"');
    expect(appearanceHtml).toContain('aria-current="page"');
    expect(appearanceHtml).toContain("模型");
    expect(appearanceHtml).toContain("外观");
    expect(appearanceHtml).toContain("插件");
    expect(appearanceHtml).toContain('aria-label="外观设置"');
    expect(appearanceHtml).toContain("外观: 主题策略");
    expect(appearanceHtml).toContain('aria-label="外观主题"');
    expect(appearanceHtml).toContain('aria-label="深色主题"');
    expect(appearanceHtml).toContain('aria-label="浅色主题"');
    expect(appearanceHtml).toContain('aria-label="跟随系统主题"');
    expect(appearanceHtml).toContain('aria-label="水墨鎏金主题"');
    expect(appearanceHtml).toContain("外观: 强调色");
    expect(appearanceHtml).toContain('aria-label="外观强调色"');
    expect(appearanceHtml).toContain('data-accent="teal"');
    expect(appearanceHtml).toContain('data-accent="blue"');
    expect(appearanceHtml).toContain('data-accent="amber"');
    expect(appearanceHtml).toContain("外观: 编辑器字体");
    expect(appearanceHtml).toContain("外观: 编辑器字号");
    expect(appearanceHtml).toContain("外观: 编辑器行高");
    expect(appearanceHtml).toContain("serif");
    expect(appearanceHtml).not.toContain("新建模型");
    expect(appearanceHtml).not.toContain('aria-label="模型配置"');
    expect(pluginHtml).toContain('aria-label="插件管理"');
    expect(pluginHtml).not.toContain('aria-label="模型配置"');
    expect(pluginHtml).not.toContain('aria-label="外观设置"');
  });

  test("scopes the new model action to model settings", () => {
    const modelsHtml = renderToStaticMarkup(
      <ModelSettingsPanel {...createModelSettingsPanelProps()} activeSection="models" />
    );
    const appearanceHtml = renderToStaticMarkup(
      <ModelSettingsPanel {...createModelSettingsPanelProps()} activeSection="appearance" />
    );

    expect(modelsHtml).toContain("新建模型");
    expect(appearanceHtml).not.toContain("新建模型");
  });

  test("updates appearance controls through settings callbacks", async () => {
    const appearanceCalls: string[] = [];
    const editorCalls: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <ModelSettingsPanel
          {...createModelSettingsPanelProps()}
          activeSection="appearance"
          appearancePreferences={{
            theme: "dark",
            accentColor: "teal",
            editor: {
              fontFamily: "mono",
              fontSize: 13,
              lineHeight: 1.7
            }
          }}
          editorPreferences={{
            fontFamily: "mono",
            fontSize: 13,
            lineHeight: 1.7
          }}
          onAppearancePreferencesChange={(preferences) =>
            appearanceCalls.push(`${preferences.theme}:${preferences.accentColor}`)
          }
          onEditorPreferencesChange={(preferences) => editorCalls.push(preferences.fontFamily)}
        />
      );
    });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="浅色主题"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      host
        .querySelector<HTMLButtonElement>('button[aria-label="强调色 蓝色"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const fontSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="外观编辑器字体"]'
      );
      if (fontSelect !== null) {
        fontSelect.value = "sans";
        fontSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(appearanceCalls).toEqual(["light:teal", "dark:blue"]);
    expect(editorCalls).toEqual(["sans"]);

    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  test("announces appearance persistence failures next to appearance controls", () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="appearance"
        appearanceFeedback={{
          kind: "error",
          message: "外观已在本次会话生效，但未能保存到本地。"
        }}
        appearancePreferences={{ theme: "light", accentColor: "blue" }}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("外观已在本次会话生效，但未能保存到本地。");
  });

  test("renders model profile settings without plaintext secrets", () => {
    const tree = (
      <ModelSettingsPanel
        defaultProfileId="model_default"
        selectedProfileId="model_default"
        profiles={[
          {
            id: "model_default",
            provider: "openai-compatible",
            displayName: "Default Model",
            baseUrl: "https://api.example.com/v1",
            modelName: "example-model",
            apiKeyRef: "secret://model_default/api_key",
            temperature: 0.7,
            maxTokens: 4096,
            topP: 1,
            timeoutMs: 60000
          }
        ]}
        draft={{
          id: "model_default",
          provider: "openai-compatible",
          displayName: "Default Model",
          baseUrl: "https://api.example.com/v1",
          modelName: "example-model",
          contextWindow: "",
          apiKeyRefInput: "",
          temperature: "0.7",
          maxTokens: "4096",
          topP: "1",
          reasoningEffortEnabled: false,
          timeoutMs: "60000"
        }}
        connectionStatus={{
          profileId: "model_default",
          status: "idle"
        }}
        plugins={{
          status: "loaded",
          entries: [
            {
              pluginId: "novel.timeline-tools",
              enabled: true,
              manifestPath: "plugins/novel.timeline-tools/plugin.json",
              grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
              manifestStatus: "valid",
              manifest: {
                displayName: "Timeline Tools",
                version: "1.2.3",
                entryKind: "none",
                compatibleAppVersion: { min: "0.1.0", max: "0.2.0" },
                capabilities: [{ type: "asset-view", id: "timeline.rail", title: "Timeline Rail" }],
                requestedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
                contributes: {
                  commands: [{ id: "timeline.open-map", title: "Open timeline map" }],
                  workflowSteps: []
                }
              }
            }
          ],
          onSetEnabled: () => undefined
        }}
        saveStatus="idle"
        providerOptions={[
          { id: "openai-compatible", label: "OpenAI Compatible" },
          { id: "openai", label: "OpenAI" },
          { id: "anthropic", label: "Anthropic" },
          { id: "google-gemini", label: "Google Gemini" },
          { id: "openrouter", label: "OpenRouter" },
          { id: "deepseek", label: "DeepSeek" },
          { id: "zhipu", label: "Zhipu" },
          { id: "tongyi-qianwen", label: "Tongyi Qianwen" },
          { id: "ollama", label: "Ollama" },
          { id: "lm-studio", label: "LM Studio" },
          { id: "vllm", label: "vLLM" }
        ]}
        modelDiscovery={{
          profileId: "model_default",
          provider: "openai-compatible",
          status: "loaded",
          models: [
            {
              id: "example-model",
              displayName: "example-model",
              provider: "openai-compatible"
            },
            {
              id: "gpt-5",
              displayName: "gpt-5",
              provider: "openai-compatible",
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
        }}
        onDraftChange={() => undefined}
        onNewProfile={() => undefined}
        onSelectProfile={() => undefined}
        onSaveProfile={() => undefined}
        onTestConnection={() => undefined}
        onMakeDefault={() => undefined}
      />
    );
    const html = renderToStaticMarkup(tree);
    const pluginHtml = renderToStaticMarkup(
      <ModelSettingsPanel {...tree.props} activeSection="plugins" />
    );

    expect(html).toContain("Default Model");
    expect(html).toContain("设置");
    expect(html).toContain("模型配置");
    expect(html).not.toContain("隐私与安全");
    expect(html).not.toContain("自动保存与历史");
    expect(html).toContain("openai-compatible");
    expect(html).toContain('aria-label="Discovered model name"');
    expect(html).toContain('value="gpt-5"');
    expect(html).toContain("anthropic");
    expect(html).toContain("google-gemini");
    expect(html).toContain("openrouter");
    expect(html).toContain("deepseek");
    expect(html).toContain("zhipu");
    expect(html).toContain("tongyi-qianwen");
    expect(html).toContain("lm-studio");
    expect(html).toContain("vllm");
    expect(html).toContain("已保存密钥引用");
    expect(html).toContain("settings.json 只保留 secret:// 引用");
    expect(html).toContain("保存模型配置");
    expect(html).toContain("新建模型");
    expect(html).toContain('aria-label="测试连接 Default Model"');
    expect(html).not.toContain("secret://model_default/api_key");
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]+/);
    expect(html).not.toMatch(/filesystem|node:|fs\./i);
    expect(pluginHtml).toContain("Timeline Tools");
    expect(pluginHtml).toContain("1.2.3");
    expect(pluginHtml).toContain("timeline.rail");
    expect(pluginHtml).toContain("timeline.open-map");
    expect(pluginHtml).toContain("插件注册表（仅查看）");
    expect(pluginHtml).toContain("当前版本不会安装、下载或执行第三方插件代码");
    expect(pluginHtml).not.toContain('aria-label="Disable plugin Timeline Tools"');
    expect(pluginHtml).not.toContain('aria-label="模型配置"');
  });

  test("renders Agent usage trends, token breakdowns, filters, and private run summaries", () => {
    const prefixChecksum = "a".repeat(64);
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="usage"
        usage={{
          status: "loaded",
          rangePreset: "7d",
          filters: { provider: "", model: "", projectId: "" },
          report: {
            query: {
              range: { fromLocalDate: "2026-07-11", toLocalDate: "2026-07-17" },
              detailLocalDate: "2026-07-16"
            },
            days: [
              {
                localDate: "2026-07-16",
                inputTokens: 1200,
                outputTokens: 300,
                cachedTokens: 400,
                cacheReadTokens: 400,
                cacheWriteTokens: 10,
                cacheEligibleInputTokens: 500,
                cacheHitRate: 0.8,
                reasoningTokens: 0,
                totalTokens: 1500,
                costs: [
                  {
                    currency: "USD",
                    actualAmount: 0.04,
                    estimatedAmount: 0.02,
                    estimatedCacheSavings: 0.012
                  },
                  { currency: "EUR", actualAmount: 0, estimatedAmount: 0.03 }
                ],
                hasUnknownCost: true,
                models: [{ provider: "openai", model: "gpt-5", totalTokens: 1500 }]
              }
            ],
            runs: [
              {
                scope: {
                  kind: "workspace",
                  workspaceKind: "creativeProject",
                  workspaceId: "project_01"
                },
                usageId: "run_01:round_02:7",
                runId: "run_01",
                conversationId: "conversation_01",
                projectId: "project_01",
                provider: "openai",
                model: "gpt-5",
                totalTokens: 1500,
                cacheReadTokens: 400,
                cacheWriteTokens: 10,
                cacheEligibleInputTokens: 500,
                cacheHitRate: 0.8,
                cacheOutcome: "hit",
                cacheUsageStatus: "actual",
                cacheInputTokenSemantics: "included_in_input",
                cacheMode: "automatic_prefix",
                cachePrefixChecksum: prefixChecksum,
                estimatedCacheSavings: { amount: 0.012, currency: "USD" },
                usageStatus: "actual",
                cost: { status: "actual", amount: 0.04, currency: "USD" },
                timestamp: "2026-07-16T08:00:00.000Z"
              },
              {
                scope: {
                  kind: "workspace",
                  workspaceKind: "creativeProject",
                  workspaceId: "project_01"
                },
                usageId: "run_02:round_03:8",
                runId: "run_02",
                conversationId: "conversation_01",
                projectId: "project_01",
                provider: "openai",
                model: "gpt-5",
                totalTokens: 100,
                cacheOutcome: "bypass",
                cacheBypassReason: "below_minimum_tokens",
                cacheUsageStatus: "unavailable",
                cacheInputTokenSemantics: "unavailable",
                cacheMode: "automatic_prefix",
                cachePrefixChecksum: null,
                usageStatus: "actual",
                cost: { status: "unknown", amount: 0, currency: "" },
                timestamp: "2026-07-16T09:00:00.000Z"
              }
            ],
            generatedAt: "2026-07-17T12:00:00.000Z"
          }
        }}
      />
    );

    expect(html).toContain("Agent 用量");
    expect(html).toContain('class="model-settings-section agent-usage-settings"');
    expect(html).toContain("用量摘要");
    expect(html).toContain("总 Token");
    expect(html).toContain("输入");
    expect(html).toContain("输出");
    expect(html).toContain("缓存");
    expect(html).toContain('aria-label="用量日期范围"');
    expect(html).toContain("今日");
    expect(html).toContain("近 7 天");
    expect(html).toContain("近 30 天");
    expect(html).toContain('aria-label="Provider 筛选"');
    expect(html).toContain('data-chart-kind="daily"');
    expect(html).toContain('aria-label="每日 Agent Token 柱状图"');
    expect(html).toContain('aria-label="模型颜色图例"');
    expect(html).toContain('data-model-key="openai/gpt-5"');
    expect(html).toContain("每日明细");
    expect(html).not.toContain("输入 / 输出");
    expect(html).toContain("总 Token");
    expect(html).not.toContain("缓存写入");
    expect(html).not.toContain("可缓存输入");
    expect(html).toContain("命中 · 读取 400");
    expect(html).toContain('aria-label="运行记录分页"');
    expect(html).toContain("第 1 / 1 页 · 共 2 条");
    expect(html).toContain("命中");
    expect(html).toContain("跳过");
    expect(html).toContain("低于最小 token 数");
    expect(html).toContain('class="agent-usage-run-card"');
    expect(html).toContain('aria-label="所选日期 Agent 运行记录"');
    expect(html).not.toContain("模式：");
    expect(html).not.toContain("缓存用量：");
    expect(html).not.toContain("输入口径：");
    expect(html).not.toContain("Prefix：");
    expect(html).not.toContain("aaaaaaaa...aaaaaa");
    expect(html).not.toContain(prefixChecksum);
    expect(html).not.toContain("费用");
    expect(html).not.toContain("缓存命中率");
    expect(html).not.toContain("缓存节省");
    expect(html).not.toContain("USD");
    expect(html).not.toContain("EUR");
    expect(html).toContain('aria-label="每日 Agent 用量明细"');
    expect(html).not.toContain("run_01");
    expect(html).not.toContain("已报告");
    expect(html).not.toMatch(/prompt|request|正文内容|filesystem|node:|fs\./i);

    const emptyHtml = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="usage"
        usage={{
          status: "loaded",
          rangePreset: "today",
          filters: { provider: "", model: "", projectId: "" },
          report: {
            query: { range: { fromLocalDate: "2026-07-17", toLocalDate: "2026-07-17" } },
            days: [],
            runs: [],
            generatedAt: "2026-07-17T12:00:00.000Z"
          }
        }}
      />
    );
    expect(emptyHtml).toContain("所选范围暂无 Agent 用量记录");
  });

  test("paginates per-request usage and cache details", async () => {
    const runs = Array.from({ length: 21 }, (_, index) => ({
      scope: {
        kind: "workspace" as const,
        workspaceKind: "creativeProject" as const,
        workspaceId: "project_01"
      },
      usageId: `usage_${index}`,
      runId: `run_${index}`,
      conversationId: "conversation_01",
      provider: "openai",
      model: "gpt-5",
      totalTokens: index + 1,
      cacheReadTokens: index,
      cacheWriteTokens: 1,
      cacheEligibleInputTokens: index + 1,
      cacheHitRate: index / Math.max(1, index + 1),
      cacheOutcome: "hit" as const,
      cacheUsageStatus: "actual" as const,
      cacheInputTokenSemantics: "included_in_input" as const,
      cacheMode: "automatic_prefix" as const,
      usageStatus: "actual" as const,
      cost: { status: "actual" as const, amount: 0, currency: "USD" },
      timestamp: "2026-07-17T08:00:00.000Z"
    }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ModelSettingsPanel
          {...createModelSettingsPanelProps()}
          activeSection="usage"
          usage={{
            status: "loaded",
            rangePreset: "7d",
            filters: { provider: "", model: "", projectId: "" },
            report: {
              query: {
                range: { fromLocalDate: "2026-07-11", toLocalDate: "2026-07-17" },
                detailLocalDate: "2026-07-17"
              },
              days: [
                {
                  localDate: "2026-07-17",
                  inputTokens: 21,
                  outputTokens: 21,
                  cachedTokens: 20,
                  reasoningTokens: 0,
                  totalTokens: 42,
                  costs: [],
                  hasUnknownCost: false
                }
              ],
              runs,
              generatedAt: "2026-07-17T12:00:00.000Z"
            }
          }}
        />
      );
    });

    const runList = host.querySelector<HTMLOListElement>(
      'ol[aria-label="所选日期 Agent 运行记录"]'
    );
    expect(runList?.querySelectorAll("li")).toHaveLength(10);
    expect(host.querySelector('[aria-label="运行记录分页"]')?.textContent).toContain(
      "第 1 / 3 页 · 共 21 条"
    );
    expect(runList?.textContent).toContain("命中 · 读取 0");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="下一页运行记录"]')?.click();
    });
    expect(runList?.querySelectorAll("li")).toHaveLength(10);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="下一页运行记录"]')?.click();
    });
    expect(runList?.querySelectorAll("li")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("lays out model fields as separated rows with field-level actions", async () => {
    const discoverCalls: string[] = [];
    const testConnectionCalls: string[] = [];
    const tree = (
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        connectionStatus={{
          profileId: "model_default",
          status: "failed",
          detail: "Provider returned a non-SSE streaming response."
        }}
        onDiscoverModelOptions={(profileId) => discoverCalls.push(profileId)}
        onTestConnection={(profileId) => testConnectionCalls.push(profileId)}
      />
    );
    const html = renderToStaticMarkup(tree);

    expect(html).toContain('data-field-layout="stacked"');
    expect(html).toContain("model-settings-field-header");
    expect(html).toContain("模型: API Key");
    expect(html).toContain('aria-label="显示或隐藏 API Key"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('aria-label="完整 URL"');
    expect(html).toContain('aria-label="测试连接"');
    expect(html).not.toContain("管理与测速");
    expect(html).toContain('class="model-settings-inline-status"');
    expect(html).toContain('data-status="failed"');
    expect(html).toContain("Provider returned a non-SSE streaming response.");
    expect(html).toContain('aria-label="获取模型列表"');
    expect(html).toContain('class="model-settings-item-description"');
    expect(html).toContain("请填写兼容 OpenAI 格式的服务端点地址");
    expect(html.indexOf('aria-label="模型 Base URL"')).toBeLessThan(
      html.indexOf('aria-label="密钥引用"')
    );
    expect(html.indexOf('aria-label="密钥引用"')).toBeLessThan(
      html.indexOf('aria-label="获取模型列表"')
    );

    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(tree);
    });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="获取模型列表"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      host
        .querySelector<HTMLButtonElement>(
          '.model-settings-field-actions button[aria-label="测试连接"]'
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(discoverCalls).toEqual(["model_default"]);
    expect(testConnectionCalls).toEqual(["model_default"]);
    expect(
      host.querySelector<HTMLButtonElement>('.model-profile-form-actions button[type="button"]')
    ).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  test("shows the selected native Agent adapter and protocol-specific endpoint guidance", () => {
    const props = createModelSettingsPanelProps();
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        {...props}
        draft={{
          ...props.draft,
          provider: "anthropic",
          baseUrl: "https://api.anthropic.com",
          modelName: "claude-3-5-sonnet"
        }}
        providerOptions={[
          {
            id: "anthropic",
            label: "Anthropic",
            agentAdapter: "anthropic-native",
            agentSupport: "native",
            agentSupportNote: "Agent 使用 Anthropic Messages 原生协议。"
          }
        ]}
      />
    );

    expect(html).toContain('data-testid="agent-provider-support"');
    expect(html).toContain("Agent 使用 Anthropic Messages 原生协议");
    expect(html).toContain("请填写 Anthropic Messages API 根地址");
    expect(html).not.toContain("请填写兼容 OpenAI 格式的服务端点地址");
    expect(html).not.toContain('aria-label="手动启用兼容端点推理强度"');
  });

  test("keeps provider visible and moves low-frequency model fields into advanced settings", () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel {...createModelSettingsPanelProps()} activeSection="models" />
    );

    const providerIndex = html.indexOf('aria-label="模型 Provider"');
    const baseUrlIndex = html.indexOf('aria-label="模型 Base URL"');
    const advancedIndex = html.indexOf('class="model-settings-advanced"');
    const reasoningEffortIndex = html.indexOf('aria-label="手动启用兼容端点推理强度"');
    const profileIdIndex = html.indexOf('aria-label="模型 Profile ID"');
    const temperatureIndex = html.indexOf('aria-label="Temperature"');

    expect(html).toContain('class="model-profile-summary"');
    expect(html).not.toContain('class="model-profile-list"');
    expect(html).toContain('class="model-settings-advanced"');
    expect(html).toContain('aria-label="高级模型设置"');
    expect(providerIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeGreaterThan(-1);
    expect(advancedIndex).toBeGreaterThan(baseUrlIndex);
    expect(reasoningEffortIndex).toBeGreaterThan(advancedIndex);
    expect(profileIdIndex).toBeGreaterThan(advancedIndex);
    expect(temperatureIndex).toBeGreaterThan(advancedIndex);
  });
});

function createModelSettingsPanelProps(): Parameters<typeof ModelSettingsPanel>[0] {
  return {
    defaultProfileId: "model_default",
    selectedProfileId: "model_default",
    profiles: [
      {
        id: "model_default",
        provider: "openai-compatible",
        displayName: "Default Model",
        baseUrl: "https://api.example.com/v1",
        modelName: "example-model",
        apiKeyRef: "secret://model_default/api_key",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1,
        timeoutMs: 60000
      }
    ],
    draft: {
      id: "model_default",
      provider: "openai-compatible",
      displayName: "Default Model",
      baseUrl: "https://api.example.com/v1",
      modelName: "example-model",
      contextWindow: "",
      apiKeyRefInput: "",
      temperature: "0.7",
      maxTokens: "4096",
      topP: "1",
      reasoningEffortEnabled: false,
      timeoutMs: "60000"
    },
    saveStatus: "idle",
    providerOptions: [
      {
        id: "openai-compatible",
        label: "OpenAI Compatible",
        agentAdapter: "openai-compatible"
      }
    ]
  };
}
