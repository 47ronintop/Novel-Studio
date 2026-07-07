import { ChevronDown, ChevronUp, CaseSensitive, Replace, ReplaceAll } from "lucide-react";
import { useMemo, useState } from "react";

export interface EditorTextRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface EditorFindReplaceProps {
  readonly body: string;
  readonly open: boolean;
  readonly onBodyChange?: (nextBody: string) => void;
  readonly onSelectionChange?: (selection: {
    readonly anchor: number;
    readonly head: number;
  }) => void;
}

export function EditorFindReplace({
  body,
  open,
  onBodyChange,
  onSelectionChange
}: EditorFindReplaceProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const matches = useMemo(
    () => findEditorMatches({ body, query, caseSensitive }),
    [body, caseSensitive, query]
  );
  const activeMatch = matches[activeMatchIndex] ?? matches[0];
  const replaceDisabled = onBodyChange === undefined || activeMatch === undefined;

  if (!open) {
    return null;
  }

  const navigate = (direction: -1 | 1) => {
    if (matches.length === 0) {
      return;
    }

    const nextIndex = (activeMatchIndex + direction + matches.length) % matches.length;
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
      activeMatchIndex
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
    <section className="ns-editor-find-replace" aria-label="查找替换">
      <input
        aria-label="查找内容"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActiveMatchIndex(0);
        }}
        placeholder="Find"
        type="search"
        value={query}
      />
      <input
        aria-label="替换为"
        onChange={(event) => setReplacement(event.currentTarget.value)}
        placeholder="Replace"
        type="text"
        value={replacement}
      />
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
      <label className="ns-editor-case-toggle" title="区分大小写">
        <input
          aria-label="区分大小写"
          checked={caseSensitive}
          onChange={(event) => {
            setCaseSensitive(event.currentTarget.checked);
            setActiveMatchIndex(0);
          }}
          type="checkbox"
        />
        <CaseSensitive aria-hidden="true" size={14} />
      </label>
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
      <span className="ns-editor-find-count" aria-label="查找结果数量">
        {matches.length === 0 ? "0/0" : `${activeMatchIndex + 1}/${matches.length}`}
      </span>
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
