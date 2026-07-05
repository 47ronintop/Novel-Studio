import { Boxes, RotateCcw, Save } from "lucide-react";

export type ConfigStudioAssetType = "prompt" | "agent" | "workflow";
export type ConfigValidationStatus = "valid" | "invalid" | "dirty";
export type ConfigStudioStatus = "idle" | "loading" | "saving" | "saved" | "restoring" | "error";

export interface ConfigStudioAssetSummary {
  readonly assetType: ConfigStudioAssetType;
  readonly assetId: string;
  readonly title: string;
}

export interface ConfigStudioAsset {
  readonly assetType: ConfigStudioAssetType;
  readonly assetId: string;
  readonly title: string;
  readonly validationStatus: ConfigValidationStatus;
  readonly content: string;
}

export interface ConfigStudioVersionEntry {
  readonly versionId: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface ConfigStudioPanelProps {
  readonly assets: readonly ConfigStudioAssetSummary[];
  readonly selectedAsset: ConfigStudioAsset;
  readonly versions: readonly ConfigStudioVersionEntry[];
  readonly status: ConfigStudioStatus;
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string };
  readonly onAssetSelect?: (assetType: ConfigStudioAssetType, assetId: string) => void;
  readonly onContentChange?: (nextContent: string) => void;
  readonly onSave?: () => void;
  readonly onRestoreVersion?: (versionId: string) => void;
}

export function ConfigStudioPanel({
  assets,
  selectedAsset,
  versions,
  status,
  feedback,
  onAssetSelect,
  onContentChange,
  onSave,
  onRestoreVersion
}: ConfigStudioPanelProps) {
  return (
    <section className="config-studio-panel" aria-label="创作系统工作台">
      <header className="config-studio-header">
        <div>
          <h1>创作系统</h1>
          <p>
            编辑 Prompt、Agent 和 Workflow JSON。保存前会通过 Application/Repository 进行 schema
            校验。
          </p>
        </div>
        <span className="config-studio-status">{statusLabel(status)}</span>
      </header>

      <div className="config-studio-grid">
        <aside className="config-studio-assets" aria-label="配置资产列表">
          <div className="config-studio-section-title">
            <Boxes aria-hidden="true" size={14} />
            <span>配置资产</span>
          </div>
          {assets.map((asset) => {
            const selected =
              asset.assetType === selectedAsset.assetType &&
              asset.assetId === selectedAsset.assetId;
            return (
              <button
                aria-label={`选择配置资产 ${asset.title}`}
                className="config-studio-asset-button"
                data-asset-type={asset.assetType}
                data-selected={selected}
                key={`${asset.assetType}:${asset.assetId}`}
                onClick={() => onAssetSelect?.(asset.assetType, asset.assetId)}
                type="button"
              >
                <span>{asset.title}</span>
                <span>{assetTypeLabel(asset.assetType)}</span>
              </button>
            );
          })}
        </aside>

        <main className="config-studio-editor" aria-label="配置资产编辑器">
          <div className="config-studio-editor-header">
            <div>
              <h2>{selectedAsset.title}</h2>
              <p>
                {assetTypeLabel(selectedAsset.assetType)} · {selectedAsset.assetId}
              </p>
            </div>
            <span>{validationLabel(selectedAsset.validationStatus)}</span>
            <button
              className="ns-icon-text-button"
              disabled={status === "saving" || selectedAsset.validationStatus === "invalid"}
              type="button"
              aria-label="保存配置资产"
              onClick={() => onSave?.()}
            >
              <Save aria-hidden="true" size={14} />
              {status === "saving" ? "保存中" : "保存配置资产"}
            </button>
          </div>
          {feedback === undefined ? null : (
            <p className="ns-project-feedback" data-kind={feedback.kind} role="status">
              {feedback.message}
            </p>
          )}
          <textarea
            aria-label={`${assetTypeLabel(selectedAsset.assetType)} JSON 编辑器`}
            value={selectedAsset.content}
            onChange={(event) => onContentChange?.(event.currentTarget.value)}
            readOnly={onContentChange === undefined}
          />
        </main>

        <aside className="config-studio-versions" aria-label="配置版本历史">
          <h3>版本历史</h3>
          {versions.length === 0 ? (
            <p>保存后会在这里显示可恢复的历史快照。</p>
          ) : (
            versions.map((version) => (
              <article key={version.versionId}>
                <span>{version.label}</span>
                <time dateTime={version.createdAt}>{formatDate(version.createdAt)}</time>
                <button
                  type="button"
                  aria-label={`恢复配置版本 ${version.label}`}
                  onClick={() => onRestoreVersion?.(version.versionId)}
                >
                  <RotateCcw aria-hidden="true" size={14} />
                </button>
              </article>
            ))
          )}
        </aside>
      </div>
    </section>
  );
}

function validationLabel(status: ConfigValidationStatus): string {
  switch (status) {
    case "valid":
      return "Schema 有效";
    case "invalid":
      return "Schema 无效";
    case "dirty":
      return "有未保存修改";
  }
}

function assetTypeLabel(assetType: ConfigStudioAssetType): string {
  switch (assetType) {
    case "prompt":
      return "提示词";
    case "agent":
      return "Agent";
    case "workflow":
      return "工作流";
  }
}

function statusLabel(status: ConfigStudioStatus): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "loading":
      return "加载中";
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "restoring":
      return "恢复中";
    case "error":
      return "需要处理";
  }
}

function formatDate(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}
