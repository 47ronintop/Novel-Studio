import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ConfigStudioPanel, ModelSettingsPanel } from "../src/index.js";

describe("M8 Settings and Studio UI", () => {
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
        saveStatus="idle"
        onDraftChange={() => undefined}
        onNewProfile={() => undefined}
        onSelectProfile={() => undefined}
        onSaveProfile={() => undefined}
        onTestConnection={() => undefined}
        onMakeDefault={() => undefined}
      />
    );

    expect(html).toContain("Default Model");
    expect(html).toContain("设置");
    expect(html).toContain("模型配置");
    expect(html).toContain("隐私与安全");
    expect(html).toContain("自动保存与历史");
    expect(html).toContain("openai-compatible");
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
        selectedAsset={{
          assetType: "workflow",
          assetId: "wf_review_chapter",
          title: "Review Chapter",
          validationStatus: "valid",
          content: '{\n  "schemaVersion": "1.0"\n}'
        }}
        versions={[
          {
            versionId: "ver_before_save",
            label: "Before save",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        ]}
        onContentChange={() => undefined}
        onSave={() => undefined}
        onRestoreVersion={() => undefined}
      />
    );

    expect(html).toContain("Review Chapter");
    expect(html).toContain("workflow");
    expect(html).toContain("Schema 有效");
    expect(html).toContain('aria-label="保存配置资产"');
    expect(html).toContain('aria-label="恢复配置版本 Before save"');
    expect(html).not.toMatch(/filesystem|node:|fs\./i);
  });
});
