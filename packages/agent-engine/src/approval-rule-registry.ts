import { createHash } from "node:crypto";

import {
  WRITE_OPERATION_ORDER,
  isProviderVisibleWriteOperation,
  type ProviderVisibleWriteOperation
} from "./agent-tool-capabilities.js";

export const APPROVAL_RULE_SCHEMA_VERSION = "1.0" as const;
export const LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION = "all-human@1.0" as const;
export const DEFAULT_APPROVAL_RULE_SET_VERSION = "novel-studio-core@1.0" as const;

export type ProviderVisibleConditionalApprovalRuleId =
  | "clean_chapter_body_v1"
  | "bounded_chapter_create_v1"
  | "bounded_story_bible_create_v1"
  | "no_reference_impact_story_bible_patch_v1"
  | "ordinary_clean_file_replace_v1"
  | "ordinary_create_only_v1";

export type ProviderVisibleApprovalRule =
  | {
      readonly operation: ProviderVisibleWriteOperation;
      readonly reviewMode: "always_human";
    }
  | {
      readonly operation: ProviderVisibleWriteOperation;
      readonly reviewMode: "conditional_auto_review";
      readonly effectRuleId: ProviderVisibleConditionalApprovalRuleId;
    };

export interface ApprovalEffectRuleDefinitionV1 {
  readonly schemaVersion: typeof APPROVAL_RULE_SCHEMA_VERSION;
  readonly effectRuleId: ProviderVisibleConditionalApprovalRuleId;
  readonly evaluatorContract: {
    readonly requiredEvidence: readonly (
      | "pathClass"
      | "targetFreshness"
      | "createOnly"
      | "referenceImpact"
      | "limits"
      | "stateBoundary"
    )[];
    readonly eligibleValues: Readonly<Record<string, string>>;
  };
  readonly definitionChecksum: string;
}

export interface RegisteredApprovalRuleSetV1 {
  readonly schemaVersion: typeof APPROVAL_RULE_SCHEMA_VERSION;
  readonly version: string;
  readonly checksum: string;
  readonly rules: readonly ProviderVisibleApprovalRule[];
  readonly effectRuleDefinitionChecksums: readonly {
    readonly effectRuleId: ProviderVisibleConditionalApprovalRuleId;
    readonly definitionChecksum: string;
  }[];
}

export interface ProviderVisibleApprovalRuleSetProjection {
  readonly version: string;
  readonly checksum: string;
  readonly rules: readonly ProviderVisibleApprovalRule[];
}

const EFFECT_RULE_INPUTS: Readonly<
  Record<
    ProviderVisibleConditionalApprovalRuleId,
    ApprovalEffectRuleDefinitionV1["evaluatorContract"]
  >
> = Object.freeze({
  clean_chapter_body_v1: {
    requiredEvidence: ["targetFreshness", "limits", "stateBoundary"],
    eligibleValues: {
      targetFreshness: "clean_stable",
      limits: "within",
      stateBoundary: "ordinary"
    }
  },
  bounded_chapter_create_v1: {
    requiredEvidence: ["createOnly", "limits", "stateBoundary"],
    eligibleValues: { createOnly: "proven", limits: "within", stateBoundary: "ordinary" }
  },
  bounded_story_bible_create_v1: {
    requiredEvidence: ["createOnly", "referenceImpact", "limits", "stateBoundary"],
    eligibleValues: {
      createOnly: "proven",
      referenceImpact: "none",
      limits: "within",
      stateBoundary: "ordinary"
    }
  },
  no_reference_impact_story_bible_patch_v1: {
    requiredEvidence: ["targetFreshness", "referenceImpact", "limits", "stateBoundary"],
    eligibleValues: {
      targetFreshness: "clean_stable",
      referenceImpact: "none",
      limits: "within",
      stateBoundary: "ordinary"
    }
  },
  ordinary_clean_file_replace_v1: {
    requiredEvidence: ["pathClass", "targetFreshness", "limits", "stateBoundary"],
    eligibleValues: {
      pathClass: "ordinary",
      targetFreshness: "clean_stable",
      limits: "within",
      stateBoundary: "ordinary"
    }
  },
  ordinary_create_only_v1: {
    requiredEvidence: ["pathClass", "createOnly", "limits", "stateBoundary"],
    eligibleValues: {
      pathClass: "ordinary",
      createOnly: "proven",
      limits: "within",
      stateBoundary: "ordinary"
    }
  }
});

const EFFECT_RULE_DEFINITIONS = deepFreeze(
  Object.entries(EFFECT_RULE_INPUTS).map(([effectRuleId, evaluatorContract]) => {
    const unsigned = {
      schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
      effectRuleId: effectRuleId as ProviderVisibleConditionalApprovalRuleId,
      evaluatorContract
    };
    return {
      ...unsigned,
      definitionChecksum: sha256(canonicalJson(unsigned))
    };
  })
);

const DEFAULT_RULES = deepFreeze(
  WRITE_OPERATION_ORDER.map((operation): ProviderVisibleApprovalRule => {
    switch (operation) {
      case "chapter_replace":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "clean_chapter_body_v1"
        };
      case "chapter_create":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "bounded_chapter_create_v1"
        };
      case "story_bible_create":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "bounded_story_bible_create_v1"
        };
      case "story_bible_patch":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "no_reference_impact_story_bible_patch_v1"
        };
      case "replace_file":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "ordinary_clean_file_replace_v1"
        };
      case "create_file":
        return {
          operation,
          reviewMode: "conditional_auto_review",
          effectRuleId: "ordinary_create_only_v1"
        };
      default:
        return { operation, reviewMode: "always_human" };
    }
  })
);

const LEGACY_ALL_HUMAN_RULES = deepFreeze(
  WRITE_OPERATION_ORDER.map((operation): ProviderVisibleApprovalRule => ({
    operation,
    reviewMode: "always_human"
  }))
);

export const LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM = sha256(
  canonicalJson({
    schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
    version: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    rules: LEGACY_ALL_HUMAN_RULES
  })
);

const DEFAULT_EFFECT_CHECKSUMS = deepFreeze(
  DEFAULT_RULES.flatMap((rule) => {
    if (rule.reviewMode !== "conditional_auto_review") return [];
    const definition = EFFECT_RULE_DEFINITIONS.find(
      (candidate) => candidate.effectRuleId === rule.effectRuleId
    );
    if (definition === undefined) throw new Error("APPROVAL_EFFECT_RULE_UNKNOWN");
    return [
      {
        effectRuleId: definition.effectRuleId,
        definitionChecksum: definition.definitionChecksum
      }
    ];
  })
);

export const DEFAULT_APPROVAL_RULE_SET_CHECKSUM = sha256(
  canonicalJson({
    schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
    version: DEFAULT_APPROVAL_RULE_SET_VERSION,
    rules: DEFAULT_RULES,
    effectRuleDefinitionChecksums: DEFAULT_EFFECT_CHECKSUMS
  })
);

const REGISTRY = deepFreeze({
  [LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION]: {
    schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
    version: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    checksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    rules: LEGACY_ALL_HUMAN_RULES,
    effectRuleDefinitionChecksums: []
  },
  [DEFAULT_APPROVAL_RULE_SET_VERSION]: {
    schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
    version: DEFAULT_APPROVAL_RULE_SET_VERSION,
    checksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
    rules: DEFAULT_RULES,
    effectRuleDefinitionChecksums: DEFAULT_EFFECT_CHECKSUMS
  }
} satisfies Readonly<Record<string, RegisteredApprovalRuleSetV1>>);

export function resolveRegisteredApprovalRuleSet(
  version: string,
  expectedChecksum?: string
): RegisteredApprovalRuleSetV1 {
  const registered = REGISTRY[version as keyof typeof REGISTRY];
  if (
    registered === undefined ||
    (expectedChecksum !== undefined && registered.checksum !== expectedChecksum)
  ) {
    throw new Error("APPROVAL_RULE_SET_UNKNOWN");
  }
  return registered;
}

export function resolveApprovalEffectRuleDefinition(
  effectRuleId: ProviderVisibleConditionalApprovalRuleId
): ApprovalEffectRuleDefinitionV1 {
  const definition = EFFECT_RULE_DEFINITIONS.find(
    (candidate) => candidate.effectRuleId === effectRuleId
  );
  if (definition === undefined) throw new Error("APPROVAL_EFFECT_RULE_UNKNOWN");
  return definition;
}

export function createApprovalRuleSetProjection(
  operations: readonly ProviderVisibleWriteOperation[],
  version: string = DEFAULT_APPROVAL_RULE_SET_VERSION
): ProviderVisibleApprovalRuleSetProjection {
  const canonicalOperations = canonicalizeWriteOperations(operations);
  const registered = resolveRegisteredApprovalRuleSet(version);
  const selected = registered.rules.filter((rule) => canonicalOperations.includes(rule.operation));
  if (selected.length !== canonicalOperations.length) throw new Error("APPROVAL_RULE_SET_INVALID");
  return deepFreeze({ version, checksum: registered.checksum, rules: selected });
}

export function parseApprovalRuleSetProjection(
  value: unknown,
  operations: readonly ProviderVisibleWriteOperation[]
): ProviderVisibleApprovalRuleSetProjection {
  if (!isRecord(value) || !hasExactlyFields(value, ["version", "checksum", "rules"])) {
    throw new Error("APPROVAL_RULE_SET_INVALID");
  }
  if (typeof value["version"] !== "string" || typeof value["checksum"] !== "string") {
    throw new Error("APPROVAL_RULE_SET_INVALID");
  }
  const expected = createApprovalRuleSetProjection(operations, value["version"]);
  if (
    value["checksum"] !== expected.checksum ||
    canonicalJson(value["rules"]) !== canonicalJson(expected.rules)
  ) {
    throw new Error("APPROVAL_RULE_SET_INVALID");
  }
  return expected;
}

export function approvalRuleForOperation(
  operation: ProviderVisibleWriteOperation,
  version: string = DEFAULT_APPROVAL_RULE_SET_VERSION
): ProviderVisibleApprovalRule {
  const rule = resolveRegisteredApprovalRuleSet(version).rules.find(
    (candidate) => candidate.operation === operation
  );
  if (rule === undefined) throw new Error("APPROVAL_RULE_SET_INVALID");
  return rule;
}

export function canonicalizeWriteOperations(
  operations: readonly ProviderVisibleWriteOperation[]
): readonly ProviderVisibleWriteOperation[] {
  if (
    !Array.isArray(operations) ||
    operations.some((operation) => !isProviderVisibleWriteOperation(operation))
  ) {
    throw new Error("APPROVAL_RULE_SET_INVALID");
  }
  const unique = new Set(operations);
  if (unique.size !== operations.length) throw new Error("APPROVAL_RULE_SET_INVALID");
  return Object.freeze(WRITE_OPERATION_ORDER.filter((operation) => unique.has(operation)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("APPROVAL_RULE_SET_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("APPROVAL_RULE_SET_INVALID");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
