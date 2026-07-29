import type { JsonObject } from "@novel-studio/shared";

export type StoryBibleOutlineVolume = JsonObject & {
  id: string;
  title: string;
  summary: string;
  chapterIds: string[];
};

export type StoryBibleChapterOutline = JsonObject & {
  chapterId: string;
};

export interface StoryBibleOutlineModel {
  readonly volumes: StoryBibleOutlineVolume[];
  readonly chapterOutlines: StoryBibleChapterOutline[];
}

export type StoryBibleOutlineValidationIssue =
  | {
      readonly code: "duplicate-chapter";
      readonly chapterId: string;
      readonly volumeIds: readonly string[];
    }
  | {
      readonly code: "missing-chapter";
      readonly chapterId: string;
    };

export function readStoryBibleOutline(details: JsonObject): StoryBibleOutlineModel {
  const volumes = objectArray(details["volumes"]).map((volume, index) => ({
    ...volume,
    id: nonEmptyString(volume["id"]) ?? `vol_legacy_${index + 1}`,
    title: stringValue(volume["title"]) ?? `未命名卷 ${index + 1}`,
    summary: stringValue(volume["summary"]) ?? "",
    chapterIds: stringArray(volume["chapterIds"])
  }));
  const chapterOutlines = objectArray(details["chapterOutlines"]).flatMap((outline) => {
    const chapterId = nonEmptyString(outline["chapterId"]);
    return chapterId === undefined ? [] : [{ ...outline, chapterId }];
  });

  return { volumes, chapterOutlines };
}

export function validateStoryBibleOutline(
  details: JsonObject,
  knownChapterIds: readonly string[]
): readonly StoryBibleOutlineValidationIssue[] {
  const model = readStoryBibleOutline(details);
  const assignments = new Map<string, string[]>();
  for (const volume of model.volumes) {
    for (const chapterId of volume.chapterIds) {
      const volumeIds = assignments.get(chapterId) ?? [];
      volumeIds.push(volume.id);
      assignments.set(chapterId, volumeIds);
    }
  }

  const duplicateIssues: StoryBibleOutlineValidationIssue[] = [];
  for (const [chapterId, volumeIds] of assignments) {
    if (volumeIds.length > 1) {
      duplicateIssues.push({ code: "duplicate-chapter", chapterId, volumeIds });
    }
  }

  const knownIds = new Set(knownChapterIds);
  const referencedIds = new Set([
    ...assignments.keys(),
    ...model.chapterOutlines.map((outline) => outline.chapterId)
  ]);
  const missingIssues = [...referencedIds]
    .filter((chapterId) => !knownIds.has(chapterId))
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .map((chapterId): StoryBibleOutlineValidationIssue => ({
      code: "missing-chapter",
      chapterId
    }));

  return [...duplicateIssues, ...missingIssues];
}

export function storyBibleOutlineValidationMessage(
  issue: StoryBibleOutlineValidationIssue
): string {
  switch (issue.code) {
    case "duplicate-chapter":
      return `章节 ${issue.chapterId} 被重复归卷（${issue.volumeIds.join("、")}）。`;
    case "missing-chapter":
      return `章节 ${issue.chapterId} 已不存在，请先清理引用。`;
  }
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
