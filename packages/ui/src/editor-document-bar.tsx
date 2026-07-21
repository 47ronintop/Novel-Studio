import { Maximize2, Save, Search, Sparkles, X } from "lucide-react";

export interface EditorDocumentTab {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly onSelect?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

export interface EditorDocumentBarProps {
  readonly tabs: readonly EditorDocumentTab[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly onSave?: (() => void) | undefined;
  readonly onFind?: (() => void) | undefined;
  readonly onFocusModeToggle?: (() => void) | undefined;
  readonly selectionAction?:
    | { readonly label: string; readonly onInvoke: () => void }
    | undefined;
}

export function EditorDocumentBar({
  tabs,
  dirty,
  saving,
  onSave,
  onFind,
  onFocusModeToggle,
  selectionAction
}: EditorDocumentBarProps) {
  return (
    <header className="ns-document-bar" aria-label="打开的文档">
      <div className="ns-document-tabs" role="tablist" aria-label="文档标签">
        {tabs.map((tab, index) => (
          <div
            className="ns-document-tab"
            data-active={tab.active}
            data-dirty={tab.dirty}
            key={tab.id}
          >
            <button
              aria-label={tab.label}
              aria-selected={tab.active}
              className="ns-document-tab-select"
              data-focus-order={index === 0 ? "3" : undefined}
              onClick={tab.onSelect}
              role="tab"
              title={`切换文档：${tab.label}`}
              type="button"
            >
              <span className="ns-document-tab-label">{tab.label}</span>
              {tab.dirty ? <span aria-label="未保存" className="ns-document-dirty-dot" /> : null}
            </button>
            {tab.onClose === undefined ? null : (
              <button
                aria-label={`关闭文档：${tab.label}`}
                className="ns-document-tab-close"
                onClick={tab.onClose}
                title={`关闭文档：${tab.label}`}
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="ns-document-actions">
        {selectionAction === undefined ? null : (
          <button
            aria-label={selectionAction.label}
            className="ns-document-selection-action"
            onClick={selectionAction.onInvoke}
            title={selectionAction.label}
            type="button"
          >
            <Sparkles aria-hidden="true" size={13} />
            <span>{selectionAction.label}</span>
          </button>
        )}
        {onFind === undefined ? null : (
          <button
            aria-label="查找当前文档"
            className="ns-icon-button"
            onClick={onFind}
            title="查找当前文档"
            type="button"
          >
            <Search aria-hidden="true" size={14} />
          </button>
        )}
        {onSave === undefined ? null : (
          <button
            aria-label="保存当前文档"
            className="ns-icon-button"
            disabled={!dirty || saving}
            onClick={onSave}
            title="保存当前文档"
            type="button"
          >
            <Save aria-hidden="true" size={14} />
          </button>
        )}
        {onFocusModeToggle === undefined ? null : (
          <button
            aria-label="切换专注模式"
            className="ns-icon-button"
            onClick={onFocusModeToggle}
            title="切换专注模式"
            type="button"
          >
            <Maximize2 aria-hidden="true" size={14} />
          </button>
        )}
      </div>
    </header>
  );
}

export function chapterDocumentLabel(title: string): string {
  return title.toLocaleLowerCase().endsWith(".md") ? title : `${title}.md`;
}
