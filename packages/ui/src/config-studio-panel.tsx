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
    <section className="config-studio-panel" aria-label="Prompt Agent Workflow Studio">
      <header className="panel-header">
        <div>
          <h2>{selectedAsset.title}</h2>
          <p>{selectedAsset.assetType}</p>
        </div>
        <span>{validationLabel(selectedAsset.validationStatus)}</span>
        <button type="button" aria-label="Save config asset" onClick={() => onSave?.()}>
          <Save aria-hidden="true" size={14} />
        </button>
      </header>
      <textarea
        aria-label={`${selectedAsset.assetType} JSON editor`}
        value={selectedAsset.content}
        onChange={(event) => onContentChange?.(event.currentTarget.value)}
        readOnly={onContentChange === undefined}
      />
      <aside aria-label="Config version history">
        <h3>Version history</h3>
        {versions.map((version) => (
          <article key={version.versionId}>
            <span>{version.label}</span>
            <time dateTime={version.createdAt}>{version.createdAt}</time>
            <button
              type="button"
              aria-label={`Restore config version ${version.label}`}
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
      return "Schema valid";
    case "invalid":
      return "Schema invalid";
    case "dirty":
      return "Unsaved changes";
  }
}
