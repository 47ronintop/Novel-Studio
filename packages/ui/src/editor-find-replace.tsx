import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Replace,
  ReplaceAll,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface EditorTextRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export type EditorFindMode = "closed" | "find" | "replace";

export interface EditorFindReplaceProps {
  readonly body: string;
  readonly mode: EditorFindMode;
  readonly onBodyChange?: ((nextBody: string) => void) | undefined;
  readonly onModeChange?: ((mode: EditorFindMode) => void) | undefined;
  readonly onRequestEditorFocus?: (() => void) | undefined;
  readonly onSelectionChange?:
    | ((selection: { readonly anchor: number; readonly head: number }) => void)
    | undefined;
}

export function EditorFindReplace({
  body,
  mode,
  onBodyChange,
  onModeChange,
  onRequestEditorFocus,
  onSelectionChange
}: EditorFindReplaceProps) {
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const matches = useMemo(
    () => findEditorMatches({ body, query, caseSensitive }),
    [body, caseSensitive, query]
  );
  const normalizedActiveMatchIndex =
    matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1);
  const activeMatch = matches[normalizedActiveMatchIndex];
  const replaceDisabled = onBodyChange === undefined || activeMatch === undefined;

  useEffect(() => {
    if (mode !== "closed") {
      queryInputRef.current?.focus();
    }
  }, [mode]);

  if (mode === "closed") {
    return null;
  }

  const close = () => {
    onModeChange?.("closed");
    onRequestEditorFocus?.();
  };

  const navigate = (direction: -1 | 1) => {
    if (matches.length === 0) {
      return;
    }

    const nextIndex =
      (normalizedActiveMatchIndex + direction + matches.length) % matches.length;
    const nextMatch = matches[nextIndex];
    setActiveMatchIndex(nextIndex);
    if (nextMatch !== undefined) {
      onSelectionChange?.({ anchor: nextMatch.startOffset, head: nextMatch.endOffset });
    }
  };

  const replaceCurrent = () => {
    const result = replaceCurrentEditorMatch({
      body,
      query,
      replacement,
      caseSensitive,
      activeMatchIndex: normalizedActiveMatchIndex
    });
    if (!result.replaced) {
      return;
    }

    onBodyChange?.(result.body);
    onSelectionChange?.(result.nextSelection);
  };

  const replaceAll = () => {
    const result = replaceAllEditorMatches({ body, query, replacement, caseSensitive });
    if (result.replaceCount > 0) {
      onBodyChange?.(result.body);
    }
  };

  return (
    <section
      className="ns-editor-find-replace"
      aria-label="查找替换"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="ns-editor-find-row">
        <button
          aria-label={mode === "replace" ? "隐藏替换" : "显示替换"}
          className="ns-icon-button"
          onClick={() => onModeChange?.(mode === "replace" ? "find" : "replace")}
          title={mode === "replace" ? "隐藏替换" : "显示替换"}
          type="button"
        >
          {mode === "replace" ? (
            <ChevronDown aria-hidden="true" size={14} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} />
          )}
        </button>
        <input
          aria-label="查找内容"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveMatchIndex(0);
          }}
          placeholder="查找"
          ref={queryInputRef}
          type="search"
          value={query}
        />
        <span className="ns-editor-find-count" aria-label="查找结果数量">
          {matches.length === 0 ? "0/0" : `${normalizedActiveMatchIndex + 1}/${matches.length}`}
        </span>
        <button
          aria-label="上一处"
          className="ns-icon-button"
          disabled={matches.length === 0}
          onClick={() => navigate(-1)}
          title="上一处"
          type="button"
        >
          <ChevronUp aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="下一处"
          className="ns-icon-button"
          disabled={matches.length === 0}
          onClick={() => navigate(1)}
          title="下一处"
          type="button"
        >
          <ChevronDown aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="区分大小写"
          aria-pressed={caseSensitive}
          className="ns-icon-button"
          onClick={() => {
            setCaseSensitive((current) => !current);
            setActiveMatchIndex(0);
          }}
          title="区分大小写"
          type="button"
        >
          <CaseSensitive aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="关闭查找替换"
          className="ns-icon-button"
          onClick={close}
          title="关闭查找替换"
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      {mode === "replace" ? (
        <div className="ns-editor-replace-row">
          <input
            aria-label="替换为"
            onChange={(event) => setReplacement(event.currentTarget.value)}
            placeholder="替换"
            type="text"
            value={replacement}
          />
          <button
            aria-label="替换当前"
            className="ns-icon-button"
            disabled={replaceDisabled}
            onClick={replaceCurrent}
            title="替换当前"
            type="button"
          >
            <Replace aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="全部替换"
            className="ns-icon-button"
            disabled={onBodyChange === undefined || matches.length === 0}
            onClick={replaceAll}
            title="全部替换"
            type="button"
          >
            <ReplaceAll aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function findEditorMatches(input: {
  readonly body: string;
  readonly query: string;
  readonly caseSensitive: boolean;
}): readonly EditorTextRange[] {
  if (input.query.length === 0) {
    return [];
  }

  const haystack = input.caseSensitive ? input.body : input.body.toLocaleLowerCase();
  const needle = input.caseSensitive ? input.query : input.query.toLocaleLowerCase();
  const matches: EditorTextRange[] = [];
  let nextStart = 0;

  while (nextStart <= haystack.length) {
    const index = haystack.indexOf(needle, nextStart);
    if (index < 0) {
      break;
    }

    matches.push({ startOffset: index, endOffset: index + input.query.length });
    nextStart = index + Math.max(needle.length, 1);
  }

  return matches;
}

export function replaceCurrentEditorMatch(input: {
  readonly body: string;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly activeMatchIndex: number;
}): {
  readonly body: string;
  readonly replaced: boolean;
  readonly nextSelection: { readonly anchor: number; readonly head: number };
} {
  const match = findEditorMatches(input)[input.activeMatchIndex];
  if (match === undefined) {
    return {
      body: input.body,
      replaced: false,
      nextSelection: { anchor: 0, head: 0 }
    };
  }

  return {
    body:
      input.body.slice(0, match.startOffset) +
      input.replacement +
      input.body.slice(match.endOffset),
    replaced: true,
    nextSelection: {
      anchor: match.startOffset,
      head: match.startOffset + input.replacement.length
    }
  };
}

export function replaceAllEditorMatches(input: {
  readonly body: string;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
}): {
  readonly body: string;
  readonly replaceCount: number;
} {
  const matches = findEditorMatches(input);
  if (matches.length === 0) {
    return { body: input.body, replaceCount: 0 };
  }

  let cursor = 0;
  let nextBody = "";
  for (const match of matches) {
    nextBody += input.body.slice(cursor, match.startOffset);
    nextBody += input.replacement;
    cursor = match.endOffset;
  }
  nextBody += input.body.slice(cursor);

  return {
    body: nextBody,
    replaceCount: matches.length
  };
}
