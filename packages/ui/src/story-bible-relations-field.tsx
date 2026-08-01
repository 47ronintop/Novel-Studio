import { Plus, Trash2 } from "lucide-react";

import {
  StoryBibleReferenceSelector,
  storyBibleEntryReferenceOptions
} from "./story-bible-reference-selector.js";
import type { StoryBibleEditorProps, StoryBibleEditorRelation } from "./workspace-shell-types.js";

const RELATION_TYPES = [
  { value: "story.related", label: "一般关联" },
  { value: "character.relationship", label: "人物关系" },
  { value: "world.contains", label: "归属 / 包含" },
  { value: "plot.depends-on", label: "情节依赖" },
  { value: "knowledge.about", label: "认知关联" }
] as const;

export function StoryBibleRelationsField({
  editor,
  label = "关联资料"
}: {
  readonly editor: StoryBibleEditorProps;
  readonly label?: string;
}) {
  const sourceId = editor.draft.id;
  if (sourceId === undefined) return null;
  const relations = [...(editor.draft.relations ?? [])];
  const targets = editor.entries.filter((entry) => entry.id !== sourceId);
  const openTarget = editor.dirty ? undefined : editor.onEntrySelect;
  const targetOptions = storyBibleEntryReferenceOptions(
    editor.entries,
    (entry) => entry.id !== sourceId,
    openTarget
  );
  const firstTarget = targets.find((entry) => entry.status !== "deleted");
  const ownedRelationIds = new Set(relations.map((relation) => relation.relationId));
  const derivedRelations = editor.entries.flatMap((entry) =>
    (entry.relations ?? []).flatMap((relation) =>
      relation.direction === "symmetric" &&
      relation.targetId === sourceId &&
      relation.sourceId !== sourceId &&
      !ownedRelationIds.has(relation.relationId)
        ? [
            {
              ...relation,
              sourceId,
              targetId: relation.sourceId,
              inversePolicy: "derived" as const
            }
          ]
        : []
    )
  );

  const publish = (next: readonly StoryBibleEditorRelation[]) => {
    editor.onDraftChange(editor.draft.kind, {
      relations: next,
      relatedEntityIds: [...new Set(next.map((relation) => relation.targetId))]
    });
  };
  const update = (index: number, patch: Partial<StoryBibleEditorRelation>) => {
    publish(
      relations.map((relation, relationIndex) =>
        relationIndex === index ? ({ ...relation, ...patch } as StoryBibleEditorRelation) : relation
      )
    );
  };

  return (
    <fieldset aria-label={label} className="ns-story-relations ns-story-field-wide">
      <legend>{label}</legend>
      <div className="ns-story-relation-list">
        {relations.map((relation, index) => {
          const target = editor.entries.find((entry) => entry.id === relation.targetId);
          return (
            <div
              className="ns-story-relation-row"
              data-target-state={
                target === undefined ? "missing" : target.status === "deleted" ? "deleted" : "ready"
              }
              key={relation.relationId}
            >
              <RelationSummary editor={editor} relation={relation} target={target} />
              <StoryBibleReferenceSelector
                ariaLabel={`关系目标 ${index + 1}`}
                label="目标"
                mode="single"
                onChange={(targetId) => {
                  if (targetId !== null) update(index, { targetId });
                }}
                onOpenEntry={openTarget}
                options={targetOptions}
                required
                value={relation.targetId}
              />
              <label>
                <span>关系</span>
                <select
                  aria-label={`关系类型 ${index + 1}`}
                  onChange={(event) => update(index, { relationType: event.currentTarget.value })}
                  value={relation.relationType}
                >
                  {RELATION_TYPES.some(
                    (option) => option.value === relation.relationType
                  ) ? null : (
                    <option value={relation.relationType}>{relation.relationType}</option>
                  )}
                  {RELATION_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {relation.direction !== "directed" ? null : (
                <label>
                  <span>反向关系</span>
                  <select
                    aria-label={`反向关系策略 ${index + 1}`}
                    onChange={(event) =>
                      update(index, {
                        inversePolicy:
                          event.currentTarget.value === "explicit" ? "explicit" : "none",
                        inverseRelationId:
                          event.currentTarget.value === "explicit" &&
                          relation.inversePolicy === "explicit"
                            ? relation.inverseRelationId
                            : null
                      })
                    }
                    value={relation.inversePolicy === "explicit" ? "explicit" : "none"}
                  >
                    <option value="none">仅当前方向</option>
                    <option value="explicit">显式双向（预览两端）</option>
                  </select>
                </label>
              )}
              <label>
                <span>方向</span>
                <select
                  aria-label={`关系方向 ${index + 1}`}
                  onChange={(event) => {
                    const direction = event.currentTarget.value as "directed" | "symmetric";
                    update(index, {
                      direction,
                      inversePolicy: direction === "symmetric" ? "derived" : "none",
                      inverseRelationId: null
                    });
                  }}
                  value={relation.direction}
                >
                  <option value="directed">单向</option>
                  <option value="symmetric">双向</option>
                </select>
              </label>
              <label>
                <span>状态</span>
                <select
                  aria-label={`关系状态 ${index + 1}`}
                  onChange={(event) =>
                    update(index, {
                      status: event.currentTarget.value as StoryBibleEditorRelation["status"]
                    })
                  }
                  value={relation.status}
                >
                  <option value="active">有效</option>
                  <option value="uncertain">不确定</option>
                  <option value="ended">已结束</option>
                </select>
              </label>
              <ChapterBoundarySelect
                ariaLabel={`关系生效章节 ${index + 1}`}
                chapters={editor.chapterOptions}
                label="开始"
                onChange={(validFromChapterId) => update(index, { validFromChapterId })}
                value={relation.validFromChapterId}
              />
              <ChapterBoundarySelect
                ariaLabel={`关系结束章节 ${index + 1}`}
                chapters={editor.chapterOptions}
                label="结束"
                onChange={(validToChapterId) => update(index, { validToChapterId })}
                value={relation.validToChapterId}
              />
              <label className="ns-story-relation-note">
                <span>备注</span>
                <input
                  aria-label={`关系备注 ${index + 1}`}
                  onChange={(event) => update(index, { note: event.currentTarget.value })}
                  value={relation.note}
                />
              </label>
              <button
                aria-label={`删除关系 ${index + 1}`}
                className="ns-icon-button ns-story-relation-remove"
                onClick={() =>
                  publish(relations.filter((_relation, relationIndex) => relationIndex !== index))
                }
                title="删除关系"
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          );
        })}
        {derivedRelations.map((relation, index) => {
          const target = editor.entries.find((entry) => entry.id === relation.targetId);
          return (
            <div
              className="ns-story-relation-row ns-story-relation-row-derived"
              data-relation-id={relation.relationId}
              data-relation-projection="derived"
              data-target-state={
                target === undefined ? "missing" : target.status === "deleted" ? "deleted" : "ready"
              }
              key={`derived:${relation.relationId}:${relation.targetId}`}
            >
              <RelationSummary editor={editor} relation={relation} target={target} derived />
              <StoryBibleReferenceSelector
                ariaLabel={`派生关系目标 ${index + 1}`}
                label="目标（派生只读）"
                mode="single"
                onChange={() => undefined}
                onOpenEntry={openTarget}
                options={targetOptions}
                readOnly
                required
                value={relation.targetId}
              />
              {relation.note.length === 0 ? null : (
                <p className="ns-story-relation-derived-note">{relation.note}</p>
              )}
            </div>
          );
        })}
      </div>
      {editor.dirty ? (
        <small className="ns-muted">请先保存或放弃当前草稿，再打开关系目标资料。</small>
      ) : null}
      <button
        className="ns-icon-text-button ns-story-relation-add"
        disabled={firstTarget === undefined}
        onClick={() => {
          if (firstTarget === undefined) return;
          publish([
            ...relations,
            {
              relationId: createRelationId(),
              sourceId,
              targetId: firstTarget.id,
              relationType: "story.related",
              direction: "directed",
              status: "active",
              validFromChapterId: null,
              validToChapterId: null,
              inversePolicy: "none",
              inverseRelationId: null,
              evidence: [],
              note: ""
            }
          ]);
        }}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
        添加关系
      </button>
    </fieldset>
  );
}

function RelationSummary({
  derived = false,
  editor,
  relation,
  target
}: {
  readonly derived?: boolean;
  readonly editor: StoryBibleEditorProps;
  readonly relation: StoryBibleEditorRelation;
  readonly target: StoryBibleEditorProps["entries"][number] | undefined;
}) {
  return (
    <header className="ns-story-relation-summary">
      <div>
        <strong>{target?.title || relation.targetId}</strong>
        {derived ? <span className="ns-story-relation-derived-badge">对称派生 · 只读</span> : null}
      </div>
      <dl>
        <div>
          <dt>目标类型</dt>
          <dd>{target?.assetType ?? "目标缺失"}</dd>
        </div>
        <div>
          <dt>关系类型</dt>
          <dd>{relationTypeLabel(relation.relationType)}</dd>
        </div>
        <div>
          <dt>方向</dt>
          <dd>{relation.direction === "symmetric" ? "双向" : "单向"}</dd>
        </div>
        <div>
          <dt>有效范围</dt>
          <dd>{relationRangeLabel(editor, relation)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{relationStatusLabel(relation.status)}</dd>
        </div>
      </dl>
    </header>
  );
}

function ChapterBoundarySelect({
  ariaLabel,
  chapters,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly chapters: StoryBibleEditorProps["chapterOptions"];
  readonly label: string;
  readonly onChange: (value: string | null) => void;
  readonly value: string | null;
}) {
  const missing = value !== null && !chapters.some((chapter) => chapter.id === value);
  return (
    <label>
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        value={value ?? ""}
      >
        <option value="">未设置</option>
        {missing ? <option value={value ?? ""}>{value}（章节缺失）</option> : null}
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.order}. {chapter.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function relationTypeLabel(value: string): string {
  return RELATION_TYPES.find((option) => option.value === value)?.label ?? value;
}

function relationStatusLabel(status: StoryBibleEditorRelation["status"]): string {
  return status === "active" ? "有效" : status === "ended" ? "已结束" : "不确定";
}

function relationRangeLabel(
  editor: StoryBibleEditorProps,
  relation: StoryBibleEditorRelation
): string {
  const chapterLabel = (chapterId: string) => {
    const chapter = editor.chapterOptions.find((option) => option.id === chapterId);
    return chapter === undefined
      ? `${chapterId}（章节缺失）`
      : `${chapter.order}. ${chapter.title}`;
  };
  const from = relation.validFromChapterId;
  const to = relation.validToChapterId;
  if (from === null && to === null) return "全程有效";
  if (from === null) return `至 ${chapterLabel(to ?? "")}`;
  if (to === null) return `自 ${chapterLabel(from)} 起`;
  return `${chapterLabel(from)} → ${chapterLabel(to)}`;
}

function createRelationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `rel_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
