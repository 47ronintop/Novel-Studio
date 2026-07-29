import type { JsonObject } from "./errors.js";

export type ForeshadowTrackingStatus =
  "planned" | "planted" | "progressing" | "ready-to-payoff" | "paid-off" | "abandoned";

export type ForeshadowOrigin = "manual" | "ai-confirmed";

export interface ForeshadowSourceRef extends JsonObject {
  readonly chapterId: string;
  readonly excerpt: string;
  readonly excerptHash: string;
}

export interface ForeshadowDetails extends JsonObject {
  readonly trackingStatus: ForeshadowTrackingStatus;
  readonly plantedChapterId?: string;
  readonly plannedPayoffChapterId?: string;
  readonly actualPayoffChapterId?: string;
  readonly sourceRefs?: ForeshadowSourceRef[];
  readonly origin?: ForeshadowOrigin;
  readonly notes?: string;
}

export function normalizeForeshadowEvidence(excerpt: string): string {
  return excerpt.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

export async function hashForeshadowEvidence(excerpt: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) {
    throw new Error("Web Crypto is required to hash foreshadow evidence");
  }

  const normalized = normalizeForeshadowEvidence(excerpt);
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(normalized));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createForeshadowEvidence(
  chapterId: string,
  excerpt: string
): Promise<ForeshadowSourceRef> {
  const normalized = normalizeForeshadowEvidence(excerpt);

  return {
    chapterId,
    excerpt: normalized,
    excerptHash: await hashForeshadowEvidence(normalized)
  };
}
