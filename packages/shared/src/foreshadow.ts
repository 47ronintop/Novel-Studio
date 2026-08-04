import type { JsonObject } from "./errors.js";

export type ForeshadowTrackingStatus =
  "planned" | "planted" | "progressing" | "ready-to-payoff" | "paid-off" | "abandoned";

export type ForeshadowOrigin = "manual" | "ai-confirmed";

export const FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING =
  "FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING" as const;

export interface ForeshadowContractWarning extends JsonObject {
  readonly code: typeof FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING;
  readonly severity: "warning";
  readonly path: "/details/actualPayoffChapterId";
  readonly message: string;
}

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

export function collectForeshadowContractWarnings(
  details: Readonly<Record<string, unknown>>
): readonly ForeshadowContractWarning[] {
  if (
    details["trackingStatus"] !== "paid-off" ||
    (typeof details["actualPayoffChapterId"] === "string" &&
      details["actualPayoffChapterId"].trim().length > 0)
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    Object.freeze({
      code: FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
      severity: "warning" as const,
      path: "/details/actualPayoffChapterId" as const,
      message: "A paid-off foreshadow has no actual payoff chapter."
    })
  ]);
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
