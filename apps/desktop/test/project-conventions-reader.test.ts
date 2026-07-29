import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  parseAgentContextSourceMaterializationArtifact,
  type ProjectConventionsReadInput,
  type WorkspaceProjectContextProfileId
} from "@novel-studio/application";

import { createDesktopProjectConventionsReader } from "../src/main/project-conventions-reader.js";
import { AgentProjectReadRepository } from "../../../packages/repository/src/agent-project-read-repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopProjectConventionsReader", () => {
  test.each([
    ["engineering", "AGENTS.md"],
    ["writing", "conventions/writing.md"],
    ["creative_general", "conventions/writing.md"]
  ] as const)("reads the fixed %s convention path", async (profileId, relativePath) => {
    const root = await createRoot();
    await mkdir(join(root, "conventions"), { recursive: true });
    await writeFile(join(root, ...relativePath.split("/")), `${profileId} convention`, "utf8");
    const reader = createDesktopProjectConventionsReader({
      projectReads: new AgentProjectReadRepository({ projectRoot: root })
    });

    const result = await reader.read(readInput(profileId));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "available",
        source: {
          sourceKind: "project_conventions",
          relativePath,
          content: `${profileId} convention`,
          dirty: false,
          materialization: {
            schemaVersion: "1.0",
            kind: "project_conventions",
            readerVersion: "1.0",
            instructionPolicy: "content_is_data_not_authority",
            workspaceTrust: "trusted",
            sourceIdentity: {
              workspaceId: `workspace-${profileId}`,
              contextProfileId: profileId,
              canonicalRootIdentity: checksum(`root-${profileId}`),
              relativePath
            }
          }
        }
      }
    });
    if (!result.ok || result.value.status !== "available") return;
    expect(parseAgentContextSourceMaterializationArtifact(result.value.artifact)).toEqual(
      result.value.artifact
    );
    expect(() =>
      parseAgentContextSourceMaterializationArtifact({
        ...result.value.artifact,
        content: "tampered convention"
      })
    ).toThrow("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
    expect(result.value.source.materialization?.originalChecksum).toBe(
      checksum(`${profileId} convention`)
    );
    expect(result.value.source.materialization?.injectedChecksum).toBe(
      checksum(`${profileId} convention`)
    );
  });

  test("returns missing for an absent fixed convention file", async () => {
    const root = await createRoot();
    const reader = createDesktopProjectConventionsReader({
      projectReads: new AgentProjectReadRepository({ projectRoot: root })
    });

    await expect(reader.read(readInput("engineering"))).resolves.toEqual({
      ok: true,
      value: { status: "missing" }
    });
  });

  test("does not read disabled or untrusted workspaces", async () => {
    const projectReads = { readText: vi.fn() };
    const reader = createDesktopProjectConventionsReader({
      projectReads: projectReads as never
    });

    await expect(reader.read({ ...readInput("engineering"), enabled: false })).resolves.toEqual({
      ok: true,
      value: { status: "disabled" }
    });
    await expect(
      reader.read({ ...readInput("engineering"), workspaceTrust: "untrusted" })
    ).resolves.toEqual({ ok: true, value: { status: "untrusted" } });
    expect(projectReads.readText).not.toHaveBeenCalled();
  });

  test("truncates conservatively at Unicode code point boundaries for the shared 4000-token cap", async () => {
    const root = await createRoot();
    const content = "😀".repeat(4_500);
    await writeFile(join(root, "AGENTS.md"), content, "utf8");
    const reader = createDesktopProjectConventionsReader({
      projectReads: new AgentProjectReadRepository({ projectRoot: root })
    });

    const capped = await reader.read(readInput("engineering"));
    expect(capped).toMatchObject({ ok: true, value: { status: "available" } });
    if (!capped.ok || capped.value.status !== "available") return;
    expect(capped.value.source.content).toBe("😀".repeat(1_000));
    expect(capped.value.source.materialization?.tokenCount).toBe(4_000);
    expect(capped.value.source.materialization?.truncationRange).toEqual({
      unit: "unicode_code_point",
      start: 0,
      end: 1_000,
      originalEnd: 4_500
    });

    const inputCapped = await reader.read({ ...readInput("engineering"), maxTokens: 4 });
    expect(inputCapped).toMatchObject({
      ok: true,
      value: { status: "available", source: { content: "😀" } }
    });
  });

  test("keeps the source ref stable while convention content produces a new deterministic artifact", async () => {
    const root = await createRoot();
    const path = join(root, "AGENTS.md");
    await writeFile(path, "first", "utf8");
    const reader = createDesktopProjectConventionsReader({
      projectReads: new AgentProjectReadRepository({ projectRoot: root })
    });

    const first = await reader.read(readInput("engineering"));
    const repeated = await reader.read(readInput("engineering"));
    await writeFile(path, "second", "utf8");
    const changed = await reader.read(readInput("engineering"));
    if (
      !first.ok ||
      !repeated.ok ||
      !changed.ok ||
      first.value.status !== "available" ||
      repeated.value.status !== "available" ||
      changed.value.status !== "available"
    ) {
      throw new Error("Expected available convention sources.");
    }

    expect(repeated.value.source.refId).toBe(first.value.source.refId);
    expect(repeated.value.artifact.artifactId).toBe(first.value.artifact.artifactId);
    expect(changed.value.source.refId).toBe(first.value.source.refId);
    expect(changed.value.artifact.artifactId).not.toBe(first.value.artifact.artifactId);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-project-conventions-"));
  roots.push(root);
  return root;
}

function readInput(profileId: WorkspaceProjectContextProfileId): ProjectConventionsReadInput {
  return {
    workspace: {
      workspaceKind: profileId === "engineering" ? "engineeringWorkspace" : "creativeProject",
      workspaceId: `workspace-${profileId}`,
      canonicalRootIdentity: checksum(`root-${profileId}`)
    },
    profileId,
    workspaceTrust: "trusted",
    enabled: true,
    maxTokens: 4_000,
    modelProfileId: "test-model"
  };
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
