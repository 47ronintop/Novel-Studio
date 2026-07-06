import type { ChapterEditorSnapshot, NovelStudioApi } from "@novel-studio/application";
import type {
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  SnapshotReason,
  UnifiedError
} from "@novel-studio/shared";
import type {
  ChapterEditorDiffPreview,
  ChapterEditorProps,
  ChapterEditorVersionEntry
} from "@novel-studio/ui";
export interface ChapterEditorBridge {
  load(): Promise<ChapterEditorProps>;
  edit(nextBody: string): Promise<ChapterEditorProps>;
  beginSave(): ChapterEditorProps | undefined;
  save(): Promise<ChapterEditorProps>;
  listVersions(): Promise<readonly ChapterEditorVersionEntry[]>;
  previewVersion(versionId: string): Promise<ChapterVersionContent>;
  restoreVersion(versionId: string): Promise<ChapterEditorProps>;
  previewSuggestionDiff(nextBody: string): Promise<ChapterEditorDiffPreview>;
}

export function createChapterEditorBridge(api: NovelStudioApi): ChapterEditorBridge {
  let currentProps: ChapterEditorProps | undefined;

  return {
    async load() {
      currentProps = toChapterEditorProps(await unwrap(api.chapter.load()));
      return currentProps;
    },
    async edit(nextBody: string) {
      currentProps = toChapterEditorProps(await unwrap(api.chapter.edit(nextBody)));
      return currentProps;
    },
    beginSave() {
      if (currentProps === undefined || !currentProps.dirty) {
        return currentProps;
      }

      return {
        ...currentProps,
        saveStatus: "Saving"
      };
    },
    async save() {
      currentProps = toChapterEditorProps(await unwrap(api.chapter.save()));
      return currentProps;
    },
    async listVersions() {
      const versions = mapVersionSummaries(await unwrap(api.chapter.listVersions()));
      if (currentProps !== undefined) {
        currentProps = {
          ...currentProps,
          versionHistory: versions
        };
      }

      return versions;
    },
    previewVersion(versionId: string) {
      return unwrap(api.chapter.previewVersion(versionId));
    },
    async restoreVersion(versionId: string) {
      currentProps = toChapterEditorProps(await unwrap(api.chapter.restoreVersion(versionId)));
      return currentProps;
    },
    previewSuggestionDiff(nextBody: string) {
      return unwrap(api.chapter.previewSuggestionDiff(nextBody));
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

export function toChapterEditorProps(snapshot: ChapterEditorSnapshot): ChapterEditorProps {
  return {
    chapter: snapshot.state.chapter,
    dirty: snapshot.state.dirty,
    saveStatus: snapshot.state.saveStatus,
    versionHistory: mapVersionSummaries(snapshot.versions)
  };
}

function mapVersionSummaries(
  versions: readonly ChapterVersionSummary[]
): readonly ChapterEditorVersionEntry[] {
  return versions.map((version) => ({
    versionId: version.versionId,
    label: versionReasonLabel(version.reason),
    createdAt: version.createdAt
  }));
}

function versionReasonLabel(reason: SnapshotReason): string {
  switch (reason) {
    case "manual-save":
      return "Manual save";
    case "autosave-snapshot":
      return "Autosave";
    case "interval-snapshot":
      return "Interval snapshot";
    case "before-ai-apply":
      return "Before AI apply";
    case "before-rollback":
      return "Before rollback";
    case "migration":
      return "Migration";
  }
}
