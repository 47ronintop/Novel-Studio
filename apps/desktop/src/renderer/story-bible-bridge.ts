import type {
  ForeshadowAsset,
  MemoryRecord,
  NovelStudioApi,
  StoryBibleAsset,
  StoryBibleConsistencyRef,
  StoryBibleConsistencyReport,
  StoryBibleRegularAsset,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import { createForeshadowEvidence } from "@novel-studio/shared";
import {
  storyBibleForeshadowValidationMessage,
  storyBibleOutlineValidationMessage,
  validateStoryBibleForeshadow,
  validateStoryBibleOutline
} from "@novel-studio/ui";
import type {
  StoryBibleEditorDraft,
  StoryBibleEditorDraftFor,
  StoryBibleEditorEntry,
  StoryBibleEditorFilters,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryBibleWorldAssetType,
  StoryBibleConsistencyProps,
  StoryTimelineEvent,
  StoryBibleSummaryAsset,
  StoryBibleSummaryProps
} from "@novel-studio/ui";

export interface StoryBibleBridge {
  getProps(): StoryBibleSummaryProps;
  getEditorProps(): StoryBibleEditorProps;
  getSnapshot(): StoryBibleSnapshot;
  getSnapshotBinding(workspaceId?: string): StoryBibleSnapshotBinding | undefined;
  clear(): void;
  load(workspaceId: string): Promise<StoryBibleSummaryProps>;
  selectKind(kind: StoryBibleEditorKind): StoryBibleEditorProps;
  selectEntry(entryId: string): StoryBibleEditorProps;
  beginCreate(
    kind: StoryBibleEditorKind,
    assetType?: StoryBibleWorldAssetType
  ): StoryBibleEditorProps;
  cancelDraft(): StoryBibleEditorProps;
  updateDraft<K extends StoryBibleEditorKind>(
    kind: K,
    draft: Partial<StoryBibleEditorDraftFor<K>>
  ): StoryBibleEditorProps;
  updateFilters(filters: Partial<StoryBibleEditorFilters>): StoryBibleEditorProps;
  beginSave(): StoryBibleEditorProps;
  saveDraft(options?: StoryBibleSaveOptions): Promise<StoryBibleEditorProps>;
}

export interface StoryBibleSaveOptions {
  readonly chapterIds?: readonly string[];
}

export interface StoryBibleBridgeOptions {
  readonly createAssetIdentity?: () => string;
  readonly now?: () => string;
}

export interface StoryBibleSnapshotBinding {
  readonly workspaceId: string;
  readonly snapshot: StoryBibleSnapshot;
}

interface StoryBibleEditorState {
  readonly activeKind: StoryBibleEditorKind;
  readonly viewMode: StoryBibleEditorProps["viewMode"];
  readonly status: StoryBibleEditorProps["status"];
  readonly dirty: boolean;
  readonly draft: StoryBibleEditorDraft;
  readonly filters: StoryBibleEditorFilters;
  readonly externalUpdate: StoryBibleEditorProps["externalUpdate"];
  readonly feedback?: StoryBibleEditorProps["feedback"];
}

const DEFAULT_FILTERS: StoryBibleEditorFilters = {
  query: "",
  status: "all",
  worldAssetType: "all",
  foreshadowTrackingStatus: "all"
};

export function createStoryBibleBridge(
  api: NovelStudioApi,
  options: StoryBibleBridgeOptions = {}
): StoryBibleBridge {
  const createAssetIdentity = options.createAssetIdentity ?? createRandomAssetIdentity;
  const now = options.now ?? (() => new Date().toISOString());
  let props: StoryBibleSummaryProps = { assets: [] };
  let snapshot = emptySnapshot();
  let snapshotBinding: StoryBibleSnapshotBinding | undefined;
  let loadGeneration = 0;
  let consistency: StoryBibleConsistencyProps | undefined;
  let baselineDraft = emptyDraft("character");
  let editorState: StoryBibleEditorState = {
    activeKind: "character",
    viewMode: "list",
    status: "idle",
    dirty: false,
    draft: baselineDraft,
    filters: DEFAULT_FILTERS,
    externalUpdate: { status: "none" }
  };
  let editorProps = createEditorProps(snapshot, editorState, consistency);

  const publishEditor = (): StoryBibleEditorProps => {
    editorProps = createEditorProps(snapshot, editorState, consistency);
    return editorProps;
  };

  return {
    getProps: () => props,
    getEditorProps: () => editorProps,
    getSnapshot: () => snapshot,
    getSnapshotBinding(workspaceId) {
      return workspaceId === undefined || snapshotBinding?.workspaceId !== workspaceId
        ? undefined
        : snapshotBinding;
    },
    clear() {
      loadGeneration += 1;
      reset();
    },
    async load(workspaceId) {
      const generation = ++loadGeneration;
      reset();
      const nextSnapshot = await unwrap(api.storyBible.load());
      if (generation !== loadGeneration) return props;
      const nextConsistency = toConsistencyProps(
        await unwrap(api.storyBible.buildConsistencyReport())
      );
      if (generation !== loadGeneration) return props;
      snapshot = nextSnapshot;
      snapshotBinding = { workspaceId, snapshot };
      consistency = nextConsistency;
      props = toProps(snapshot);
      publishEditor();
      return props;
    },
    selectKind(kind) {
      baselineDraft = emptyDraft(kind);
      editorState = {
        ...editorState,
        activeKind: kind,
        viewMode: "list",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" }
      };
      deleteFeedback();
      return publishEditor();
    },
    selectEntry(entryId) {
      const entry = createEditorEntries(snapshot).find((candidate) => candidate.id === entryId);
      if (entry === undefined) {
        return editorProps;
      }

      baselineDraft = draftFromEntry(entry);
      editorState = {
        ...editorState,
        activeKind: entry.kind,
        viewMode: "detail",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" }
      };
      deleteFeedback();
      return publishEditor();
    },
    beginCreate(kind, assetType) {
      if (kind === "world" && assetType === undefined) {
        throw new Error("A world asset type is required before creating a world draft.");
      }
      if (assetType !== undefined && (kind !== "world" || !WORLD_ASSET_TYPES.has(assetType))) {
        throw new Error("World asset types can only be used to create world drafts.");
      }
      baselineDraft = emptyDraft(kind, assetType);
      editorState = {
        ...editorState,
        activeKind: kind,
        viewMode: "detail",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" }
      };
      deleteFeedback();
      return publishEditor();
    },
    cancelDraft() {
      baselineDraft = emptyDraft(editorState.activeKind);
      editorState = {
        ...editorState,
        viewMode: "list",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" }
      };
      deleteFeedback();
      return publishEditor();
    },
    updateDraft(kind, draft) {
      assertDraftPatch(editorState.draft, kind, draft);
      const nextDraft = mergeDraftPatch(editorState.draft, draft);
      editorState = {
        ...editorState,
        activeKind: nextDraft.kind,
        viewMode: "detail",
        status: "idle",
        dirty: !draftsEqual(nextDraft, baselineDraft),
        draft: nextDraft
      };
      deleteFeedback();
      return publishEditor();
    },
    updateFilters(filters) {
      editorState = {
        ...editorState,
        filters: { ...editorState.filters, ...filters }
      };
      return publishEditor();
    },
    beginSave() {
      editorState = { ...editorState, status: "saving" };
      deleteFeedback();
      return publishEditor();
    },
    async saveDraft(saveOptions) {
      const generation = loadGeneration;
      const workspaceId = snapshotBinding?.workspaceId;
      const draft = normalizeDraft(editorState.draft);
      const validationError = validateStoryBibleDraft(draft, snapshot, saveOptions);
      if (validationError !== undefined) {
        editorState = {
          ...editorState,
          status: "error",
          dirty: true,
          draft,
          feedback: {
            kind: "error",
            message: validationError
          }
        };
        return publishEditor();
      }
      const normalizedDraft = await normalizeForeshadowDraft(draft);
      if (generation !== loadGeneration) return editorProps;
      const saved = await api.storyBible.saveAsset(
        toStoryAsset(normalizedDraft, now(), snapshot, createAssetIdentity)
      );

      if (!saved.ok) {
        editorState = {
          ...editorState,
          status: "error",
          dirty: true,
          draft: normalizedDraft,
          feedback: {
            kind: "error",
            message: saved.error.message
          }
        };
        return publishEditor();
      }

      if (generation !== loadGeneration) return editorProps;
      const nextSnapshot = await unwrap(api.storyBible.load());
      if (generation !== loadGeneration) return editorProps;
      const nextConsistency = toConsistencyProps(
        await unwrap(api.storyBible.buildConsistencyReport())
      );
      if (generation !== loadGeneration) return editorProps;
      snapshot = nextSnapshot;
      snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
      consistency = nextConsistency;
      props = toProps(snapshot);
      baselineDraft = draftFromSnapshot(snapshot, { ...normalizedDraft, id: saved.value.id });
      editorState = {
        ...editorState,
        activeKind: baselineDraft.kind,
        viewMode: "detail",
        status: "saved",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" },
        feedback: {
          kind: "info",
          message: "故事圣经已保存。"
        }
      };
      return publishEditor();
    }
  };

  function deleteFeedback(): void {
    if (editorState.feedback === undefined) {
      return;
    }
    editorState = {
      activeKind: editorState.activeKind,
      viewMode: editorState.viewMode,
      status: editorState.status,
      dirty: editorState.dirty,
      draft: editorState.draft,
      filters: editorState.filters,
      externalUpdate: editorState.externalUpdate
    };
  }

  function reset(): void {
    snapshot = emptySnapshot();
    snapshotBinding = undefined;
    consistency = undefined;
    props = { assets: [] };
    baselineDraft = emptyDraft(editorState.activeKind);
    editorState = {
      ...editorState,
      viewMode: "list",
      status: "idle",
      dirty: false,
      draft: baselineDraft,
      externalUpdate: { status: "none" }
    };
    deleteFeedback();
    publishEditor();
  }
}

function emptySnapshot(): StoryBibleSnapshot {
  return {
    characters: [],
    worldAssets: [],
    foreshadows: [],
    memories: []
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
      ...snapshot.foreshadows.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
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
  state: StoryBibleEditorState,
  consistency?: StoryBibleConsistencyProps
): StoryBibleEditorProps {
  return {
    activeKind: state.activeKind,
    viewMode: state.viewMode,
    status: state.status,
    dirty: state.dirty,
    entries: createEditorEntries(snapshot),
    chapterOptions: [],
    filters: state.filters,
    externalUpdate: state.externalUpdate,
    ...(consistency === undefined ? {} : { consistency }),
    draft: state.draft,
    ...(state.feedback === undefined ? {} : { feedback: state.feedback }),
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined
  };
}

function toConsistencyProps(report: StoryBibleConsistencyReport): StoryBibleConsistencyProps {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    issues: report.issues.flatMap((issue) => {
      if (
        !isNavigableConsistencyRef(issue.sourceRef) ||
        !isNavigableConsistencyRef(issue.targetRef)
      ) {
        return [];
      }

      return [
        {
          id: issue.id,
          severity: issue.severity,
          title: issue.title,
          message: issue.message,
          sourceRef: issue.sourceRef,
          targetRef: issue.targetRef,
          suggestedAction: issue.suggestedAction
        }
      ];
    })
  };
}

function isNavigableConsistencyRef(
  ref: StoryBibleConsistencyRef
): ref is StoryBibleConsistencyRef & { readonly kind: StoryBibleEditorKind } {
  switch (ref.kind) {
    case "character":
    case "world":
    case "outline":
    case "foreshadow":
    case "timeline":
      return true;
    case "chapter":
    case "memory":
      return false;
  }
}

function createEditorEntries(snapshot: StoryBibleSnapshot): readonly StoryBibleEditorEntry[] {
  return [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...snapshot.foreshadows,
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ]
    .map(assetEntry)
    .sort(compareEditorEntries);
}

function assetEntry(asset: StoryBibleAsset): StoryBibleEditorEntry {
  const common = {
    id: asset.id,
    title: asset.title,
    status: asset.status,
    summary: asset.summary,
    aliases: [...(asset.aliases ?? [])],
    relatedEntityIds: [...(asset.relatedEntityIds ?? [])],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
  switch (asset.type) {
    case "character":
      return { ...common, kind: "character", assetType: asset.type, details: asset.details ?? {} };
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return { ...common, kind: "world", assetType: asset.type, details: asset.details ?? {} };
    case "outline":
      return { ...common, kind: "outline", assetType: asset.type, details: asset.details ?? {} };
    case "foreshadow":
      return { ...common, kind: "foreshadow", assetType: asset.type, details: asset.details };
    case "timeline.events":
      return {
        ...common,
        kind: "timeline",
        assetType: asset.type,
        details: asset.details ?? {},
        timelineEvents: timelineEventsFromAsset(asset)
      };
  }
}

const STORY_ENTRY_COLLATOR = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
  usage: "sort"
});

function compareEditorEntries(left: StoryBibleEditorEntry, right: StoryBibleEditorEntry): number {
  return (
    STORY_ENTRY_COLLATOR.compare(left.title, right.title) ||
    left.id.localeCompare(right.id, "en-US")
  );
}

function timelineEventsFromAsset(asset: StoryBibleAsset): readonly StoryTimelineEvent[] {
  const events = asset.details?.["events"];
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((event, index) => toTimelineEvent(event, index, asset.id))
    .filter((event): event is StoryTimelineEvent => event !== undefined)
    .sort(
      (left, right) =>
        left.sequence - right.sequence || STORY_ENTRY_COLLATOR.compare(left.title, right.title)
    );
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

function emptyDraft(
  kind: StoryBibleEditorKind,
  worldAssetType: StoryBibleWorldAssetType = "world.location"
): StoryBibleEditorDraft {
  const common = {
    title: "",
    status: "active" as const,
    summary: "",
    aliases: [],
    relatedEntityIds: []
  };
  switch (kind) {
    case "character":
      return { ...common, kind, assetType: "character", details: {} };
    case "world":
      return { ...common, kind, assetType: worldAssetType, details: {} };
    case "outline":
      return { ...common, kind, assetType: "outline", details: {} };
    case "foreshadow":
      return {
        ...common,
        kind,
        assetType: "foreshadow",
        details: { trackingStatus: "planned", origin: "manual" }
      };
    case "timeline":
      return { ...common, kind, assetType: "timeline.events", details: {} };
  }
}

function normalizeDraft(draft: StoryBibleEditorDraft): StoryBibleEditorDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    aliases: draft.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    relatedEntityIds: draft.relatedEntityIds.map((id) => id.trim()).filter((id) => id.length > 0)
  } as StoryBibleEditorDraft;
}

function validateStoryBibleDraft(
  draft: StoryBibleEditorDraft,
  snapshot: StoryBibleSnapshot,
  saveOptions: StoryBibleSaveOptions | undefined
): string | undefined {
  if (draft.kind === "outline") {
    if (saveOptions?.chapterIds === undefined) {
      return "无法保存大纲：当前章节目录不可用。";
    }
    const issues = validateStoryBibleOutline(draft.details, saveOptions.chapterIds);
    return issues.length === 0
      ? undefined
      : `无法保存大纲：${issues.map(storyBibleOutlineValidationMessage).join(" ")}`;
  }
  if (draft.kind === "foreshadow") {
    const issues = validateStoryBibleForeshadow(draft, snapshot.foreshadows);
    return issues.length === 0
      ? undefined
      : `无法保存伏笔：${issues.map(storyBibleForeshadowValidationMessage).join(" ")}`;
  }
  return undefined;
}

async function normalizeForeshadowDraft(
  draft: StoryBibleEditorDraft
): Promise<StoryBibleEditorDraft> {
  if (draft.kind !== "foreshadow" || draft.details.sourceRefs === undefined) {
    return draft;
  }

  const sourceRefs = await Promise.all(
    draft.details.sourceRefs.map(async (sourceRef) => ({
      ...sourceRef,
      ...(await createForeshadowEvidence(sourceRef.chapterId.trim(), sourceRef.excerpt))
    }))
  );
  return {
    ...draft,
    details: {
      ...draft.details,
      sourceRefs
    }
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

  return draftFromEntry(entry);
}

function toStoryAsset(
  draft: StoryBibleEditorDraft,
  now: string,
  snapshot: StoryBibleSnapshot,
  createAssetIdentity: () => string
): StoryBibleAsset {
  const existing = findExistingAsset(snapshot, draft.id);
  if (existing !== undefined && existing.type !== draft.assetType) {
    throw new Error("Existing Story Bible assets cannot change asset type.");
  }
  const id = draft.id ?? defaultAssetId(draft, createAssetIdentity);
  const details = mergeJsonObjects(existing?.details ?? {}, draft.details);
  const common = {
    ...(existing ?? {}),
    schemaVersion: "1.0",
    id,
    title: draft.title,
    status: draft.status,
    summary: draft.summary,
    aliases: [...draft.aliases],
    relatedEntityIds: [...draft.relatedEntityIds],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  if (draft.kind === "foreshadow") {
    const { plantedChapterId, plannedPayoffChapterId, actualPayoffChapterId, ...otherDetails } =
      details;
    const foreshadowDetails: JsonObject = {
      ...otherDetails,
      trackingStatus: draft.details.trackingStatus,
      ...optionalTrimmedString("plantedChapterId", plantedChapterId),
      ...optionalTrimmedString("plannedPayoffChapterId", plannedPayoffChapterId),
      ...optionalTrimmedString("actualPayoffChapterId", actualPayoffChapterId)
    };
    return {
      ...common,
      type: "foreshadow",
      details: foreshadowDetails
    } as ForeshadowAsset;
  }
  return {
    ...common,
    type: draft.assetType,
    details
  } as StoryBibleRegularAsset;
}

function optionalTrimmedString(key: string, value: unknown): JsonObject {
  return typeof value === "string" && value.trim().length > 0 ? { [key]: value.trim() } : {};
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
    ...snapshot.foreshadows,
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ].find((asset) => asset.id === id);
}

function defaultAssetId(draft: StoryBibleEditorDraft, createAssetIdentity: () => string): string {
  if (draft.assetType === "outline") {
    return "outline_main";
  }
  if (draft.assetType === "timeline.events") {
    return "timeline_main";
  }
  const identity = createAssetIdentity();
  if (!/^[0-9a-f]{32}$/u.test(identity)) {
    throw new Error("Story Bible asset identity must be 32 lowercase hexadecimal characters.");
  }
  switch (draft.assetType) {
    case "character":
      return `chr_${identity}`;
    case "world.location":
      return `loc_${identity}`;
    case "world.faction":
      return `fac_${identity}`;
    case "world.rule":
      return `rule_${identity}`;
    case "world.glossary":
      return `term_${identity}`;
    case "foreshadow":
      return `fsh_${identity}`;
  }
}

function draftFromEntry(entry: StoryBibleEditorEntry): StoryBibleEditorDraft {
  const common = {
    id: entry.id,
    title: entry.title,
    status: entry.status,
    summary: entry.summary,
    aliases: [...entry.aliases],
    relatedEntityIds: [...entry.relatedEntityIds],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
  switch (entry.kind) {
    case "character":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "world":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "outline":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "foreshadow":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "timeline":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
  }
}

function assertDraftPatch<K extends StoryBibleEditorKind>(
  current: StoryBibleEditorDraft,
  kind: K,
  patch: Partial<StoryBibleEditorDraftFor<K>>
): void {
  if (kind !== current.kind) {
    throw new Error(`Cannot apply a ${kind} patch to the active ${current.kind} draft.`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "kind")) {
    throw new Error("Story Bible draft patches cannot modify kind.");
  }
  const allowedKeys = new Set([
    "assetType",
    "title",
    "status",
    "summary",
    "aliases",
    "relatedEntityIds",
    "details"
  ]);
  const unknownKey = Object.keys(patch).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    throw new Error(`Story Bible draft patch contains an unsupported ${unknownKey} field.`);
  }
  if (
    patch.assetType !== undefined &&
    (!assetTypeMatchesKind(kind, patch.assetType) ||
      (current.id !== undefined && patch.assetType !== current.assetType))
  ) {
    throw new Error(`Story Bible draft asset type does not match the active ${kind} draft.`);
  }
}

function assetTypeMatchesKind(
  kind: StoryBibleEditorKind,
  assetType: StoryBibleAsset["type"]
): boolean {
  switch (kind) {
    case "character":
      return assetType === "character";
    case "world":
      return WORLD_ASSET_TYPES.has(assetType);
    case "outline":
      return assetType === "outline";
    case "foreshadow":
      return assetType === "foreshadow";
    case "timeline":
      return assetType === "timeline.events";
  }
}

const WORLD_ASSET_TYPES = new Set<StoryBibleAsset["type"]>([
  "world.location",
  "world.faction",
  "world.rule",
  "world.glossary"
]);

function mergeDraftPatch<K extends StoryBibleEditorKind>(
  current: StoryBibleEditorDraft,
  patch: Partial<StoryBibleEditorDraftFor<K>>
): StoryBibleEditorDraft {
  const assetTypeChanged = patch.assetType !== undefined && patch.assetType !== current.assetType;
  return {
    ...current,
    ...patch,
    details: assetTypeChanged
      ? (patch.details ?? {})
      : patch.details === undefined
        ? current.details
        : mergeJsonObjects(current.details, patch.details)
  } as StoryBibleEditorDraft;
}

function mergeJsonObjects(current: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const currentValue = current[key];
    merged[key] =
      isJsonObject(currentValue) && isJsonObject(value)
        ? mergeJsonObjects(currentValue, value)
        : value;
  }
  return merged;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftsEqual(left: StoryBibleEditorDraft, right: StoryBibleEditorDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createRandomAssetIdentity(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
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
