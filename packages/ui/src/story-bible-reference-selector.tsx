import { ExternalLink, Search, X } from "lucide-react";
import { useState } from "react";

import type { StoryBibleEditorEntry } from "./workspace-shell-types.js";

export type StoryBibleReferenceState = "ready" | "deleted" | "unknown" | "missing";

export interface StoryBibleReferenceOption {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status?: string;
  readonly state: StoryBibleReferenceState;
  readonly selectable?: boolean;
  readonly visible?: boolean;
  readonly openEntryId?: string;
  readonly onOpen?: (() => void) | undefined;
}

interface StoryBibleReferenceSelectorCommonProps {
  readonly ariaLabel: string;
  readonly label: string;
  readonly options: readonly StoryBibleReferenceOption[];
  readonly onOpenEntry?: ((entryId: string) => void) | undefined;
  readonly readOnly?: boolean;
  readonly wide?: boolean;
}

type StoryBibleReferenceSelectorProps = StoryBibleReferenceSelectorCommonProps &
  (
    | {
        readonly mode: "single";
        readonly onChange: (value: string | null) => void;
        readonly required?: boolean;
        readonly value: string | null;
      }
    | {
        readonly mode: "multiple";
        readonly onChange: (value: string[]) => void;
        readonly value: readonly string[];
      }
  );

export function StoryBibleReferenceSelector(props: StoryBibleReferenceSelectorProps) {
  const [query, setQuery] = useState("");
  const selectedIds =
    props.mode === "single" ? (props.value === null ? [] : [props.value]) : props.value;
  const selectedSet = new Set(selectedIds);
  const optionById = new Map(props.options.map((option) => [option.id, option]));
  const selectedOptions = selectedIds.map(
    (id): StoryBibleReferenceOption =>
      optionById.get(id) ?? {
        id,
        title: id,
        type: "unknown",
        state: "missing",
        selectable: false,
        visible: true
      }
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = props.options.filter((option) => {
    if (option.visible === false && !selectedSet.has(option.id)) return false;
    if (normalizedQuery.length === 0) return true;
    return referenceSearchText(option).includes(normalizedQuery);
  });

  const choose = (option: StoryBibleReferenceOption) => {
    if (option.selectable === false && !selectedSet.has(option.id)) return;
    if (props.mode === "single") {
      props.onChange(option.id);
      return;
    }
    props.onChange(
      selectedSet.has(option.id)
        ? selectedIds.filter((id) => id !== option.id)
        : [...selectedIds, option.id]
    );
  };
  const remove = (id: string) => {
    if (props.mode === "single") props.onChange(null);
    else props.onChange(selectedIds.filter((selectedId) => selectedId !== id));
  };

  return (
    <div
      aria-label={props.ariaLabel}
      className={`ns-story-reference-selector${props.wide === true ? " ns-story-field-wide" : ""}`}
      data-reference-mode={props.mode}
      role="group"
    >
      <span className="ns-story-reference-label">{props.label}</span>
      <div aria-label={`${props.ariaLabel}当前选择`} className="ns-story-reference-selection">
        {selectedOptions.length === 0 ? (
          <span className="ns-story-reference-empty">未选择</span>
        ) : (
          selectedOptions.map((option) => (
            <ReferenceSummary
              key={option.id}
              onOpenEntry={props.onOpenEntry}
              onRemove={
                props.readOnly === true || (props.mode === "single" && props.required === true)
                  ? undefined
                  : () => remove(option.id)
              }
              option={option}
            />
          ))
        )}
      </div>
      {props.readOnly === true ? null : (
        <details className="ns-story-reference-chooser">
          <summary aria-label={`${props.ariaLabel}选择器`}>
            {props.mode === "single" ? "选择或更改资料" : "添加或移除资料"}
          </summary>
          <label className="ns-story-reference-search">
            <Search aria-hidden="true" size={13} />
            <input
              aria-label={`${props.ariaLabel}搜索`}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索标题、类型或 ID"
              type="search"
              value={query}
            />
          </label>
          <div
            aria-label={`${props.ariaLabel}选项`}
            aria-multiselectable={props.mode === "multiple" ? true : undefined}
            className="ns-story-reference-options"
            role="listbox"
          >
            {visibleOptions.length === 0 ? (
              <p className="ns-story-reference-empty">没有匹配资料</p>
            ) : (
              visibleOptions.map((option) => {
                const selected = selectedSet.has(option.id);
                return (
                  <div
                    className="ns-story-reference-option"
                    data-reference-option={option.id}
                    data-reference-state={option.state}
                    key={option.id}
                    role="option"
                    aria-selected={selected}
                  >
                    <label>
                      <input
                        aria-label={`${props.ariaLabel}选项：${option.title || option.id}`}
                        checked={selected}
                        disabled={option.selectable === false && !selected}
                        name={props.mode === "single" ? props.ariaLabel : undefined}
                        onChange={() => choose(option)}
                        type={props.mode === "single" ? "radio" : "checkbox"}
                      />
                      <ReferenceText option={option} />
                    </label>
                    <OpenReferenceButton onOpenEntry={props.onOpenEntry} option={option} />
                  </div>
                );
              })
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function storyBibleEntryReferenceOptions(
  entries: readonly StoryBibleEditorEntry[],
  predicate: (entry: StoryBibleEditorEntry) => boolean,
  onOpenEntry?: (entryId: string) => void
): StoryBibleReferenceOption[] {
  return entries.map((entry) => {
    const compatible = predicate(entry);
    return {
      id: entry.id,
      title: entry.title || entry.id,
      type: entry.assetType,
      status: entry.status,
      state: compatible ? (entry.status === "deleted" ? "deleted" : "ready") : "unknown",
      selectable: compatible && entry.status !== "deleted",
      visible: compatible,
      openEntryId: entry.id,
      ...(onOpenEntry === undefined ? {} : { onOpen: () => onOpenEntry(entry.id) })
    };
  });
}

function ReferenceSummary({
  onOpenEntry,
  onRemove,
  option
}: {
  readonly onOpenEntry?: ((entryId: string) => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
  readonly option: StoryBibleReferenceOption;
}) {
  return (
    <div
      className="ns-story-reference-summary"
      data-reference-id={option.id}
      data-reference-state={option.state}
    >
      <ReferenceText option={option} />
      <div className="ns-story-reference-actions">
        <OpenReferenceButton onOpenEntry={onOpenEntry} option={option} />
        {onRemove === undefined ? null : (
          <button aria-label={`移除引用：${option.title}`} onClick={onRemove} type="button">
            <X aria-hidden="true" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function ReferenceText({ option }: { readonly option: StoryBibleReferenceOption }) {
  return (
    <span className="ns-story-reference-text">
      <strong>{option.title || option.id}</strong>
      <small>
        {storyBibleReferenceTypeLabel(option.type)} · {option.id}
      </small>
      <span className="ns-story-reference-state">{referenceStateLabel(option)}</span>
    </span>
  );
}

function OpenReferenceButton({
  onOpenEntry,
  option
}: {
  readonly onOpenEntry?: ((entryId: string) => void) | undefined;
  readonly option: StoryBibleReferenceOption;
}) {
  if (
    option.onOpen === undefined &&
    (onOpenEntry === undefined || option.openEntryId === undefined)
  ) {
    return null;
  }
  return (
    <button
      aria-label={`打开目标资料：${option.title || option.id}`}
      onClick={() => {
        if (option.onOpen !== undefined) option.onOpen();
        else onOpenEntry?.(option.openEntryId ?? option.id);
      }}
      title="打开目标资料"
      type="button"
    >
      <ExternalLink aria-hidden="true" size={13} />
    </button>
  );
}

function referenceSearchText(option: StoryBibleReferenceOption): string {
  return [
    option.id,
    option.title,
    option.type,
    option.status ?? "",
    storyBibleReferenceTypeLabel(option.type),
    referenceStateLabel(option)
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function referenceStateLabel(option: StoryBibleReferenceOption): string {
  if (option.state === "deleted") return "已删除";
  if (option.state === "unknown") return "目标类型不匹配";
  if (option.state === "missing") return "目标缺失";
  switch (option.status) {
    case "active":
      return "启用";
    case "draft":
      return "草稿";
    case "archived":
      return "归档";
    default:
      return option.status ?? "可用";
  }
}

function storyBibleReferenceTypeLabel(type: string): string {
  const labels: Readonly<Record<string, string>> = {
    character: "人物",
    outline: "大纲",
    foreshadow: "伏笔",
    "timeline.events": "时间线",
    "timeline.event": "时间线事件",
    chapter: "章节",
    "world.location": "地点",
    "world.faction": "势力",
    "world.rule": "规则",
    "world.glossary": "术语",
    "world.item": "物品",
    "world.lore": "背景设定"
  };
  return labels[type] ?? type;
}
