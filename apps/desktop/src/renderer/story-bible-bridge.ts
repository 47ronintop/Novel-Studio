import type {
  MemoryRecord,
  NovelStudioApi,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";
import type {
  StoryBibleEditorDraft,
  StoryBibleEditorEntry,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryBibleConsistencyProps,
  StoryTimelineEvent,
  StoryBibleSummaryAsset,
  StoryBibleSummaryProps
} from "@novel-studio/ui";

export interface StoryBibleBridge {
  getProps(): StoryBibleSummaryProps;
  getEditorProps(): StoryBibleEditorProps;
  load(): Promise<StoryBibleSummaryProps>;
  selectKind(kind: StoryBibleEditorKind): StoryBibleEditorProps;
  selectEntry(entryId: string): StoryBibleEditorProps;
  updateDraft(draft: Partial<StoryBibleEditorDraft>): StoryBibleEditorProps;
  beginSave(): StoryBibleEditorProps;
  saveDraft(): Promise<StoryBibleEditorProps>;
}

export function createStoryBibleBridge(api: NovelStudioApi): StoryBibleBridge {
  let props: StoryBibleSummaryProps = { assets: [] };
  let snapshot: StoryBibleSnapshot = {
    characters: [],
    worldAssets: [],
    memories: []
  };
  let consistency: StoryBibleConsistencyProps | undefined;
  let editorProps = createEditorProps(
    snapshot,
    "character",
    emptyDraft("character"),
    "idle",
    undefined,
    consistency
  );

  return {
    getProps: () => props,
    getEditorProps: () => editorProps,
    async load() {
      snapshot = await unwrap(api.storyBible.load());
      consistency = toConsistencyProps(await unwrap(api.storyBible.buildConsistencyReport()));
      props = toProps(snapshot);
      editorProps = createEditorProps(
        snapshot,
        editorProps.activeKind,
        draftFromSnapshot(snapshot, editorProps.draft),
        "idle",
        undefined,
        consistency
      );
      return props;
    },
    selectKind(kind) {
      editorProps = createEditorProps(
        snapshot,
        kind,
        emptyDraft(kind),
        "idle",
        undefined,
        consistency
      );
      return editorProps;
    },
    selectEntry(entryId) {
      const entry = createEditorEntries(snapshot).find((candidate) => candidate.id === entryId);
      if (entry === undefined) {
        return editorProps;
      }

      editorProps = createEditorProps(
        snapshot,
        entry.kind,
        {
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          status: entry.status
        },
        "idle",
        undefined,
        consistency
      );
      return editorProps;
    },
    updateDraft(draft) {
      editorProps = createEditorProps(
        snapshot,
        draft.kind ?? editorProps.activeKind,
        {
          ...editorProps.draft,
          ...draft
        },
        "idle",
        undefined,
        consistency
      );
      return editorProps;
    },
    beginSave() {
      editorProps = createEditorProps(
        snapshot,
        editorProps.activeKind,
        editorProps.draft,
        "saving",
        undefined,
        consistency
      );
      return editorProps;
    },
    async saveDraft() {
      const now = new Date().toISOString();
      const draft = normalizeDraft(editorProps.draft);
      const saved =
        draft.kind === "memory"
          ? await api.storyBible.saveMemory(toMemoryRecord(draft, now, snapshot))
          : await api.storyBible.saveAsset(toStoryAsset(draft, now, snapshot));

      if (!saved.ok) {
        editorProps = createEditorProps(
          snapshot,
          editorProps.activeKind,
          draft,
          "error",
          {
            kind: "error",
            message: saved.error.message
          },
          consistency
        );
        return editorProps;
      }

      snapshot = await unwrap(api.storyBible.load());
      consistency = toConsistencyProps(await unwrap(api.storyBible.buildConsistencyReport()));
      props = toProps(snapshot);
      editorProps = createEditorProps(
        snapshot,
        draft.kind,
        draftFromSnapshot(snapshot, draft),
        "saved",
        {
          kind: "info",
          message: "故事圣经已保存。"
        },
        consistency
      );
      return editorProps;
    }
  };
}

async function unwrap<T>(promise: Promise<Result<T, UnifiedError>>): Promise<T> {
  const result = await promise;
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.error.message);
}

function toProps(snapshot: StoryBibleSnapshot): StoryBibleSummaryProps {
  return {
    assets: [
      ...snapshot.characters.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
      ...snapshot.worldAssets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
      ...(snapshot.outline === undefined
        ? []
        : [
            {
              id: snapshot.outline.id,
              title: snapshot.outline.title,
              type: snapshot.outline.type,
              status: snapshot.outline.status,
              summary: snapshot.outline.summary,
              contextEligible: snapshot.outline.status === "active"
            }
          ]),
      ...(snapshot.timeline === undefined
        ? []
        : [
            {
              id: snapshot.timeline.id,
              title: snapshot.timeline.title,
              type: snapshot.timeline.type,
              status: snapshot.timeline.status,
              summary: snapshot.timeline.summary,
              contextEligible: snapshot.timeline.status === "active"
            }
          ]),
      ...snapshot.memories.map(memorySummary)
    ]
  };
}

function createEditorProps(
  snapshot: StoryBibleSnapshot,
  activeKind: StoryBibleEditorKind,
  draft: StoryBibleEditorDraft,
  status: StoryBibleEditorProps["status"],
  feedback?: StoryBibleEditorProps["feedback"],
  consistency?: StoryBibleConsistencyProps
): StoryBibleEditorProps {
  return {
    activeKind,
    status,
    entries: createEditorEntries(snapshot),
    ...(consistency === undefined ? {} : { consistency }),
    draft,
    ...(feedback === undefined ? {} : { feedback }),
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onNewDraft: () => undefined,
    onSave: () => undefined
  };
}

function toConsistencyProps(report: StoryBibleConsistencyReport): StoryBibleConsistencyProps {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    issues: report.issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      title: issue.title,
      message: issue.message,
      sourceRef: issue.sourceRef,
      targetRef: issue.targetRef,
      suggestedAction: issue.suggestedAction
    }))
  };
}

function createEditorEntries(snapshot: StoryBibleSnapshot): readonly StoryBibleEditorEntry[] {
  return [
    ...snapshot.characters.map((asset) => assetEntry(asset, "character")),
    ...snapshot.worldAssets.map((asset) => assetEntry(asset, "world")),
    ...(snapshot.outline === undefined ? [] : [assetEntry(snapshot.outline, "outline")]),
    ...(snapshot.timeline === undefined ? [] : [assetEntry(snapshot.timeline, "timeline")]),
    ...snapshot.memories.map((memory) => ({
      id: memory.id,
      kind: "memory" as const,
      title: memory.title,
      status: memory.status,
      body: memory.content
    }))
  ];
}

function assetEntry(
  asset: StoryBibleAsset,
  kind: Exclude<StoryBibleEditorKind, "memory">
): StoryBibleEditorEntry {
  return {
    id: asset.id,
    kind,
    title: asset.title,
    status: asset.status,
    body: asset.summary,
    ...(kind === "timeline" ? { timelineEvents: timelineEventsFromAsset(asset) } : {})
  };
}

function timelineEventsFromAsset(asset: StoryBibleAsset): readonly StoryTimelineEvent[] {
  const events = asset.details?.["events"];
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((event, index) => toTimelineEvent(event, index, asset.id))
    .filter((event): event is StoryTimelineEvent => event !== undefined)
    .sort((left, right) => left.sequence - right.sequence || left.title.localeCompare(right.title));
}

function toTimelineEvent(
  value: unknown,
  index: number,
  parentEntryId: string
): StoryTimelineEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined;
  if (id === undefined) {
    return undefined;
  }

  const sequence = typeof value.sequence === "number" ? value.sequence : index + 1;
  const title = typeof value.title === "string" && value.title.length > 0 ? value.title : id;
  const status =
    typeof value.status === "string" && value.status.length > 0 ? value.status : "active";
  const summary = typeof value.summary === "string" ? value.summary : "";
  const chapterIds = Array.isArray(value.chapterIds)
    ? value.chapterIds.filter((chapterId): chapterId is string => typeof chapterId === "string")
    : [];

  return {
    id,
    parentEntryId,
    sequence,
    title,
    status,
    summary,
    chapterIds
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyDraft(kind: StoryBibleEditorKind): StoryBibleEditorDraft {
  return {
    kind,
    title: "",
    body: "",
    status: "active"
  };
}

function normalizeDraft(draft: StoryBibleEditorDraft): StoryBibleEditorDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim()
  };
}

function draftFromSnapshot(
  snapshot: StoryBibleSnapshot,
  fallback: StoryBibleEditorDraft
): StoryBibleEditorDraft {
  if (fallback.id === undefined) {
    return fallback;
  }

  const entry = createEditorEntries(snapshot).find((candidate) => candidate.id === fallback.id);
  if (entry === undefined) {
    return fallback;
  }

  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    status: entry.status
  };
}

function toStoryAsset(
  draft: StoryBibleEditorDraft,
  now: string,
  snapshot: StoryBibleSnapshot
): StoryBibleAsset {
  if (draft.kind === "memory") {
    throw new Error("Memory drafts must be saved with saveMemory.");
  }
  const existing = findExistingAsset(snapshot, draft.id);
  const id = draft.id ?? defaultAssetId(draft);
  return {
    schemaVersion: "1.0",
    id,
    type: existing?.type ?? storyAssetType(draft.kind),
    title: draft.title,
    status: "active",
    summary: draft.body,
    ...(existing?.aliases === undefined ? {} : { aliases: existing.aliases }),
    ...(existing?.details === undefined ? {} : { details: existing.details }),
    ...(existing?.relatedEntityIds === undefined
      ? {}
      : { relatedEntityIds: existing.relatedEntityIds }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function toMemoryRecord(
  draft: StoryBibleEditorDraft,
  now: string,
  snapshot: StoryBibleSnapshot
): MemoryRecord {
  const existing = snapshot.memories.find((memory) => memory.id === draft.id);
  return {
    schemaVersion: "1.0",
    id: draft.id ?? defaultAssetId(draft),
    type: existing?.type ?? "memory.long-term",
    title: draft.title,
    status: "active",
    origin: existing?.origin ?? "user-confirmed-ai",
    confidence: existing?.confidence ?? "confirmed",
    content: draft.body,
    ...(existing?.sourceRefs === undefined ? {} : { sourceRefs: existing.sourceRefs }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function findExistingAsset(
  snapshot: StoryBibleSnapshot,
  id: string | undefined
): StoryBibleAsset | undefined {
  if (id === undefined) {
    return undefined;
  }

  return [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ].find((asset) => asset.id === id);
}

function storyAssetType(kind: Exclude<StoryBibleEditorKind, "memory">): StoryBibleAsset["type"] {
  switch (kind) {
    case "character":
      return "character";
    case "world":
      return "world.location";
    case "outline":
      return "outline";
    case "timeline":
      return "timeline.events";
  }
}

function defaultAssetId(draft: StoryBibleEditorDraft): string {
  const slug = slugify(draft.title);
  switch (draft.kind) {
    case "character":
      return `chr_${slug}`;
    case "world":
      return `world_${slug}`;
    case "outline":
      return "outline_main";
    case "timeline":
      return "timeline_main";
    case "memory":
      return `mem_${slug}`;
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug.length === 0 ? "untitled" : slug;
}

function memorySummary(memory: MemoryRecord): StoryBibleSummaryAsset {
  return {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    status: memory.status,
    summary: memory.content,
    contextEligible:
      memory.status === "active" &&
      memory.confidence === "confirmed" &&
      memory.origin !== "ai-unconfirmed"
  };
}
