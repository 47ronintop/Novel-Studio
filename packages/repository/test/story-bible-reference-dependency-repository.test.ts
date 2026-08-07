import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  canonicalizeApprovalDecisionProofJson,
  checksumChangeSetText
} from "@novel-studio/agent-engine";

import {
  StoryBibleReferenceDependencyFileRepository,
  type StoryBibleReferenceDependencyBindingRecordV1
} from "../src/story-bible-reference-dependency-repository.js";

const roots: string[] = [];

describe("StoryBibleReferenceDependencyFileRepository", () => {
  test("writes canonical immutable sidecars in the bound run directory", async () => {
    const projectRoot = await createRoot();
    const repository = new StoryBibleReferenceDependencyFileRepository({ projectRoot });
    const binding = validBinding();

    await expect(repository.writeStoryBibleReferenceDependencyBinding(binding)).resolves.toEqual({
      ok: true,
      value: binding
    });
    await expect(
      repository.readStoryBibleReferenceDependencyBinding({
        runId: binding.runId,
        proofId: binding.proofId,
        proofChecksum: binding.proofChecksum
      })
    ).resolves.toEqual({ ok: true, value: binding });
    await expect(
      readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          binding.runId,
          "story-bible-reference-dependencies",
          `${binding.proofId}.json`
        ),
        "utf8"
      )
    ).resolves.toBe(canonical(binding));
  });

  test("fails closed on cross-restart replay and tampered sidecars", async () => {
    const projectRoot = await createRoot();
    const binding = validBinding();
    const first = new StoryBibleReferenceDependencyFileRepository({
      projectRoot,
      now: () => new Date("2026-08-06T00:00:00.000Z")
    });
    await first.writeStoryBibleReferenceDependencyBinding(binding);
    await expect(
      first.claimStoryBibleReferenceDependencyBinding({ binding, applyAttemptId: "attempt_01" })
    ).resolves.toEqual({ ok: true, value: undefined });

    const restarted = new StoryBibleReferenceDependencyFileRepository({ projectRoot });
    await expect(
      restarted.claimStoryBibleReferenceDependencyBinding({ binding, applyAttemptId: "attempt_02" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_DEPENDENCY_REPLAY" }
    });

    const path = join(
      projectRoot,
      "history",
      "agent-runs",
      binding.runId,
      "story-bible-reference-dependencies",
      `${binding.proofId}.json`
    );
    await writeFile(path, `${canonical(binding)}\n`, "utf8");
    await expect(
      restarted.readStoryBibleReferenceDependencyBinding({
        runId: binding.runId,
        proofId: binding.proofId,
        proofChecksum: binding.proofChecksum
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_CORRUPT" }
    });
  });

  test("does not scan other run directories", async () => {
    const projectRoot = await createRoot();
    const repository = new StoryBibleReferenceDependencyFileRepository({ projectRoot });
    const binding = validBinding();
    await repository.writeStoryBibleReferenceDependencyBinding(binding);

    await expect(
      repository.readStoryBibleReferenceDependencyBinding({
        runId: "run_other",
        proofId: binding.proofId,
        proofChecksum: binding.proofChecksum
      })
    ).resolves.toEqual({ ok: true, value: undefined });
  });
});

function validBinding(): StoryBibleReferenceDependencyBindingRecordV1 {
  const dependencies = [
    {
      resourceKind: "story_bible" as const,
      resourceId: "chr_dependency",
      revision: 4,
      checksum: "d".repeat(64)
    }
  ];
  const dependencyChecksum = checksum(dependencies);
  const referenceImpactComposite = {
    proposalReferenceImpactChecksums: ["e".repeat(64)],
    dependencyChecksum
  };
  const withoutChecksum = {
    schemaVersion: "1.0" as const,
    proofId: "proof_story_bible",
    proofChecksum: "b".repeat(64),
    runId: "run_story_bible",
    changeSetId: "changes_story_bible",
    changeSetRevision: 3,
    changeSetChecksum: "a".repeat(64),
    referenceImpactComposite,
    dependencyChecksum,
    dependencies
  };
  return { ...withoutChecksum, bindingChecksum: checksum(withoutChecksum) };
}

function canonical(value: unknown): string {
  return canonicalizeApprovalDecisionProofJson(value);
}
function checksum(value: unknown): string {
  return checksumChangeSetText(canonical(value));
}
async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-reference-dependency-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
