import type { StoryBibleV11AssetType } from "./story-bible.js";

export type StoryBibleCompletenessStatus = "complete" | "partial" | "insufficient";
export type StoryBibleCompletenessImportance = "required" | "recommended";
export type StoryBibleCompletenessCheckStatus = "present" | "missing" | "weak";

export interface StoryBibleCompletenessInput {
  readonly type: StoryBibleV11AssetType;
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly details?: unknown;
}

export interface StoryBibleCompletenessCheck {
  readonly path: string;
  readonly label: string;
  readonly importance: StoryBibleCompletenessImportance;
  readonly status: StoryBibleCompletenessCheckStatus;
  readonly message: string;
  readonly suggestedAction: string;
}

export interface StoryBibleCompletenessCounts {
  readonly total: number;
  readonly present: number;
  readonly missing: number;
  readonly weak: number;
}

export interface StoryBibleCompletenessReport {
  readonly schemaVersion: "1.0";
  readonly status: StoryBibleCompletenessStatus;
  readonly score: number;
  readonly required: StoryBibleCompletenessCounts;
  readonly recommended: StoryBibleCompletenessCounts;
  readonly checks: readonly StoryBibleCompletenessCheck[];
}

type FieldKind = "string" | "array" | "stringOrArray" | "textOrCollection" | "object";

interface FieldDefinition {
  readonly path: string;
  readonly label: string;
  readonly importance: StoryBibleCompletenessImportance;
  readonly kind?: FieldKind;
  /** Text shorter than this is usable but not yet substantive. */
  readonly weakBelow?: number;
}

const FIELD_DEFINITIONS: Readonly<Record<StoryBibleV11AssetType, readonly FieldDefinition[]>> = {
  character: [
    field("/details/role", "角色定位", "required", "string", 4),
    field("/details/goals", "目标", "required", "textOrCollection", 8),
    field("/details/personality", "性格", "recommended", "textOrCollection", 8),
    field("/details/voice", "说话方式", "recommended", "textOrCollection", 8),
    field("/details/conflicts", "核心冲突", "recommended", "array"),
    field("/details/arc", "人物弧光", "recommended", "object"),
    field("/details/limitations", "能力边界", "recommended", "array")
  ],
  "world.location": [
    field("/details/geography", "地理环境", "required", "string", 8),
    field("/details/culture", "文化特征", "recommended", "string", 8),
    field("/details/constraints", "地点限制", "recommended", "stringOrArray", 8)
  ],
  "world.faction": [
    field("/details/goals", "势力目标", "required", "stringOrArray", 8),
    field("/details/structure", "组织结构", "required", "string", 8),
    field("/details/membersOrInfluence", "成员或影响力", "recommended", "string", 8),
    field("/details/resources", "资源", "recommended", "array")
  ],
  "world.rule": [
    field("/details/scope", "适用范围", "required", "string", 8),
    field("/details/constraints", "规则约束", "recommended", "stringOrArray", 8),
    field("/details/costs", "使用代价", "recommended", "array"),
    field("/details/exceptions", "例外情况", "recommended", "array")
  ],
  "world.glossary": [
    field("/details/definition", "术语定义", "required", "string", 8),
    field("/details/firstAppearance", "首次出现", "recommended", "string", 8),
    field("/details/termAliases", "术语别名", "recommended", "array"),
    field("/details/relatedRuleIds", "关联规则", "recommended", "array")
  ],
  "world.item": [
    field("/details/appearance", "外观描述", "required", "string", 8),
    field("/details/state", "当前状态", "required", "string", 4),
    field("/details/origin", "来源", "recommended", "string", 8),
    field("/details/abilities", "能力或用途", "recommended", "array"),
    field("/details/limitations", "使用限制", "recommended", "array")
  ],
  "world.lore": [
    field("/details/body", "背景正文", "required", "string", 20),
    field("/details/periods", "历史时期", "recommended", "array"),
    field("/details/institutions", "制度机构", "recommended", "array"),
    field("/details/customs", "风俗", "recommended", "array"),
    field("/details/legends", "传说", "recommended", "array"),
    field("/details/systems", "社会系统", "recommended", "array")
  ],
  outline: [
    field("/details/premise", "故事前提", "required", "string", 20),
    field("/details/themes", "主题", "recommended", "array"),
    field("/details/volumes", "卷纲", "recommended", "array"),
    field("/details/chapterOutlines", "章节大纲", "recommended", "array")
  ],
  foreshadow: [
    field("/details/trackingStatus", "追踪状态", "required", "string"),
    field("/details/milestones", "追踪里程碑", "recommended", "array"),
    field("/details/plantedChapterId", "埋设章节", "recommended", "string"),
    field("/details/plannedPayoffChapterId", "计划回收章节", "recommended", "string"),
    field("/details/notes", "伏笔说明", "recommended", "string", 12)
  ],
  "timeline.events": [field("/details/events", "时间线事件", "required", "array")]
};

/**
 * Produces a deterministic, read-only completeness report for an Agent-safe
 * Story Bible asset or draft. It deliberately does not infer facts from prose.
 */
export function evaluateStoryBibleCompleteness(
  input: StoryBibleCompletenessInput
): StoryBibleCompletenessReport {
  const checks: StoryBibleCompletenessCheck[] = [];
  checks.push(
    evaluateField(input.title, {
      path: "/title",
      label: "资料标题",
      importance: "required",
      kind: "string"
    })
  );
  checks.push(
    evaluateField(input.summary, {
      path: "/summary",
      label: "资料摘要",
      importance: "recommended",
      kind: "string",
      weakBelow: 12
    })
  );

  const details = isRecord(input.details) ? input.details : undefined;
  for (const definition of FIELD_DEFINITIONS[input.type] ?? []) {
    const value = details?.[lastPathSegment(definition.path)];
    checks.push(evaluateField(value, definition));
  }

  if (input.type === "world.rule") {
    const rule = details?.["rule"];
    const statement = details?.["statement"];
    if (!hasValue(rule) && !hasValue(statement)) {
      checks.push({
        path: "/details/rule|/details/statement",
        label: "规则陈述",
        importance: "required",
        status: "missing",
        message: "规则需要填写 rule 或 statement。",
        suggestedAction: "补充规则的明确陈述。"
      });
    } else {
      const value = [rule, statement]
        .filter((candidate) => hasValue(candidate))
        .sort((left, right) => textLength(right) - textLength(left))[0];
      const status = textStatus(value, 8);
      checks.push({
        path: "/details/rule|/details/statement",
        label: "规则陈述",
        importance: "required",
        status,
        message: status === "present" ? "规则陈述已填写。" : "规则陈述内容偏短，信息可能不足。",
        suggestedAction: status === "present" ? "" : "补充更明确的规则陈述。"
      });
    }
  }

  if (input.type === "foreshadow" && details?.["trackingStatus"] === "paid-off") {
    checks.push(
      evaluateField(details["actualPayoffChapterId"], {
        path: "/details/actualPayoffChapterId",
        label: "实际回收章节",
        importance: "required",
        kind: "string"
      })
    );
    const hasPayoffMilestone =
      Array.isArray(details["milestones"]) &&
      details["milestones"].some(
        (milestone) => isRecord(milestone) && milestone["kind"] === "payoff"
      );
    checks.push({
      path: "/details/milestones[kind=payoff]",
      label: "实际回收里程碑",
      importance: "required",
      status: hasPayoffMilestone ? "present" : "missing",
      message: hasPayoffMilestone ? "实际回收里程碑已记录。" : "已回收伏笔尚未记录 payoff 里程碑。",
      suggestedAction: hasPayoffMilestone ? "" : "补充包含 kind=payoff 的回收里程碑。"
    });
  }

  const required = countChecks(checks, "required");
  const recommended = countChecks(checks, "recommended");
  const totalWeight = required.total * 2 + recommended.total;
  const earnedWeight =
    required.present * 2 + required.weak + recommended.present + recommended.weak * 0.5;
  const score = totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 100);
  const hasRequiredProblem = required.missing > 0;
  const hasAnyProblem =
    hasRequiredProblem || required.weak > 0 || recommended.missing > 0 || recommended.weak > 0;
  const status: StoryBibleCompletenessStatus = hasRequiredProblem
    ? "insufficient"
    : hasAnyProblem
      ? "partial"
      : "complete";

  return {
    schemaVersion: "1.0",
    status,
    score,
    required,
    recommended,
    checks
  };
}

function field(
  path: string,
  label: string,
  importance: StoryBibleCompletenessImportance,
  kind: FieldKind | "object" = "string",
  weakBelow?: number
): FieldDefinition {
  return weakBelow === undefined
    ? { path, label, importance, kind }
    : { path, label, importance, kind, weakBelow };
}

function evaluateField(value: unknown, definition: FieldDefinition): StoryBibleCompletenessCheck {
  const kind = definition.kind ?? "string";
  let status: StoryBibleCompletenessCheckStatus;
  if (!hasValue(value, kind)) {
    status = "missing";
  } else if (definition.weakBelow !== undefined && textLength(value) < definition.weakBelow) {
    status = "weak";
  } else {
    status = "present";
  }
  const action =
    status === "present"
      ? ""
      : status === "weak"
        ? `补充更具体的${definition.label}。`
        : `填写${definition.label}。`;
  return {
    path: definition.path,
    label: definition.label,
    importance: definition.importance,
    status,
    message:
      status === "present"
        ? `${definition.label}已填写。`
        : status === "weak"
          ? `${definition.label}内容偏短，信息可能不足。`
          : `${definition.label}尚未填写。`,
    suggestedAction: action
  };
}

function countChecks(
  checks: readonly StoryBibleCompletenessCheck[],
  importance: StoryBibleCompletenessImportance
): StoryBibleCompletenessCounts {
  const scoped = checks.filter((check) => check.importance === importance);
  return {
    total: scoped.length,
    present: scoped.filter((check) => check.status === "present").length,
    missing: scoped.filter((check) => check.status === "missing").length,
    weak: scoped.filter((check) => check.status === "weak").length
  };
}

function hasValue(value: unknown, kind: FieldKind | "object" = "string"): boolean {
  if (kind === "array")
    return Array.isArray(value) && value.some((entry) => isMeaningfulValue(entry));
  if (kind === "stringOrArray") return hasValue(value, "string") || hasValue(value, "array");
  if (kind === "textOrCollection") {
    return hasValue(value, "string") || hasValue(value, "array") || hasValue(value, "object");
  }
  if (kind === "object") return isRecord(value) && isMeaningfulValue(value);
  return typeof value === "string" && value.trim().length > 0;
}

function isMeaningfulValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => isMeaningfulValue(entry, seen));
  return Object.values(value).some((entry) => isMeaningfulValue(entry, seen));
}

function textStatus(value: unknown, weakBelow: number): StoryBibleCompletenessCheckStatus {
  if (!hasValue(value)) return "missing";
  return textLength(value) < weakBelow ? "weak" : "present";
}

function textLength(value: unknown, seen = new Set<object>()): number {
  if (typeof value === "string") return value.trim().length;
  if (value === null || value === undefined || typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + textLength(entry, seen), 0);
  }
  return Object.values(value).reduce((total, entry) => total + textLength(entry, seen), 0);
}

function lastPathSegment(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
