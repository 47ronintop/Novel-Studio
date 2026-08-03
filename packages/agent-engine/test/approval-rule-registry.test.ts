import { describe, expect, test } from "vitest";

import {
  APPROVAL_RULE_SCHEMA_VERSION,
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  approvalRuleForOperation,
  createApprovalRuleSetProjection,
  parseApprovalRuleSetProjection,
  resolveApprovalEffectRuleDefinition,
  resolveRegisteredApprovalRuleSet
} from "../src/approval-rule-registry.js";
import { WRITE_OPERATION_ORDER } from "../src/agent-tool-capabilities.js";

describe("Approval rule registry", () => {
  test("freezes a versioned rule set with immutable effect-rule definitions", () => {
    const ruleSet = resolveRegisteredApprovalRuleSet(DEFAULT_APPROVAL_RULE_SET_VERSION);

    expect(ruleSet).toMatchObject({
      schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
      version: DEFAULT_APPROVAL_RULE_SET_VERSION,
      checksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM
    });
    expect(Object.isFrozen(ruleSet)).toBe(true);
    expect(Object.isFrozen(ruleSet.rules)).toBe(true);
    expect(Object.isFrozen(ruleSet.effectRuleDefinitionChecksums)).toBe(true);
    expect(ruleSet.rules.map((rule) => rule.operation)).toEqual(WRITE_OPERATION_ORDER);

    const conditionalRules = ruleSet.rules.filter(
      (
        rule
      ): rule is Extract<
        (typeof ruleSet.rules)[number],
        { reviewMode: "conditional_auto_review" }
      > => rule.reviewMode === "conditional_auto_review"
    );
    expect(ruleSet.effectRuleDefinitionChecksums.map((entry) => entry.effectRuleId)).toEqual(
      conditionalRules.map((rule) => rule.effectRuleId)
    );
    expect(approvalRuleForOperation("replace_file")).toMatchObject({
      reviewMode: "conditional_auto_review",
      effectRuleId: "ordinary_clean_file_replace_v1"
    });
    expect(approvalRuleForOperation("create_file")).toMatchObject({
      reviewMode: "conditional_auto_review",
      effectRuleId: "ordinary_create_only_v1"
    });

    for (const rule of conditionalRules) {
      const definition = resolveApprovalEffectRuleDefinition(rule.effectRuleId);
      expect(definition).toMatchObject({
        schemaVersion: APPROVAL_RULE_SCHEMA_VERSION,
        effectRuleId: rule.effectRuleId
      });
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.evaluatorContract)).toBe(true);
      expect(
        ruleSet.effectRuleDefinitionChecksums.find(
          (entry) => entry.effectRuleId === rule.effectRuleId
        )?.definitionChecksum
      ).toBe(definition.definitionChecksum);
    }
  });

  test("maps every public mutation to exactly one canonical rule", () => {
    const ruleSet = resolveRegisteredApprovalRuleSet(DEFAULT_APPROVAL_RULE_SET_VERSION);

    expect(ruleSet.rules).toHaveLength(WRITE_OPERATION_ORDER.length);
    for (const operation of WRITE_OPERATION_ORDER) {
      const matches = ruleSet.rules.filter((rule) => rule.operation === operation);
      expect(matches).toHaveLength(1);
      expect(approvalRuleForOperation(operation)).toEqual(matches[0]);
    }
  });

  test("rejects unknown, checksum-mismatched, and body-mismatched rule-set projections", () => {
    const operations = ["create_file", "chapter_replace"] as const;
    const projection = createApprovalRuleSetProjection(operations);
    const roundTrip = parseApprovalRuleSetProjection(
      JSON.parse(JSON.stringify(projection)),
      operations
    );
    expect(roundTrip).toEqual(projection);

    const changedRules = projection.rules.map((rule) =>
      rule.operation === "chapter_replace"
        ? { operation: rule.operation, reviewMode: "always_human" as const }
        : rule
    );
    expect(() =>
      parseApprovalRuleSetProjection({ ...projection, rules: changedRules }, operations)
    ).toThrow("APPROVAL_RULE_SET_INVALID");
    expect(() =>
      parseApprovalRuleSetProjection({ ...projection, checksum: "0".repeat(64) }, operations)
    ).toThrow("APPROVAL_RULE_SET_INVALID");
    expect(() => createApprovalRuleSetProjection(operations, "novel-studio-core@999.0")).toThrow(
      "APPROVAL_RULE_SET_UNKNOWN"
    );
    expect(() =>
      resolveRegisteredApprovalRuleSet(DEFAULT_APPROVAL_RULE_SET_VERSION, "0".repeat(64))
    ).toThrow("APPROVAL_RULE_SET_UNKNOWN");
  });
});
