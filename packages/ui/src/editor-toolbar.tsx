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

const READING_UNITS_PER_MINUTE = 500;

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontFamily: "mono",
  fontSize: 13,
  lineHeight: 1.7
};

export function calculateWritingMetrics(body: string): WritingMetrics {
  const lineCount = body.length === 0 ? 1 : body.split("\n").length;
  const cjkCount = body.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWordCount = body.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0;
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
