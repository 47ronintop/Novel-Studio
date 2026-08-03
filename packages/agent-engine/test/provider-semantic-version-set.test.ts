import { describe, expect, it } from "vitest";

import {
  createProviderSemanticVersionSetV1,
  parseProviderSemanticVersionSetV1,
  providerSemanticVersionSetChecksum,
  serializeProviderSemanticVersionSetV1
} from "../src/provider-semantic-version-set.js";

function createSet() {
  return createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion: "1.0",
    writingGenerationGuidanceVersion: "not_applicable",
    approvalRuleSetVersion: "all-human@1.0",
    approvalRuleSetChecksum: "07bb0f73b5a5dc515373220f62960be604bae0f4bb141572b45d6cbf336e6664"
  });
}

describe("ProviderSemanticVersionSetV1", () => {
  it("writes the complete target version matrix in canonical order", () => {
    const value = createSet();

    expect(JSON.parse(serializeProviderSemanticVersionSetV1(value))).toEqual(value);
    expect(providerSemanticVersionSetChecksum(value)).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("rejects unknown versions, missing fields, and extra fields", () => {
    const value = createSet();

    expect(() => parseProviderSemanticVersionSetV1({ ...value, schemaVersion: "2.0" })).toThrow(
      "PROVIDER_SEMANTIC_VERSION_SET_INVALID"
    );
    const missing: Record<string, unknown> = { ...value };
    delete missing["messageOrderVersion"];
    expect(() => parseProviderSemanticVersionSetV1(missing)).toThrow(
      "PROVIDER_SEMANTIC_VERSION_SET_INVALID"
    );
    expect(() => parseProviderSemanticVersionSetV1({ ...value, extra: true })).toThrow(
      "PROVIDER_SEMANTIC_VERSION_SET_INVALID"
    );
  });

  it("rejects mismatched rule-set identities and same content with a different expected checksum", () => {
    const value = createSet();

    expect(() =>
      createProviderSemanticVersionSetV1({
        writingTaskIntentSchemaVersion: "not_applicable",
        writingGenerationGuidanceVersion: "not_applicable",
        approvalRuleSetVersion: "not_applicable",
        approvalRuleSetChecksum: "a".repeat(64)
      })
    ).toThrow("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
    expect(() => parseProviderSemanticVersionSetV1(value, "b".repeat(64))).toThrow(
      "PROVIDER_SEMANTIC_VERSION_SET_INVALID"
    );
  });

  it("rejects unknown rule sets and a known version with another checksum", () => {
    expect(() =>
      createProviderSemanticVersionSetV1({
        writingTaskIntentSchemaVersion: "1.0",
        writingGenerationGuidanceVersion: "not_applicable",
        approvalRuleSetVersion: "unknown@1.0",
        approvalRuleSetChecksum: "a".repeat(64)
      })
    ).toThrow("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
    expect(() =>
      createProviderSemanticVersionSetV1({
        writingTaskIntentSchemaVersion: "1.0",
        writingGenerationGuidanceVersion: "not_applicable",
        approvalRuleSetVersion: "all-human@1.0",
        approvalRuleSetChecksum: "b".repeat(64)
      })
    ).toThrow("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  });

  it("allows the canonical read-only not-applicable rule set", () => {
    const value = createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable"
    });

    expect(parseProviderSemanticVersionSetV1(value)).toEqual(value);
  });
});
