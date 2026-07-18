import { describe, expect, test } from "vitest";

import {
  createAgentPricingRegistry,
  type AgentPricingRegistry,
  type AgentPricingTable
} from "../src/agent-pricing-registry.js";

const table: AgentPricingTable = {
  version: "2026-07-17",
  entries: [
    {
      provider: "openai",
      model: "gpt-5",
      unitPrices: {
        inputPerMillion: 2,
        outputPerMillion: 8,
        cachedPerMillion: 0.5,
        reasoningPerMillion: 12,
        currency: "USD"
      }
    }
  ]
};
const [defaultEntry] = table.entries;
if (defaultEntry === undefined) throw new Error("Expected one pricing entry fixture");

describe("AgentPricingRegistry", () => {
  test("captures an exact versioned price snapshot and computes an estimate", () => {
    const registry = createAgentPricingRegistry(table);

    expect(
      registry.price({
        provider: "openai",
        model: "gpt-5",
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 2_000_000,
          cachedTokens: 3_000_000,
          reasoningTokens: 4_000_000,
          totalTokens: 10_000_000,
          usageStatus: "actual",
          cost: { amount: 0, currency: "", status: "unknown" }
        }
      })
    ).toEqual({
      pricingVersion: "2026-07-17",
      unitPrices: table.entries[0]?.unitPrices,
      cost: { amount: 67.5, currency: "USD", status: "estimated" }
    });
  });

  test("keeps an actual provider cost authoritative without registry-derived fields", () => {
    const registry = createAgentPricingRegistry(table);

    expect(
      registry.price({
        provider: "openai",
        model: "gpt-5",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          usageStatus: "actual",
          cost: { amount: 1.23, currency: "CNY", status: "actual" }
        }
      })
    ).toEqual({
      pricingVersion: null,
      unitPrices: null,
      cost: { amount: 1.23, currency: "CNY", status: "actual" }
    });
  });

  test("returns an unknown cost when no exact price exists", () => {
    const registry = createAgentPricingRegistry(table);

    expect(
      registry.price({
        provider: "openai",
        model: "other-model",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          usageStatus: "missing",
          cost: { amount: 0, currency: "", status: "unknown" }
        }
      })
    ).toEqual({
      pricingVersion: null,
      unitPrices: null,
      cost: { amount: 0, currency: "", status: "unknown" }
    });
  });

  test("keeps cost unknown when provider usage is missing even if an exact price exists", () => {
    const registry = createAgentPricingRegistry(table);

    expect(
      registry.price({
        provider: "openai",
        model: "gpt-5",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          usageStatus: "missing",
          cost: { amount: 0, currency: "", status: "unknown" }
        }
      })
    ).toEqual({
      pricingVersion: null,
      unitPrices: null,
      cost: { amount: 0, currency: "", status: "unknown" }
    });
  });

  test.each([
    ["cached", { cachedTokens: 3 }],
    ["reasoning", { reasoningTokens: 2 }]
  ] as const)(
    "keeps cost unknown when reported %s tokens have no matching unit price",
    (_label, tokens) => {
      const registry = createAgentPricingRegistry({
        version: "2026-07-17",
        entries: [
          {
            provider: "openai",
            model: "gpt-5",
            unitPrices: { inputPerMillion: 2, outputPerMillion: 8, currency: "USD" }
          }
        ]
      });

      expect(
        registry.price({
          provider: "openai",
          model: "gpt-5",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            usageStatus: "actual",
            cost: { amount: 0, currency: "", status: "unknown" },
            ...tokens
          }
        })
      ).toEqual({
        pricingVersion: null,
        unitPrices: null,
        cost: { amount: 0, currency: "", status: "unknown" }
      });
    }
  );

  test.each(["inputPerMillion", "outputPerMillion"] as const)(
    "rejects a pricing table missing required %s",
    (missingField) => {
      const unitPrices = Object.fromEntries(
        Object.entries(defaultEntry.unitPrices).filter(([key]) => key !== missingField)
      );
      const invalidTable = {
        version: "v1",
        entries: [{ provider: "openai", model: "gpt-5", unitPrices }]
      } as unknown as AgentPricingTable;

      expect(() => createAgentPricingRegistry(invalidTable)).toThrow();
    }
  );

  test.each([
    { version: "", entries: [] },
    { version: "v1", entries: [{ ...defaultEntry, provider: "*" }] },
    { version: "v1", entries: [{ ...defaultEntry, model: "gpt-*" }] },
    {
      version: "v1",
      entries: [
        {
          ...defaultEntry,
          unitPrices: { ...defaultEntry.unitPrices, inputPerMillion: -1 }
        }
      ]
    },
    { version: "v1", entries: [{ ...defaultEntry }, { ...defaultEntry }] }
  ] as const)("rejects invalid or ambiguous tables", (invalidTable) => {
    expect(() => createAgentPricingRegistry(invalidTable)).toThrow();
  });

  test("has a small injectable registry contract", () => {
    const registry: AgentPricingRegistry = createAgentPricingRegistry(table);
    expect(registry.price).toBeTypeOf("function");
  });
});
