import { ArrowDown, ArrowUp, FolderPlus, Plus, Trash2, Unlink } from "lucide-react";
import { useState } from "react";

import {
  readStoryBibleOutline,
  type StoryBibleChapterOutline,
  type StoryBibleOutlineModel,
  type StoryBibleOutlineVolume
} from "./story-bible-outline.js";
import type { StoryBibleEditorProps } from "./workspace-shell-types.js";

type OutlineSelection =
  | { readonly kind: "root" }
  | { readonly kind: "volume"; readonly volumeIndex: number }
  | {
      readonly kind: "chapter";
      readonly chapterId: string;
      readonly volumeIndex?: number;
      readonly chapterIndex?: number;
    };

interface OutlineVolumePatch {
  readonly title?: string;
  readonly summary?: string;
  readonly chapterIds?: string[];
}

interface OutlineChapterPatch {
  readonly goal?: string;
  readonly conflict?: string;
  readonly turningPoints?: string[];
  readonly notes?: string;
}

export function StoryBibleOutlineEditor({ editor }: { readonly editor: StoryBibleEditorProps }) {
  const [selection, setSelection] = useState<OutlineSelection>({ kind: "root" });
  const [chapterToAdd, setChapterToAdd] = useState("");
  if (editor.draft.kind !== "outline") return null;

  const model = readStoryBibleOutline(editor.draft.details);
  const chapterById = new Map(editor.chapterOptions.map((chapter) => [chapter.id, chapter]));
  const assignedChapterIds = new Set(model.volumes.flatMap((volume) => volume.chapterIds));
  const unassignedChapters = editor.chapterOptions.filter(
    (chapter) => !assignedChapterIds.has(chapter.id)
  );
  const missingUnassignedIds = uniqueStrings(
    model.chapterOutlines
      .map((outline) => outline.chapterId)
      .filter((chapterId) => !chapterById.has(chapterId) && !assignedChapterIds.has(chapterId))
  );

  const updateDetails = (details: StoryBibleEditorProps["draft"]["details"]) =>
    editor.onDraftChange("outline", { details });
  const updateVolumes = (volumes: readonly StoryBibleOutlineVolume[]) =>
    updateDetails({ volumes: [...volumes] });
  const updateVolume = (volumeIndex: number, patch: OutlineVolumePatch) => {
    updateVolumes(
      model.volumes.map((volume, index) =>
        index === volumeIndex ? { ...volume, ...patch } : volume
      )
    );
  };
  const moveVolume = (volumeIndex: number, offset: -1 | 1) => {
    const targetIndex = volumeIndex + offset;
    if (targetIndex < 0 || targetIndex >= model.volumes.length) return;
    const volumes = [...model.volumes];
    const [volume] = volumes.splice(volumeIndex, 1);
    if (volume === undefined) return;
    volumes.splice(targetIndex, 0, volume);
    setSelection({ kind: "volume", volumeIndex: targetIndex });
    updateVolumes(volumes);
  };
  const addVolume = () => {
    const volume: StoryBibleOutlineVolume = {
      id: nextVolumeId(model.volumes),
      title: `第${model.volumes.length + 1}卷`,
      summary: "",
      chapterIds: []
    };
    setSelection({ kind: "volume", volumeIndex: model.volumes.length });
    updateVolumes([...model.volumes, volume]);
  };
  const addChapterToVolume = (volumeIndex: number, chapterId: string) => {
    if (chapterId.length === 0 || !chapterById.has(chapterId)) return;
    const volumes = model.volumes.map((volume, index) => ({
      ...volume,
      chapterIds:
        index === volumeIndex
          ? [...volume.chapterIds.filter((id) => id !== chapterId), chapterId]
          : volume.chapterIds.filter((id) => id !== chapterId)
    }));
    const chapterIndex = volumes[volumeIndex]?.chapterIds.indexOf(chapterId);
    setSelection({
      kind: "chapter",
      chapterId,
      volumeIndex,
      ...(chapterIndex === undefined || chapterIndex < 0 ? {} : { chapterIndex })
    });
    setChapterToAdd("");
    updateVolumes(volumes);
  };
  const removeChapterFromVolume = (volumeIndex: number, chapterIndex: number) => {
    const volume = model.volumes[volumeIndex];
    if (volume === undefined || volume.chapterIds[chapterIndex] === undefined) return;
    updateVolume(volumeIndex, {
      chapterIds: volume.chapterIds.filter((_chapterId, index) => index !== chapterIndex)
    });
    setSelection({ kind: "volume", volumeIndex });
  };
  const updateChapterOutline = (chapterId: string, patch: OutlineChapterPatch) => {
    const existingIndex = model.chapterOutlines.findIndex(
      (outline) => outline.chapterId === chapterId
    );
    const chapterOutlines =
      existingIndex < 0
        ? [...model.chapterOutlines, { chapterId, ...patch }]
        : model.chapterOutlines.map((outline, index) =>
            index === existingIndex ? { ...outline, ...patch, chapterId } : outline
          );
    updateDetails({ chapterOutlines });
  };
  const removeMissingChapter = (chapterId: string, fallbackVolumeIndex?: number) => {
    updateDetails({
      volumes: model.volumes.map((volume) => ({
        ...volume,
        chapterIds: volume.chapterIds.filter((id) => id !== chapterId)
      })),
      chapterOutlines: model.chapterOutlines.filter((outline) => outline.chapterId !== chapterId)
    });
    setSelection(
      fallbackVolumeIndex === undefined
        ? { kind: "root" }
        : { kind: "volume", volumeIndex: fallbackVolumeIndex }
    );
  };

  return (
    <div className="ns-outline-workspace">
      <aside aria-label="大纲卷章树" className="ns-outline-tree">
        <div className="ns-outline-tree-header">
          <strong>卷章</strong>
          <button aria-label="新增卷" onClick={addVolume} title="新增卷" type="button">
            <FolderPlus aria-hidden="true" size={15} />
          </button>
        </div>
        <button
          aria-current={selection.kind === "root" ? "page" : undefined}
          className="ns-outline-root-button"
          onClick={() => setSelection({ kind: "root" })}
          type="button"
        >
          大纲设置
        </button>
        {model.volumes.length === 0 ? (
          <p className="ns-outline-empty">暂无卷</p>
        ) : (
          <ol className="ns-outline-volume-list">
            {model.volumes.map((volume, volumeIndex) => (
              <li key={`${volume.id}:${volumeIndex}`}>
                <div className="ns-outline-volume-row">
                  <button
                    aria-current={
                      selection.kind === "volume" && selection.volumeIndex === volumeIndex
                        ? "page"
                        : undefined
                    }
                    aria-label={`打开卷：${volume.title}`}
                    className="ns-outline-node-button"
                    onClick={() => setSelection({ kind: "volume", volumeIndex })}
                    type="button"
                  >
                    <strong>{volume.title}</strong>
                    {volume.summary.length > 0 ? <small>{volume.summary}</small> : null}
                  </button>
                  <span className="ns-outline-node-actions">
                    <button
                      aria-label={`上移卷：${volume.title}`}
                      disabled={volumeIndex === 0}
                      onClick={() => moveVolume(volumeIndex, -1)}
                      title="上移卷"
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={13} />
                    </button>
                    <button
                      aria-label={`下移卷：${volume.title}`}
                      disabled={volumeIndex === model.volumes.length - 1}
                      onClick={() => moveVolume(volumeIndex, 1)}
                      title="下移卷"
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={13} />
                    </button>
                  </span>
                </div>
                {volume.chapterIds.length === 0 ? null : (
                  <ol className="ns-outline-chapter-list">
                    {volume.chapterIds.map((chapterId, chapterIndex) => {
                      const chapter = chapterById.get(chapterId);
                      const title = chapter?.title ?? chapterId;
                      const selected =
                        selection.kind === "chapter" &&
                        selection.volumeIndex === volumeIndex &&
                        selection.chapterIndex === chapterIndex;
                      return (
                        <li key={`${chapterId}:${chapterIndex}`}>
                          <button
                            aria-current={selected ? "page" : undefined}
                            aria-label={`打开章纲：${title}`}
                            className="ns-outline-chapter-button"
                            data-missing={chapter === undefined}
                            onClick={() =>
                              setSelection({
                                kind: "chapter",
                                chapterId,
                                volumeIndex,
                                chapterIndex
                              })
                            }
                            type="button"
                          >
                            <span>{chapterLabel(chapterId, chapter)}</span>
                            {chapter === undefined ? <small>章节已不存在</small> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        )}
        <section className="ns-outline-unassigned" aria-label="未归卷章节">
          <strong>未归卷</strong>
          {unassignedChapters.length === 0 && missingUnassignedIds.length === 0 ? (
            <p className="ns-outline-empty">暂无章节</p>
          ) : (
            <ol className="ns-outline-chapter-list">
              {unassignedChapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    aria-current={
                      selection.kind === "chapter" &&
                      selection.volumeIndex === undefined &&
                      selection.chapterId === chapter.id
                        ? "page"
                        : undefined
                    }
                    aria-label={`打开章纲：${chapter.title}`}
                    className="ns-outline-chapter-button"
                    onClick={() => setSelection({ kind: "chapter", chapterId: chapter.id })}
                    type="button"
                  >
                    <span>{chapterLabel(chapter.id, chapter)}</span>
                  </button>
                </li>
              ))}
              {missingUnassignedIds.map((chapterId) => (
                <li key={chapterId}>
                  <button
                    aria-current={
                      selection.kind === "chapter" && selection.chapterId === chapterId
                        ? "page"
                        : undefined
                    }
                    aria-label={`打开章纲：${chapterId}`}
                    className="ns-outline-chapter-button"
                    data-missing="true"
                    onClick={() => setSelection({ kind: "chapter", chapterId })}
                    type="button"
                  >
                    <span>{chapterId}</span>
                    <small>章节已不存在</small>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>

      <section aria-label="大纲详情" className="ns-outline-inspector">
        <OutlineInspector
          chapterToAdd={chapterToAdd}
          editor={editor}
          model={model}
          onAddChapter={addChapterToVolume}
          onChapterToAddChange={setChapterToAdd}
          onMissingChapterRemove={removeMissingChapter}
          onRemoveChapter={removeChapterFromVolume}
          onRootChange={(patch) => editor.onDraftChange("outline", patch)}
          onUpdateChapterOutline={updateChapterOutline}
          onUpdateVolume={updateVolume}
          selection={selection}
          unassignedChapters={unassignedChapters}
        />
      </section>
    </div>
  );
}

function OutlineInspector({
  chapterToAdd,
  editor,
  model,
  onAddChapter,
  onChapterToAddChange,
  onMissingChapterRemove,
  onRemoveChapter,
  onRootChange,
  onUpdateChapterOutline,
  onUpdateVolume,
  selection,
  unassignedChapters
}: {
  readonly chapterToAdd: string;
  readonly editor: StoryBibleEditorProps;
  readonly model: StoryBibleOutlineModel;
  readonly onAddChapter: (volumeIndex: number, chapterId: string) => void;
  readonly onChapterToAddChange: (chapterId: string) => void;
  readonly onMissingChapterRemove: (chapterId: string, volumeIndex?: number) => void;
  readonly onRemoveChapter: (volumeIndex: number, chapterIndex: number) => void;
  readonly onRootChange: (patch: Partial<StoryBibleEditorProps["draft"]>) => void;
  readonly onUpdateChapterOutline: (chapterId: string, patch: OutlineChapterPatch) => void;
  readonly onUpdateVolume: (volumeIndex: number, patch: OutlineVolumePatch) => void;
  readonly selection: OutlineSelection;
  readonly unassignedChapters: StoryBibleEditorProps["chapterOptions"];
}) {
  if (editor.draft.kind !== "outline") return null;

  if (selection.kind === "volume") {
    const volume = model.volumes[selection.volumeIndex];
    if (volume !== undefined) {
      const selectedChapterId = unassignedChapters.some((chapter) => chapter.id === chapterToAdd)
        ? chapterToAdd
        : (unassignedChapters[0]?.id ?? "");
      return (
        <div className="ns-outline-detail-fields">
          <OutlineInspectorHeader eyebrow="卷" title={volume.title} />
          <OutlineTextInput
            ariaLabel="卷名称"
            label="卷名称"
            onChange={(title) => onUpdateVolume(selection.volumeIndex, { title })}
            value={volume.title}
          />
          <OutlineTextArea
            ariaLabel="卷摘要"
            label="卷摘要"
            onChange={(summary) => onUpdateVolume(selection.volumeIndex, { summary })}
            value={volume.summary}
          />
          <div className="ns-outline-add-chapter">
            <label className="ns-story-field">
              <span>加入章节</span>
              <select
                aria-label={`选择加入${volume.title}的章节`}
                disabled={unassignedChapters.length === 0}
                onChange={(event) => onChapterToAddChange(event.currentTarget.value)}
                value={selectedChapterId}
              >
                {unassignedChapters.length === 0 ? (
                  <option value="">没有未归卷章节</option>
                ) : (
                  unassignedChapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.order}. {chapter.title}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              aria-label={`加入章节到${volume.title}`}
              className="ns-icon-text-button"
              disabled={selectedChapterId.length === 0}
              onClick={() => onAddChapter(selection.volumeIndex, selectedChapterId)}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
              加入本卷
            </button>
          </div>
          <span className="ns-muted">{volume.id}</span>
        </div>
      );
    }
  }

  if (selection.kind === "chapter") {
    const selectedVolumeIndex = selection.volumeIndex;
    const selectedChapterIndex = selection.chapterIndex;
    const chapter = editor.chapterOptions.find((candidate) => candidate.id === selection.chapterId);
    const outline = model.chapterOutlines.find(
      (candidate) => candidate.chapterId === selection.chapterId
    );
    const volume =
      selectedVolumeIndex === undefined ? undefined : model.volumes[selectedVolumeIndex];
    const validOccurrence =
      volume !== undefined &&
      selectedChapterIndex !== undefined &&
      volume.chapterIds[selectedChapterIndex] === selection.chapterId;
    const unassigned =
      selectedVolumeIndex === undefined &&
      !model.volumes.some((candidate) => candidate.chapterIds.includes(selection.chapterId));
    if (validOccurrence || unassigned) {
      return (
        <div className="ns-outline-detail-fields">
          <OutlineInspectorHeader
            eyebrow={chapter === undefined ? "失效章纲" : `第 ${chapter.order} 章`}
            title={chapter?.title ?? selection.chapterId}
          />
          {chapter === undefined ? <p className="ns-outline-missing-status">章节已不存在</p> : null}
          <OutlineTextArea
            ariaLabel="章纲目标"
            label="目标"
            onChange={(goal) => onUpdateChapterOutline(selection.chapterId, { goal })}
            value={outlineString(outline, "goal")}
          />
          <OutlineTextArea
            ariaLabel="章纲冲突"
            label="冲突"
            onChange={(conflict) => onUpdateChapterOutline(selection.chapterId, { conflict })}
            value={outlineString(outline, "conflict")}
          />
          <OutlineTextArea
            ariaLabel="章纲转折"
            label="转折"
            onChange={(value) =>
              onUpdateChapterOutline(selection.chapterId, {
                turningPoints: splitLines(value)
              })
            }
            value={outlineStrings(outline, "turningPoints").join("\n")}
          />
          <OutlineTextArea
            ariaLabel="章纲备注"
            label="备注"
            onChange={(notes) => onUpdateChapterOutline(selection.chapterId, { notes })}
            value={outlineString(outline, "notes")}
          />
          {chapter === undefined ? (
            <button
              aria-label={`清理失效章节：${selection.chapterId}`}
              className="ns-icon-text-button"
              onClick={() => onMissingChapterRemove(selection.chapterId, selectedVolumeIndex)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
              清理失效引用
            </button>
          ) : validOccurrence &&
            selectedVolumeIndex !== undefined &&
            selectedChapterIndex !== undefined ? (
            <button
              aria-label={`移出本卷：${chapter.title}`}
              className="ns-icon-text-button"
              onClick={() => onRemoveChapter(selectedVolumeIndex, selectedChapterIndex)}
              type="button"
            >
              <Unlink aria-hidden="true" size={14} />
              移出本卷
            </button>
          ) : null}
        </div>
      );
    }
  }

  return (
    <div className="ns-outline-detail-fields">
      <OutlineInspectorHeader eyebrow="大纲" title={editor.draft.title || "未命名大纲"} />
      <div className="ns-story-form-grid ns-story-form-grid-compact">
        <OutlineTextInput
          ariaLabel="大纲标题"
          label="标题"
          onChange={(title) => onRootChange({ title })}
          value={editor.draft.title}
        />
        <label className="ns-story-field">
          <span>资料状态</span>
          <select
            aria-label="资料状态"
            onChange={(event) =>
              onRootChange({ status: event.currentTarget.value as typeof editor.draft.status })
            }
            value={editor.draft.status}
          >
            <option value="active">启用</option>
            <option value="draft">草稿</option>
            <option value="archived">归档</option>
            <option value="deleted">已删除</option>
          </select>
        </label>
        <OutlineTextArea
          ariaLabel="大纲摘要"
          label="摘要"
          onChange={(summary) => onRootChange({ summary })}
          value={editor.draft.summary}
          wide
        />
        <OutlineTextArea
          ariaLabel="资料别名"
          label="别名"
          onChange={(value) => onRootChange({ aliases: splitLines(value) })}
          value={editor.draft.aliases.join("\n")}
          wide
        />
        <OutlineTextArea
          ariaLabel="关联资料 ID"
          label="关联资料 ID"
          onChange={(value) => onRootChange({ relatedEntityIds: splitLines(value) })}
          value={editor.draft.relatedEntityIds.join("\n")}
          wide
        />
      </div>
    </div>
  );
}

function OutlineInspectorHeader({
  eyebrow,
  title
}: {
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <header className="ns-outline-inspector-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}

function OutlineTextInput({
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

function OutlineTextArea({
  ariaLabel,
  label,
  onChange,
  value,
  wide = false
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
  readonly wide?: boolean;
}) {
  return (
    <label className={`ns-story-field${wide ? " ns-story-field-wide" : ""}`}>
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

function chapterLabel(
  chapterId: string,
  chapter: StoryBibleEditorProps["chapterOptions"][number] | undefined
): string {
  return chapter === undefined ? chapterId : `${chapter.order}. ${chapter.title}`;
}

function outlineString(outline: StoryBibleChapterOutline | undefined, key: string): string {
  const value = outline?.[key];
  return typeof value === "string" ? value : "";
}

function outlineStrings(outline: StoryBibleChapterOutline | undefined, key: string): string[] {
  const value = outline?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function splitLines(value: string): string[] {
  return value.length === 0 ? [] : value.replace(/\r\n?/gu, "\n").split("\n");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nextVolumeId(volumes: readonly StoryBibleOutlineVolume[]): string {
  const ids = new Set(volumes.map((volume) => volume.id));
  let number = volumes.length + 1;
  while (ids.has(`vol_${String(number).padStart(2, "0")}`)) number += 1;
  return `vol_${String(number).padStart(2, "0")}`;
}
