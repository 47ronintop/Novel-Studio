import type { JsonObject, JsonValue } from "@novel-studio/shared";

export type StoryBibleTimelineEvent = JsonObject & {
  id: string;
  title: string;
  sequence: number;
  timeLabel: string;
  summary: string;
  chapterIds: string[];
  characterIds: string[];
  locationIds: string[];
  causes: string[];
  effects: string[];
};

export interface StoryBibleTimelineModel {
  readonly events: StoryBibleTimelineEvent[];
}

export type StoryBibleTimelineValidationIssue =
  | { readonly code: "duplicate-id"; readonly eventId: string }
  | { readonly code: "missing-title"; readonly eventId: string }
  | { readonly code: "invalid-sequence"; readonly eventId: string }
  | { readonly code: "self-reference"; readonly eventId: string };

export function readStoryBibleTimeline(details: JsonObject): StoryBibleTimelineModel {
  return {
    events: objectArray(details["events"])
      .flatMap((event, index) => {
        const id = nonEmptyString(event["id"]);
        if (id === undefined) return [];
        return [
          {
            ...event,
            id,
            title: stringValue(event["title"]) ?? id,
            sequence: numberValue(event["sequence"]) ?? index + 1,
            timeLabel: stringValue(event["timeLabel"]) ?? "",
            summary: stringValue(event["summary"]) ?? "",
            chapterIds: stringArray(event["chapterIds"]),
            characterIds: stringArray(event["characterIds"]),
            locationIds: stringArray(event["locationIds"]),
            causes: stringArray(event["causes"]),
            effects: stringArray(event["effects"])
          }
        ];
      })
      .sort(compareTimelineEvents)
  };
}

export function updateStoryBibleTimelineEvent(
  details: JsonObject,
  eventId: string,
  patch: JsonObject
): JsonObject {
  return {
    ...details,
    events: rawEvents(details).map((event) =>
      isJsonObject(event) && event["id"] === eventId ? { ...event, ...patch, id: eventId } : event
    )
  };
}

export function appendStoryBibleTimelineEvent(
  details: JsonObject,
  event: StoryBibleTimelineEvent
): JsonObject {
  return { ...details, events: [...rawEvents(details), event] };
}

export function createStoryBibleTimelineEvent(
  existingEvents: readonly StoryBibleTimelineEvent[],
  identity: string
): StoryBibleTimelineEvent {
  const normalizedIdentity = identity.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(normalizedIdentity)) {
    throw new Error("Timeline event identity must be 32 hexadecimal characters.");
  }
  const maxSequence = existingEvents.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0
  );
  return {
    id: `evt_${normalizedIdentity}`,
    title: "新事件",
    sequence: Math.max(1, Math.floor(maxSequence) + 1),
    timeLabel: "",
    summary: "",
    chapterIds: [],
    characterIds: [],
    locationIds: [],
    causes: [],
    effects: []
  };
}

export function validateStoryBibleTimeline(
  details: JsonObject
): readonly StoryBibleTimelineValidationIssue[] {
  const events = objectArray(details["events"]);
  const counts = new Map<string, number>();
  for (const event of events) {
    const id = nonEmptyString(event["id"]);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const issues: StoryBibleTimelineValidationIssue[] = [];
  const duplicateIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right, "en-US"));
  for (const eventId of duplicateIds) issues.push({ code: "duplicate-id", eventId });

  for (const [index, event] of events.entries()) {
    const eventId = nonEmptyString(event["id"]) ?? `第 ${index + 1} 个事件`;
    if ((stringValue(event["title"]) ?? "").trim().length === 0) {
      issues.push({ code: "missing-title", eventId });
    }
    const sequence = event["sequence"];
    if (
      typeof sequence !== "number" ||
      !Number.isInteger(sequence) ||
      sequence < 1 ||
      !Number.isFinite(sequence)
    ) {
      issues.push({ code: "invalid-sequence", eventId });
    }
    if (
      stringArray(event["causes"]).includes(eventId) ||
      stringArray(event["effects"]).includes(eventId)
    ) {
      issues.push({ code: "self-reference", eventId });
    }
  }
  return issues;
}

export function storyBibleTimelineValidationMessage(
  issue: StoryBibleTimelineValidationIssue
): string {
  switch (issue.code) {
    case "duplicate-id":
      return `事件 ID ${issue.eventId} 重复。`;
    case "missing-title":
      return `${issue.eventId} 缺少标题。`;
    case "invalid-sequence":
      return `${issue.eventId} 的顺序必须是大于 0 的整数。`;
    case "self-reference":
      return `${issue.eventId} 不能把自身设为前因或后果。`;
  }
}

function compareTimelineEvents(
  left: StoryBibleTimelineEvent,
  right: StoryBibleTimelineEvent
): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id, "en-US");
}

function rawEvents(details: JsonObject): JsonValue[] {
  const events = details["events"];
  return Array.isArray(events) ? events : [];
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
