import { describe, expect, test } from "vitest";

import {
  chapterStatusTransitionProofChecksum,
  createChapterStatusTransitionProof,
  isChapterStatusTransitionProof,
  parseChapterStatusTransitionProof,
  parseChapterStatusTransitionProofJson,
  serializeChapterStatusTransitionProof,
  type CreateChapterStatusTransitionProofInput
} from "../src/chapter-status-transition-proof.js";

describe("chapter status transition proof", () => {
  test("creates an immutable, deterministic delete proof", () => {
    const proof = createChapterStatusTransitionProof(deleteInput());
    expect(proof).toMatchObject({
      action: "delete",
      beforeStatus: "review",
      afterStatus: "deleted",
      restoreStatus: "review"
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.beforeNeighborRefs)).toBe(true);
    expect(serializeChapterStatusTransitionProof(proof)).toBe(
      serializeChapterStatusTransitionProof(parseChapterStatusTransitionProof(proof))
    );
    expect(chapterStatusTransitionProofChecksum(proof)).toBe(proof.proofChecksum);
  });

  test("enforces archive, delete, and restore boundaries", () => {
    expect(() =>
      createChapterStatusTransitionProof({
        ...deleteInput(),
        action: "archive",
        afterStatus: "archived",
        restoreStatus: "review"
      })
    ).toThrow("CHAPTER_STATUS_TRANSITION_PROOF_INVALID");
    expect(() =>
      createChapterStatusTransitionProof({
        ...deleteInput(),
        action: "delete",
        beforeStatus: "deleted"
      })
    ).toThrow("CHAPTER_STATUS_TRANSITION_PROOF_INVALID");
    expect(() =>
      createChapterStatusTransitionProof({
        ...deleteInput(),
        action: "restore",
        beforeStatus: "review",
        afterStatus: "review",
        restoreStatus: "review"
      })
    ).toThrow("CHAPTER_STATUS_TRANSITION_PROOF_INVALID");
    expect(
      createChapterStatusTransitionProof({
        ...deleteInput(),
        action: "restore",
        beforeStatus: "deleted",
        afterStatus: "review",
        restoreStatus: "review"
      })
    ).toMatchObject({ action: "restore", beforeStatus: "deleted", afterStatus: "review" });
  });

  test("detects tampering and rejects noncanonical JSON", () => {
    const proof = createChapterStatusTransitionProof(deleteInput());
    expect(() =>
      parseChapterStatusTransitionProof({ ...proof, afterChecksum: "e".repeat(64) })
    ).toThrow("CHAPTER_STATUS_TRANSITION_PROOF_INVALID");
    const serialized = serializeChapterStatusTransitionProof(proof);
    expect(parseChapterStatusTransitionProofJson(serialized)).toEqual(proof);
    expect(() => parseChapterStatusTransitionProofJson(`${serialized}\n`)).toThrow(
      "CHAPTER_STATUS_TRANSITION_PROOF_INVALID"
    );
  });

  test("fails closed when restore proof is incomplete or damaged", () => {
    const proof = createChapterStatusTransitionProof(deleteInput());
    const incomplete = { ...proof, restoreStatus: null, proofChecksum: proof.proofChecksum };
    expect(isChapterStatusTransitionProof(incomplete)).toBe(false);
    expect(() => parseChapterStatusTransitionProof(incomplete)).toThrow(
      "CHAPTER_STATUS_TRANSITION_PROOF_INVALID"
    );
    const damaged = { ...proof, beforeNeighborRefs: { before: null, after: null } };
    expect(isChapterStatusTransitionProof(damaged)).toBe(false);
  });
});

function deleteInput(): CreateChapterStatusTransitionProofInput {
  return {
    proofId: "proof-chapter-delete-01",
    stableRef: "chapter:chapter-01",
    chapterId: "chapter-01",
    action: "delete",
    beforeStatus: "review",
    afterStatus: "deleted",
    restoreStatus: "review",
    beforeRevision: 4,
    afterRevision: 5,
    beforeChecksum: "a".repeat(64),
    afterChecksum: "b".repeat(64),
    outlineRevision: 12,
    outlineChecksum: "c".repeat(64),
    originalVolumeRef: "volume:volume-01",
    beforeNeighborRefs: { before: "chapter:chapter-00", after: "chapter:chapter-02" },
    afterNeighborRefs: { before: "chapter:chapter-00", after: "chapter:chapter-02" },
    referenceImpactChecksum: "d".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z"
  };
}
