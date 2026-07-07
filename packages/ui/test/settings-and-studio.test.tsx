import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ConfigStudioPanel, ModelSettingsPanel } from "../src/index.js";

describe("M8 Settings and Studio UI", () => {
  test("renders VSCode-like settings tabs with scoped writing and appearance panels", () => {
    const appearanceHtml = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="appearance"
        appearancePreferences={{
          theme: "dark",
          density: "compact",
          editor: {
            fontFamily: "serif",
            fontSize: 16,
            lineHeight: 1.8
          }
        }}
      />
    );
    const writingHtml = renderToStaticMarkup(
      <ModelSettingsPanel
        {...createModelSettingsPanelProps()}
        activeSection="writing"
        writingPreferences={{
          autosaveEnabled: true,
          historyPolicy: "manual-and-interval",
          styleRules: {
            enabled: true,
            strength: "standard",
            customCautionTerms: ["显而易见", "不可否认"]
          }
        }}
      />
    );

    expect(appearanceHtml).toContain('aria-label="设置分类"');
    expect(appearanceHtml).toContain('aria-current="page"');
    expect(appearanceHtml).toContain("模型");
    expect(appearanceHtml).toContain("写作");
    expect(appearanceHtml).toContain("外观");
    expect(appearanceHtml).toContain("插件");
    expect(appearanceHtml).toContain("高级");
    expect(appearanceHtml).toContain('aria-label="外观设置"');
    expect(appearanceHtml).toContain("深色");
    expect(appearanceHtml).toContain("紧凑");
    expect(appearanceHtml).toContain("serif");
    expect(appearanceHtml).toContain("16px");
    expect(appearanceHtml).toContain("1.8");
    expect(appearanceHtml).not.toContain('aria-label="模型配置"');

    expect(writingHtml).toContain('aria-label="写作设置"');
    expect(writingHtml).toContain("自动保存已启用");
    expect(writingHtml).toContain("manual-and-interval");
    expect(writingHtml).toContain("文风规则已启用");
    expect(writingHtml).toContain("写作质量");
    expect(writingHtml).toContain("项目语气");
    expect(writingHtml).toContain("显而易见");
    expect(writingHtml).not.toMatch(/检测规避|过检测/);
  });

  test("renders model profile settings without plaintext secrets", () => {
    const html = renderToStaticMarkup(
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
          apiKeyRefInput: "",
          temperature: "0.7",
          maxTokens: "4096",
          topP: "1",
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

    expect(html).toContain("Default Model");
    expect(html).toContain("Timeline Tools");
    expect(html).toContain("1.2.3");
    expect(html).toContain("timeline.rail");
    expect(html).toContain("timeline.open-map");
    expect(html).toContain('aria-label="Disable plugin Timeline Tools"');
    expect(html).toContain("设置");
    expect(html).toContain("模型配置");
    expect(html).toContain("隐私与安全");
    expect(html).toContain("自动保存与历史");
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
    expect(html).toContain("保存模型配置");
    expect(html).toContain("新建模型");
    expect(html).toContain('aria-label="测试连接 Default Model"');
    expect(html).not.toContain("secret://model_default/api_key");
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]+/);
    expect(html).not.toMatch(/filesystem|node:|fs\./i);
  });

  test("renders Prompt Agent Workflow studio controls through callback-driven props", () => {
    const html = renderToStaticMarkup(
      <ConfigStudioPanel
        assets={[
          {
            assetType: "prompt",
            assetId: "prompt_reviewer_default",
            title: "Reviewer Prompt"
          },
          {
            assetType: "agent",
            assetId: "agent_reviewer_default",
            title: "Reviewer Agent"
          },
          {
            assetType: "workflow",
            assetId: "wf_review_chapter",
            title: "Review Chapter"
          }
        ]}
        selectedAsset={{
          assetType: "workflow",
          assetId: "wf_review_chapter",
          title: "Review Chapter",
          validationStatus: "valid",
          content: '{\n  "schemaVersion": "1.0"\n}',
          workflowGraph: {
            graph: {
              workflowId: "wf_review_chapter",
              title: "Review Chapter",
              entryNodeId: "context",
              nodes: [
                {
                  id: "context",
                  stepId: "context",
                  kind: "context",
                  label: "context",
                  metadata: {}
                },
                {
                  id: "save",
                  stepId: "save",
                  kind: "save",
                  label: "save",
                  metadata: {}
                }
              ],
              edges: [
                {
                  id: "context:next:save",
                  fromNodeId: "context",
                  toNodeId: "save",
                  kind: "next"
                }
              ]
            },
            validation: {
              status: "invalid",
              issues: [
                {
                  code: "WORKFLOW_GRAPH_NODE_UNREACHABLE",
                  severity: "error",
                  stepId: "save",
                  message: "Workflow step is not reachable from the entry step."
                }
              ]
            },
            layout: {
              schemaVersion: "1.0",
              source: "draft",
              viewport: { x: 0, y: 0, zoom: 1 },
              nodes: [
                { nodeId: "context", x: 0, y: 0 },
                { nodeId: "save", x: 240, y: 80 }
              ]
            }
          }
        }}
        selectedWorkflowNodeId="save"
        selectedWorkflowEdgeId="context:next:save"
        versions={[
          {
            versionId: "ver_before_save",
            label: "Before save",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        ]}
        status="idle"
        onAssetSelect={() => undefined}
        onContentChange={() => undefined}
        onWorkflowNodeSelect={() => undefined}
        onWorkflowEdgeSelect={() => undefined}
        onWorkflowSemanticEdit={() => undefined}
        onWorkflowNodeDragCommit={() => undefined}
        onSave={() => undefined}
        onRestoreVersion={() => undefined}
      />
    );

    expect(html).toContain("创作系统");
    expect(html).toContain("提示词");
    expect(html).toContain("Agent");
    expect(html).toContain("工作流");
    expect(html).toContain("Review Chapter");
    expect(html).toContain("workflow");
    expect(html).toContain("Schema 有效");
    expect(html).toContain("JSON 编辑器");
    expect(html).toContain('aria-label="保存配置资产"');
    expect(html).toContain('aria-label="恢复配置版本 Before save"');
    expect(html).toContain('aria-label="选择配置资产 Reviewer Prompt"');
    expect(html).toContain('aria-label="Workflow graph preview"');
    expect(html).toContain('aria-label="工作流画布暂不可编辑"');
    expect(html).toContain("节点 2");
    expect(html).toContain("连线 1");
    expect(html).toContain('data-canvas-x="240"');
    expect(html).toContain('data-canvas-y="80"');
    expect(html).toContain('style="--canvas-x:240px;--canvas-y:80px"');
    expect(html).toContain('aria-label="Move workflow node save right"');
    expect(html).toContain('aria-label="Commit workflow node drag save"');
    expect(html).toContain('aria-label="Select workflow node context"');
    expect(html).toContain('aria-label="Select workflow node save"');
    expect(html).toContain('aria-label="Select workflow edge context:next:save"');
    expect(html).toContain('data-selected-node="true"');
    expect(html).toContain('data-selected-edge="true"');
    expect(html).toContain("context → save");
    expect(html).toContain("校验：有问题");
    expect(html).toContain('aria-label="Workflow node inspector"');
    expect(html).toContain("当前节点：save");
    expect(html).toContain("类型：保存");
    expect(html).toContain('aria-label="Workflow node next step"');
    expect(html).toContain('aria-label="Add confirmation node after save"');
    expect(html).toContain('aria-label="Workflow new node kind"');
    expect(html).toContain('aria-label="Add selected workflow node kind after save"');
    expect(html).toContain('aria-label="Workflow edge retarget target"');
    expect(html).toContain('aria-label="Retarget workflow edge context:next:save"');
    expect(html).toContain('aria-label="Workflow branch label"');
    expect(html).toContain('aria-label="Workflow branch condition"');
    expect(html).toContain('aria-label="Apply workflow branch edit for save"');
    expect(html).toContain('aria-label="Confirm delete workflow node save"');
    expect(html).toContain('aria-label="Delete workflow node save"');
    expect(html).toContain('name="nextStepId"');
    expect(html).toContain("入站 context → save");
    expect(html).toContain("WORKFLOW_GRAPH_NODE_UNREACHABLE");
    expect(html).toContain("Workflow step is not reachable from the entry step.");
    expect(html).not.toMatch(/filesystem|node:|fs\./i);
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
      apiKeyRefInput: "",
      temperature: "0.7",
      maxTokens: "4096",
      topP: "1",
      timeoutMs: "60000"
    },
    saveStatus: "idle",
    providerOptions: [{ id: "openai-compatible", label: "OpenAI Compatible" }]
  };
}
