import { createHash } from "node:crypto";

export const WRITING_TASK_INTENT_SCHEMA_VERSION = "1.0" as const;
export const WRITING_TASK_INTENT_MAX_REQUEST_LENGTH = 4_096;

export type WritingTaskIntentKind =
  "analysis" | "brainstorm" | "continue" | "rewrite" | "story_bible" | "mixed" | "unknown";

export type WritingTaskIntentSource =
  "composer_action" | "bounded_request_classifier" | "user_confirmation";

export type WritingComposerAction = Exclude<WritingTaskIntentKind, "mixed" | "unknown">;

export interface WritingTaskIntent {
  readonly schemaVersion: typeof WRITING_TASK_INTENT_SCHEMA_VERSION;
  readonly kind: WritingTaskIntentKind;
  readonly bodyGeneration: boolean;
  readonly source: WritingTaskIntentSource;
}

export interface CreateWritingTaskIntentInput {
  /** The current user-authored request. Project/tool/remote content has no slot in this API. */
  readonly currentRequest: string;
  /** App-owned composer affordance, when the user invoked a specific action. */
  readonly composerAction?: WritingComposerAction;
  /** Whether the composer has an explicit user selection; selection content is not classified. */
  readonly hasExplicitSelection?: boolean;
  /** A fresh user decision resolving a prior mixed/unknown classification. */
  readonly userConfirmedKind?: Exclude<WritingTaskIntentKind, "mixed" | "unknown">;
}

const KIND_ORDER: readonly Exclude<WritingTaskIntentKind, "mixed" | "unknown">[] = Object.freeze([
  "analysis",
  "brainstorm",
  "continue",
  "rewrite",
  "story_bible"
]);

const PATTERNS: Readonly<
  Record<Exclude<WritingTaskIntentKind, "mixed" | "unknown">, readonly RegExp[]>
> = Object.freeze({
  analysis: Object.freeze([
    /(?:分析|解析|评价|评估|点评|解释|检查|诊断|讨论|总结|梳理|为什么)/u,
    /\b(?:analy[sz]e|analysis|review|explain|evaluate|summari[sz]e)\b/iu
  ]),
  brainstorm: Object.freeze([
    /(?:构思|脑暴|点子|灵感|想法|方案|情节建议|剧情建议|大纲建议)/u,
    /\b(?:brainstorm|ideate|ideas?|outline options?)\b/iu
  ]),
  continue: Object.freeze([
    /(?:续写|接着写|继续写|往下写|补写下一|写下一(?:段|节|章|幕))/u,
    /\b(?:continue|carry on|write the next)\b/iu
  ]),
  rewrite: Object.freeze([
    /(?:改写|重写|润色|扩写|缩写|精修|修订正文|调整文风|修改选中|改一改选中)/u,
    /\b(?:rewrite|revise|polish|rephrase|expand|shorten)\b/iu
  ]),
  story_bible: Object.freeze([
    /(?:故事资料|故事圣经|人物设定|角色设定|世界观设定|地点设定|伏笔资料|时间线资料)/u,
    /\bstory[ -]?bible\b/iu
  ])
});

export function createWritingTaskIntent(input: CreateWritingTaskIntentInput): WritingTaskIntent {
  if (
    !isRecord(input) ||
    !hasOnlyFields(input, [
      "currentRequest",
      "composerAction",
      "hasExplicitSelection",
      "userConfirmedKind"
    ]) ||
    typeof input.currentRequest !== "string" ||
    (input.composerAction !== undefined && !isComposerAction(input.composerAction)) ||
    (input.hasExplicitSelection !== undefined && typeof input.hasExplicitSelection !== "boolean") ||
    (input.userConfirmedKind !== undefined && !isConfirmedKind(input.userConfirmedKind))
  ) {
    throw new Error("WRITING_TASK_INTENT_INPUT_INVALID");
  }
  if (input.composerAction !== undefined) {
    return intent(input.composerAction, "composer_action");
  }
  const classified = classifyBoundedRequest(
    input.currentRequest,
    input.hasExplicitSelection === true
  );
  if (input.userConfirmedKind !== undefined) {
    if (classified.kind !== "mixed" && classified.kind !== "unknown") {
      throw new Error("WRITING_TASK_INTENT_INPUT_INVALID");
    }
    return intent(input.userConfirmedKind, "user_confirmation");
  }
  return classified;
}

function classifyBoundedRequest(
  currentRequest: string,
  hasExplicitSelection: boolean
): WritingTaskIntent {
  if (
    currentRequest.length === 0 ||
    currentRequest.length > WRITING_TASK_INTENT_MAX_REQUEST_LENGTH
  ) {
    return intent("unknown", "bounded_request_classifier");
  }
  const request = currentRequest.normalize("NFC");
  const matches = KIND_ORDER.filter((kind) =>
    PATTERNS[kind].some((pattern) => pattern.test(request))
  );
  if (
    matches.length === 0 &&
    hasExplicitSelection &&
    /(?:修改|调整|优化|处理|edit|change|improve)/iu.test(request)
  ) {
    return intent("rewrite", "bounded_request_classifier");
  }
  if (matches.length === 0) return intent("unknown", "bounded_request_classifier");
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch !== undefined) {
    return intent(onlyMatch, "bounded_request_classifier");
  }
  return deepFreeze({
    schemaVersion: WRITING_TASK_INTENT_SCHEMA_VERSION,
    kind: "mixed",
    bodyGeneration: matches.includes("continue") || matches.includes("rewrite"),
    source: "bounded_request_classifier"
  });
}

export function parseWritingTaskIntent(value: unknown): WritingTaskIntent {
  if (
    !isRecord(value) ||
    !hasExactlyFields(value, ["schemaVersion", "kind", "bodyGeneration", "source"])
  ) {
    throw new Error("WRITING_TASK_INTENT_INVALID");
  }
  const kind = value["kind"];
  const source = value["source"];
  const bodyGeneration = value["bodyGeneration"];
  if (
    value["schemaVersion"] !== WRITING_TASK_INTENT_SCHEMA_VERSION ||
    !isKind(kind) ||
    !isSource(source) ||
    typeof bodyGeneration !== "boolean" ||
    ((source === "composer_action" || source === "user_confirmation") &&
      (kind === "mixed" || kind === "unknown")) ||
    ((kind === "continue" || kind === "rewrite") && !bodyGeneration) ||
    ((kind === "analysis" ||
      kind === "brainstorm" ||
      kind === "story_bible" ||
      kind === "unknown") &&
      bodyGeneration)
  ) {
    throw new Error("WRITING_TASK_INTENT_INVALID");
  }
  return deepFreeze({
    schemaVersion: WRITING_TASK_INTENT_SCHEMA_VERSION,
    kind,
    bodyGeneration,
    source
  });
}

export function serializeWritingTaskIntent(value: WritingTaskIntent): string {
  return JSON.stringify(parseWritingTaskIntent(value));
}

export function writingTaskIntentChecksum(value: WritingTaskIntent): string {
  return createHash("sha256").update(serializeWritingTaskIntent(value), "utf8").digest("hex");
}

function intent(
  kind: Exclude<WritingTaskIntentKind, "mixed">,
  source: WritingTaskIntentSource
): WritingTaskIntent {
  return deepFreeze({
    schemaVersion: WRITING_TASK_INTENT_SCHEMA_VERSION,
    kind,
    bodyGeneration: kind === "continue" || kind === "rewrite",
    source
  });
}

function isKind(value: unknown): value is WritingTaskIntentKind {
  return (
    value === "analysis" ||
    value === "brainstorm" ||
    value === "continue" ||
    value === "rewrite" ||
    value === "story_bible" ||
    value === "mixed" ||
    value === "unknown"
  );
}

function isSource(value: unknown): value is WritingTaskIntentSource {
  return (
    value === "composer_action" ||
    value === "bounded_request_classifier" ||
    value === "user_confirmation"
  );
}

function isComposerAction(value: unknown): value is WritingComposerAction {
  return KIND_ORDER.some((kind) => kind === value);
}

function isConfirmedKind(
  value: unknown
): value is Exclude<WritingTaskIntentKind, "mixed" | "unknown"> {
  return isComposerAction(value);
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
