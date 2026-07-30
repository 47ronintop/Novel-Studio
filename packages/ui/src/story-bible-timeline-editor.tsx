import type { JsonObject } from "@novel-studio/shared";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import {
  appendStoryBibleTimelineEvent,
  createStoryBibleTimelineEvent,
  readStoryBibleTimeline,
  updateStoryBibleTimelineEvent,
  type StoryBibleTimelineEvent
} from "./story-bible-timeline.js";
import type { StoryBibleEditorProps } from "./workspace-shell-types.js";

type TimelineSelection =
  { readonly kind: "root" } | { readonly kind: "event"; readonly id: string };

interface TimelineOption {
  readonly id: string;
  readonly label: string;
}

export function StoryBibleTimelineEditor({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "timeline") return null;
  return <TimelineEditor editor={editor as TimelineEditorProps} />;
}

type TimelineEditorProps = StoryBibleEditorProps & {
  readonly draft: Extract<StoryBibleEditorProps["draft"], { readonly kind: "timeline" }>;
};

function TimelineEditor({ editor }: { readonly editor: TimelineEditorProps }) {
  const [selection, setSelection] = useState<TimelineSelection>(() =>
    editor.activeTimelineEventId === undefined
      ? { kind: "root" }
      : { kind: "event", id: editor.activeTimelineEventId }
  );

  const model = readStoryBibleTimeline(editor.draft.details);
  const eventIdsKey = model.events.map((event) => event.id).join("\u0000");
  useEffect(() => {
    setSelection(
      editor.activeTimelineEventId === undefined
        ? { kind: "root" }
        : { kind: "event", id: editor.activeTimelineEventId }
    );
  }, [editor.activeTimelineEventId]);
  useEffect(() => {
    setSelection((current) => {
      if (current.kind === "event" && model.events.some((event) => event.id === current.id)) {
        return current;
      }
      return { kind: "root" };
    });
  }, [editor.draft.id, eventIdsKey]);

  const updateDetails = (details: JsonObject) => editor.onDraftChange("timeline", { details });
  const updateEvent = (eventId: string, patch: JsonObject) =>
    updateDetails(updateStoryBibleTimelineEvent(editor.draft.details, eventId, patch));
  const addEvent = () => {
    const event = createStoryBibleTimelineEvent(model.events, createTimelineIdentity());
    setSelection({ kind: "event", id: event.id });
    updateDetails(appendStoryBibleTimelineEvent(editor.draft.details, event));
  };

  const selectedEvent =
    selection.kind === "event"
      ? model.events.find((event) => event.id === selection.id)
      : undefined;

  return (
    <div className="ns-timeline-editor">
      <aside aria-label="时间线事件导航" className="ns-timeline-editor-nav">
        <div className="ns-timeline-editor-nav-header">
          <strong>事件</strong>
          <button aria-label="新增时间线事件" onClick={addEvent} title="新增事件" type="button">
            <Plus aria-hidden="true" size={15} />
          </button>
        </div>
        <button
          aria-current={selection.kind === "root" ? "page" : undefined}
          className="ns-timeline-root-button"
          onClick={() => setSelection({ kind: "root" })}
          type="button"
        >
          时间线设置
        </button>
        {model.events.length === 0 ? (
          <p className="ns-timeline-editor-empty">暂无事件</p>
        ) : (
          <ol className="ns-timeline-editor-event-list">
            {model.events.map((event, index) => (
              <li key={`${event.id}:${index}`}>
                <button
                  aria-current={
                    selection.kind === "event" && selection.id === event.id ? "page" : undefined
                  }
                  aria-label={`编辑时间线事件：${event.title}`}
                  className="ns-timeline-editor-event-button"
                  onClick={() => setSelection({ kind: "event", id: event.id })}
                  type="button"
                >
                  <span>{event.sequence}</span>
                  <strong>{event.title}</strong>
                  <small>{event.timeLabel || "未设置时间"}</small>
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <section aria-label="时间线详情" className="ns-timeline-editor-inspector">
        {selectedEvent === undefined ? (
          <TimelineRootFields editor={editor} />
        ) : (
          <TimelineEventFields
            editor={editor}
            event={selectedEvent}
            events={model.events}
            onUpdate={(patch) => updateEvent(selectedEvent.id, patch)}
          />
        )}
      </section>
    </div>
  );
}

function TimelineRootFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "timeline") return null;
  return (
    <div className="ns-timeline-detail-fields">
      <TimelineInspectorHeader eyebrow="单例资料" title={editor.draft.title || "时间线"} />
      <TimelineTextInput
        ariaLabel="时间线标题"
        label="标题"
        onChange={(title) => editor.onDraftChange("timeline", { title })}
        value={editor.draft.title}
      />
      <TimelineTextArea
        ariaLabel="时间线摘要"
        label="摘要"
        onChange={(summary) => editor.onDraftChange("timeline", { summary })}
        value={editor.draft.summary}
      />
      <label className="ns-story-field">
        <span>资料状态</span>
        <select
          aria-label="时间线资料状态"
          onChange={(event) =>
            editor.onDraftChange("timeline", {
              status: event.currentTarget.value as StoryBibleEditorProps["draft"]["status"]
            })
          }
          value={editor.draft.status}
        >
          <option value="active">启用</option>
          <option value="draft">草稿</option>
          <option value="archived">归档</option>
          <option value="deleted">已删除</option>
        </select>
      </label>
      <TimelineTextArea
        ariaLabel="时间线别名"
        label="别名"
        onChange={(value) => editor.onDraftChange("timeline", { aliases: splitLines(value) })}
        value={editor.draft.aliases.join("\n")}
      />
      <TimelineTextArea
        ariaLabel="时间线关联资料 ID"
        label="关联资料 ID"
        onChange={(value) =>
          editor.onDraftChange("timeline", { relatedEntityIds: splitLines(value) })
        }
        value={editor.draft.relatedEntityIds.join("\n")}
      />
    </div>
  );
}

function TimelineEventFields({
  editor,
  event,
  events,
  onUpdate
}: {
  readonly editor: StoryBibleEditorProps;
  readonly event: StoryBibleTimelineEvent;
  readonly events: readonly StoryBibleTimelineEvent[];
  readonly onUpdate: (patch: JsonObject) => void;
}) {
  const chapterOptions = editor.chapterOptions.map((chapter) => ({
    id: chapter.id,
    label: `${chapter.order}. ${chapter.title}`
  }));
  const characterOptions = editor.entries
    .filter((entry) => entry.kind === "character" && entry.status !== "deleted")
    .map((entry) => ({ id: entry.id, label: entry.title }));
  const locationOptions = editor.entries
    .filter(
      (entry) =>
        entry.kind === "world" && entry.assetType === "world.location" && entry.status !== "deleted"
    )
    .map((entry) => ({ id: entry.id, label: entry.title }));
  const eventOptions = events
    .filter((candidate) => candidate.id !== event.id)
    .map((candidate) => ({
      id: candidate.id,
      label: `${candidate.sequence}. ${candidate.title}`
    }));

  return (
    <div className="ns-timeline-detail-fields">
      <TimelineInspectorHeader
        eyebrow={event.timeLabel || `顺序 ${event.sequence}`}
        title={event.title}
      />
      <div className="ns-timeline-event-primary-fields">
        <TimelineTextInput
          ariaLabel="事件标题"
          label="事件标题"
          onChange={(title) => onUpdate({ title })}
          value={event.title}
        />
        <label className="ns-story-field">
          <span>顺序</span>
          <input
            aria-label="事件顺序"
            className="ns-search-input"
            min={1}
            onChange={(changeEvent) =>
              onUpdate({ sequence: Number(changeEvent.currentTarget.value) })
            }
            step={1}
            type="number"
            value={event.sequence}
          />
        </label>
        <TimelineTextInput
          ariaLabel="事件时间标签"
          label="时间标签"
          onChange={(timeLabel) => onUpdate({ timeLabel })}
          value={event.timeLabel}
        />
      </div>
      <TimelineTextArea
        ariaLabel="事件摘要"
        label="摘要"
        onChange={(summary) => onUpdate({ summary })}
        value={event.summary}
      />
      <div className="ns-timeline-relation-grid">
        <TimelineMultiSelect
          ariaLabel="事件关联章节"
          emptyLabel="暂无章节"
          onChange={(chapterIds) => onUpdate({ chapterIds })}
          options={chapterOptions}
          selectedIds={event.chapterIds}
        />
        <TimelineMultiSelect
          ariaLabel="事件关联人物"
          emptyLabel="暂无人物"
          onChange={(characterIds) => onUpdate({ characterIds })}
          options={characterOptions}
          selectedIds={event.characterIds}
        />
        <TimelineMultiSelect
          ariaLabel="事件关联地点"
          emptyLabel="暂无地点"
          onChange={(locationIds) => onUpdate({ locationIds })}
          options={locationOptions}
          selectedIds={event.locationIds}
        />
        <TimelineMultiSelect
          ariaLabel="事件前因"
          emptyLabel="暂无其他事件"
          onChange={(causes) => onUpdate({ causes })}
          options={eventOptions}
          selectedIds={event.causes}
        />
        <TimelineMultiSelect
          ariaLabel="事件后果"
          emptyLabel="暂无其他事件"
          onChange={(effects) => onUpdate({ effects })}
          options={eventOptions}
          selectedIds={event.effects}
        />
      </div>
      <span className="ns-muted">{event.id}</span>
    </div>
  );
}

function TimelineMultiSelect({
  ariaLabel,
  emptyLabel,
  onChange,
  options,
  selectedIds
}: {
  readonly ariaLabel: string;
  readonly emptyLabel: string;
  readonly onChange: (ids: string[]) => void;
  readonly options: readonly TimelineOption[];
  readonly selectedIds: readonly string[];
}) {
  const knownIds = new Set(options.map((option) => option.id));
  const missingIds = selectedIds.filter((id) => !knownIds.has(id));
  return (
    <label className="ns-story-field">
      <span>{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        className="ns-story-multi-select"
        multiple
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
        }
        size={Math.min(Math.max(options.length + missingIds.length, 2), 5)}
        value={[...selectedIds]}
      >
        {options.length === 0 && missingIds.length === 0 ? (
          <option disabled value="">
            {emptyLabel}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        {missingIds.map((id) => (
          <option key={id} value={id}>
            {id}（已不存在）
          </option>
        ))}
      </select>
    </label>
  );
}

function TimelineTextInput({
  ariaLabel,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="ns-story-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="ns-search-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function TimelineTextArea({
  ariaLabel,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="ns-story-field">
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        className="ns-story-textarea ns-story-textarea-compact"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function TimelineInspectorHeader({
  eyebrow,
  title
}: {
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <header className="ns-timeline-inspector-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function createTimelineIdentity(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .padEnd(32, "0")
    .slice(0, 32);
}
