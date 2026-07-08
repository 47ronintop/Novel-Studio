import { AlignJustify, Maximize2, Search, Type } from "lucide-react";

export type EditorFontFamily = "mono" | "serif" | "sans";

export interface EditorPreferences {
  readonly fontFamily: EditorFontFamily;
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface WritingMetrics {
  readonly lineCount: number;
  readonly writingUnitCount: number;
  readonly readingTimeMinutes: number;
  readonly wordCountLabel: string;
  readonly readingTimeLabel: string;
}

export interface EditorToolbarProps {
  readonly metrics: WritingMetrics;
  readonly preferences: EditorPreferences;
  readonly findReplaceOpen: boolean;
  readonly onFindReplaceToggle?: () => void;
  readonly onFocusModeToggle?: () => void;
  readonly onPreferencesChange?: (preferences: EditorPreferences) => void;
}

const READING_UNITS_PER_MINUTE = 500;

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontFamily: "mono",
  fontSize: 13,
  lineHeight: 1.7
};

export function EditorToolbar({
  metrics,
  preferences,
  findReplaceOpen,
  onFindReplaceToggle,
  onFocusModeToggle,
  onPreferencesChange
}: EditorToolbarProps) {
  return (
    <section className="ns-editor-toolbar" aria-label="编辑器工具栏">
      <div className="ns-editor-toolbar-metrics" aria-label="写作统计">
        <span>{metrics.wordCountLabel}</span>
        <span>{metrics.readingTimeLabel}</span>
        <span>{metrics.lineCount} 行</span>
      </div>
      <div className="ns-editor-toolbar-actions">
        <button
          aria-label={findReplaceOpen ? "关闭查找替换" : "打开查找替换"}
          className="ns-icon-button"
          onClick={onFindReplaceToggle}
          title={findReplaceOpen ? "关闭查找替换" : "打开查找替换"}
          type="button"
        >
          <Search aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="切换专注模式"
          className="ns-icon-button"
          onClick={onFocusModeToggle}
          title="切换专注模式"
          type="button"
        >
          <Maximize2 aria-hidden="true" size={14} />
        </button>
        <label className="ns-editor-preference-control" title="编辑器字体">
          <Type aria-hidden="true" size={14} />
          <select
            aria-label="编辑器字体"
            onChange={(event) =>
              onPreferencesChange?.({
                ...preferences,
                fontFamily: event.currentTarget.value as EditorFontFamily
              })
            }
            value={preferences.fontFamily}
          >
            <option value="mono">Mono</option>
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
          </select>
        </label>
        <label className="ns-editor-preference-control" title="编辑器行高">
          <AlignJustify aria-hidden="true" size={14} />
          <select
            aria-label="编辑器行高"
            onChange={(event) =>
              onPreferencesChange?.({
                ...preferences,
                lineHeight: Number(event.currentTarget.value)
              })
            }
            value={preferences.lineHeight}
          >
            <option value={1.5}>1.5</option>
            <option value={1.7}>1.7</option>
            <option value={1.8}>1.8</option>
            <option value={2}>2.0</option>
          </select>
        </label>
      </div>
    </section>
  );
}

export function calculateWritingMetrics(body: string): WritingMetrics {
  const lineCount = body.length === 0 ? 1 : body.split("\n").length;
  const cjkCount = body.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWordCount = body.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  const writingUnitCount = cjkCount + englishWordCount;
  const readingTimeMinutes =
    writingUnitCount === 0
      ? 0
      : Math.max(1, Math.ceil(writingUnitCount / READING_UNITS_PER_MINUTE));

  return {
    lineCount,
    writingUnitCount,
    readingTimeMinutes,
    wordCountLabel: `${writingUnitCount} 字`,
    readingTimeLabel: `约 ${readingTimeMinutes} 分钟阅读`
  };
}

export function editorFontFamilyValue(fontFamily: EditorFontFamily): string {
  switch (fontFamily) {
    case "mono":
      return '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    case "serif":
      return '"Noto Serif SC", "Source Han Serif SC", Georgia, serif';
    case "sans":
      return 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif';
  }
}
