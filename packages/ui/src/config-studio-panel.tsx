import { RotateCcw, Save } from "lucide-react";

export type ConfigStudioAssetType = "prompt" | "agent" | "workflow";
export type ConfigValidationStatus = "valid" | "invalid" | "dirty";

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
  readonly selectedAsset: ConfigStudioAsset;
  readonly versions: readonly ConfigStudioVersionEntry[];
  readonly onContentChange?: (nextContent: string) => void;
  readonly onSave?: () => void;
  readonly onRestoreVersion?: (versionId: string) => void;
}

export function ConfigStudioPanel({
  selectedAsset,
  versions,
  onContentChange,
  onSave,
  onRestoreVersion
}: ConfigStudioPanelProps) {
  return (
    <section className="config-studio-panel" aria-label="提示词 Agent 工作流创作系统">
      <header className="panel-header">
        <div>
          <h2>{selectedAsset.title}</h2>
          <p>{selectedAsset.assetType}</p>
        </div>
        <span>{validationLabel(selectedAsset.validationStatus)}</span>
        <button type="button" aria-label="保存配置资产" onClick={() => onSave?.()}>
          <Save aria-hidden="true" size={14} />
        </button>
      </header>
      <textarea
        aria-label={`${assetTypeLabel(selectedAsset.assetType)} JSON 编辑器`}
        value={selectedAsset.content}
        onChange={(event) => onContentChange?.(event.currentTarget.value)}
        readOnly={onContentChange === undefined}
      />
      <aside aria-label="配置版本历史">
        <h3>版本历史</h3>
        {versions.map((version) => (
          <article key={version.versionId}>
            <span>{version.label}</span>
            <time dateTime={version.createdAt}>{version.createdAt}</time>
            <button
              type="button"
              aria-label={`恢复配置版本 ${version.label}`}
              onClick={() => onRestoreVersion?.(version.versionId)}
            >
              <RotateCcw aria-hidden="true" size={14} />
            </button>
          </article>
        ))}
      </aside>
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
