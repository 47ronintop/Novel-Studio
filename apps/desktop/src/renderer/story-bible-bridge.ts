import type { MemoryRecord, NovelStudioApi, StoryBibleSnapshot } from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";
import type { StoryBibleSummaryAsset, StoryBibleSummaryProps } from "@novel-studio/ui";

export interface StoryBibleBridge {
  getProps(): StoryBibleSummaryProps;
  load(): Promise<StoryBibleSummaryProps>;
}

export function createStoryBibleBridge(api: NovelStudioApi): StoryBibleBridge {
  let props: StoryBibleSummaryProps = { assets: [] };

  return {
    getProps: () => props,
    async load() {
      const snapshot = await unwrap(api.storyBible.load());
      props = toProps(snapshot);
      return props;
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
