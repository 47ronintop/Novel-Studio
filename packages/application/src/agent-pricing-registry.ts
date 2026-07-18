import {
  calculateAgentUsageEstimatedCost,
  type AgentUsageUnitPriceSnapshot
} from "@novel-studio/agent-engine";
import type { LlmCost, LlmUsage } from "@novel-studio/llm-adapter";

export interface AgentPricingEntry {
  readonly provider: string;
  readonly model: string;
  readonly unitPrices: AgentUsageUnitPriceSnapshot;
}

export interface AgentPricingTable {
  readonly version: string;
  readonly entries: readonly AgentPricingEntry[];
}

export interface AgentUsagePricingInput {
  readonly provider: string;
  readonly model: string;
  readonly usage: LlmUsage & {
    readonly cachedTokens?: number;
    readonly reasoningTokens?: number;
  };
}

export interface AgentUsagePricing {
  readonly pricingVersion: string | null;
  readonly unitPrices: AgentUsageUnitPriceSnapshot | null;
  readonly cost: LlmCost;
}

export interface AgentPricingRegistry {
  price(input: AgentUsagePricingInput): AgentUsagePricing;
}

/**
 * Creates a versioned, exact-match pricing registry. Calling `price` produces a value suitable for
 * immediate persistence; it does not retain usage records and cannot recalculate historical costs.
 */
export function createAgentPricingRegistry(table: AgentPricingTable): AgentPricingRegistry {
  validateTable(table);
  const entries = new Map<string, AgentUsageUnitPriceSnapshot>();
  for (const entry of table.entries) {
    entries.set(key(entry.provider, entry.model), snapshot(entry.unitPrices));
  }
  const version = table.version;

  return {
    price(input) {
      if (input.usage.usageStatus === "missing") return unknownCost();
      if (input.usage.cost.status === "actual") {
        return {
          pricingVersion: null,
          unitPrices: null,
          cost: { ...input.usage.cost }
        };
      }

      const unitPrices = entries.get(key(input.provider, input.model));
      if (!unitPrices) return unknownCost();
      if (input.usage.cachedTokens !== undefined && unitPrices.cachedPerMillion === undefined) {
        return unknownCost();
      }
      if (
        input.usage.reasoningTokens !== undefined &&
        unitPrices.reasoningPerMillion === undefined
      ) {
        return unknownCost();
      }

      return {
        pricingVersion: version,
        unitPrices: snapshot(unitPrices),
        cost: {
          amount: calculateAgentUsageEstimatedCost({
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens,
            ...(input.usage.cachedTokens === undefined
              ? {}
              : { cachedTokens: input.usage.cachedTokens }),
            ...(input.usage.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: input.usage.reasoningTokens }),
            unitPrices
          }),
          currency: unitPrices.currency,
          status: "estimated"
        }
      };
    }
  };
}

function validateTable(table: AgentPricingTable): void {
  if (table.version.trim().length === 0)
    throw new Error("Agent pricing version must not be empty.");

  const seen = new Set<string>();
  for (const entry of table.entries) {
    if (!isExactKeyPart(entry.provider) || !isExactKeyPart(entry.model)) {
      throw new Error("Agent pricing entries require exact provider and model names.");
    }
    const entryKey = key(entry.provider, entry.model);
    if (seen.has(entryKey)) throw new Error("Agent pricing entries must be unique.");
    seen.add(entryKey);
    validateUnitPrices(entry.unitPrices);
  }
}

function validateUnitPrices(prices: AgentUsageUnitPriceSnapshot): void {
  if (prices.currency.trim().length === 0)
    throw new Error("Agent pricing currency must not be empty.");
  if (!isUnitPrice(prices.inputPerMillion) || !isUnitPrice(prices.outputPerMillion)) {
    throw new Error("Agent unit prices must be finite non-negative amounts.");
  }
  const optionalValues = [prices.cachedPerMillion, prices.reasoningPerMillion];
  if (optionalValues.some((value) => value !== undefined && !isUnitPrice(value))) {
    throw new Error("Agent unit prices must be finite non-negative amounts.");
  }
}

function isUnitPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isExactKeyPart(value: string): boolean {
  return value.trim().length > 0 && !value.includes("*");
}

function key(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

function snapshot(prices: AgentUsageUnitPriceSnapshot): AgentUsageUnitPriceSnapshot {
  return {
    inputPerMillion: prices.inputPerMillion,
    outputPerMillion: prices.outputPerMillion,
    ...(prices.cachedPerMillion === undefined ? {} : { cachedPerMillion: prices.cachedPerMillion }),
    ...(prices.reasoningPerMillion === undefined
      ? {}
      : { reasoningPerMillion: prices.reasoningPerMillion }),
    currency: prices.currency
  };
}

function unknownCost(): AgentUsagePricing {
  return {
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" }
  };
}
