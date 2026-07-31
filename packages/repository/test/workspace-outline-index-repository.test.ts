import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ok } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  WorkspaceOutlineIndexRepository,
  WorkspaceOutlineProjectEntryRepository,
  WorkspaceOutlineProjectMetadataRepository,
  buildCreativeProjectFileTreeOutlineIndex,
  type CreativeProjectFileTreeSnapshot,
  type WorkspaceOutlineGuardedEntryReader,
  type WorkspaceOutlineIndexLimits
} from "../src/index.js";

const defaultLimits: WorkspaceOutlineIndexLimits = {
  maxDepth: 2,
  maxEntries: 200,
  maxScannedEntries: 1_000,
  maxBytes: 64 * 1_024,
  maxDurationMs: 1_000
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceOutlineIndexRepository", () => {
  test("guards concrete engineering directory metadata and enforces scan limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-engineering-index-"));
    roots.push(root);
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "README.md"), "readme", "utf8");
    await writeFile(join(root, "src", "main.ts"), "export {};", "utf8");

    const source = new WorkspaceOutlineProjectEntryRepository({ projectRoot: root });
    const listed = await source.listEntries("", {
      maxEntries: 100,
      maxBytes: 64 * 1_024,
      maxDurationMs: 1_000
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.entries.map((entry) => entry.relativePath)).toEqual(["README.md", "src"]);
    expect(listed.value.entries.map((entry) => entry.relativePath)).not.toEqual(
      expect.arrayContaining([".git", "node_modules"])
    );
    await expect(
      source.listEntries("../outside", {
        maxEntries: 100,
        maxBytes: 64 * 1_024,
        maxDurationMs: 1_000
      })
    ).resolves.toMatchObject({ ok: false });

    const entryCapped = await source.listEntries("", {
      maxEntries: 1,
      maxBytes: 64 * 1_024,
      maxDurationMs: 1_000
    });
    if (!entryCapped.ok) throw entryCapped.error;
    expect(entryCapped.value.scannedEntries).toBeLessThanOrEqual(1);
    expect(entryCapped.value.truncationReasons).toContain("max_scanned_entries");

    const byteCapped = await source.listEntries("", {
      maxEntries: 100,
      maxBytes: 0,
      maxDurationMs: 1_000
    });
    if (!byteCapped.ok) throw byteCapped.error;
    expect(byteCapped.value.scannedBytes).toBe(0);
    expect(byteCapped.value.truncationReasons).toContain("max_bytes");
  });

  test("builds a bounded engineering skeleton and filters blocked roots", async () => {
    const repository = new WorkspaceOutlineIndexRepository({
      engineeringEntries: guardedEntries({
        "": [
          entry(".git", "directory"),
          entry("node_modules", "directory"),
          entry("README.md", "file"),
          entry("src", "directory")
        ],
        src: [entry("src/index.ts", "file"), entry("src/lib", "directory")],
        "src/lib": [entry("src/lib/private.ts", "file")]
      })
    });

    const result = await repository.readEngineeringIndex(defaultLimits);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.relativePath)).toEqual(
      expect.arrayContaining(["README.md", "src", "src/index.ts", "src/lib"])
    );
    expect(result.value.entries.map((entry) => entry.relativePath)).not.toEqual(
      expect.arrayContaining([".git", "node_modules", "src/lib/private.ts"])
    );
    expect(result.value.entries.every((entry) => (entry.depth ?? 0) <= 2)).toBe(true);
    expect(result.value.truncationReasons).toContain("max_depth");
    expect(result.value.entrySetRevision).toMatch(/^engineering_entries:[a-f0-9]{32}$/u);
  });

  test("enforces entry, scanned-entry, byte, and duration caps without reading bodies", async () => {
    const source = guardedEntries({
      "": [entry("a.md", "file"), entry("b.md", "file"), entry("c.md", "file")]
    });
    const repository = new WorkspaceOutlineIndexRepository({ engineeringEntries: source });

    const maxEntries = await repository.readEngineeringIndex({ ...defaultLimits, maxEntries: 1 });
    expect(maxEntries).toMatchObject({
      ok: true,
      value: { entries: [expect.objectContaining({ relativePath: "a.md" })] }
    });
    if (maxEntries.ok) expect(maxEntries.value.truncationReasons).toContain("max_entries");

    const maxScanned = await repository.readEngineeringIndex({
      ...defaultLimits,
      maxScannedEntries: 1
    });
    if (!maxScanned.ok) throw new Error(maxScanned.error.message);
    expect(maxScanned.value.entries).toHaveLength(1);
    expect(maxScanned.value.truncationReasons).toContain("max_scanned_entries");

    const maxBytes = await repository.readEngineeringIndex({ ...defaultLimits, maxBytes: 1 });
    if (!maxBytes.ok) throw new Error(maxBytes.error.message);
    expect(maxBytes.value.entries).toEqual([]);
    expect(maxBytes.value.truncationReasons).toContain("max_bytes");

    let clock = 0;
    const timed = new WorkspaceOutlineIndexRepository({
      engineeringEntries: source,
      now: () => clock++
    });
    const maxDuration = await timed.readEngineeringIndex({ ...defaultLimits, maxDurationMs: 1 });
    if (!maxDuration.ok) throw new Error(maxDuration.error.message);
    expect(maxDuration.value.entries).toEqual([]);
    expect(maxDuration.value.truncationReasons).toContain("max_duration");
  });

  test("changes dependency identity when a scanned entry beyond the materialized cap changes", async () => {
    let rootEntries = [entry("a.md", "file"), entry("z.md", "file")];
    const repository = new WorkspaceOutlineIndexRepository({
      engineeringEntries: {
        listEntries: async (_relativeDirectory, limits) =>
          ok(boundedGuardedEntries(rootEntries, limits))
      }
    });
    const limits = { ...defaultLimits, maxEntries: 1 };

    const first = await repository.readEngineeringIndex(limits);
    rootEntries = [entry("a.md", "file"), entry("renamed.md", "file")];
    const second = await repository.readEngineeringIndex(limits);

    if (!first.ok || !second.ok) throw new Error("Expected bounded indexes");
    expect(first.value.entries.map((value) => value.relativePath)).toEqual(["a.md"]);
    expect(second.value.entries.map((value) => value.relativePath)).toEqual(["a.md"]);
    expect(first.value.omittedEntryCount).toBe(1);
    expect(second.value.omittedEntryCount).toBe(1);
    expect(first.value.entrySetChecksum).not.toBe(second.value.entrySetChecksum);
  });

  test("represents an empty engineering directory without a failure", async () => {
    const repository = new WorkspaceOutlineIndexRepository({
      engineeringEntries: guardedEntries({ "": [] })
    });

    await expect(repository.readEngineeringIndex(defaultLimits)).resolves.toMatchObject({
      ok: true,
      value: { entries: [], truncated: false }
    });
  });

  test("projects writing metadata only and records missing Story Bible as an auditable degradation", async () => {
    const repository = new WorkspaceOutlineIndexRepository({
      writingMetadata: {
        readChapterIndex: async () =>
          ok({
            revision: "chapters:r1",
            entries: [
              {
                id: "chapter-01",
                title: "Opening",
                wordCount: 321,
                // Runtime input may carry unrelated data. The index must not preserve it.
                body: "chapter body must not reach the outline"
              } as never
            ]
          }),
        readStoryBibleIndex: async () => ok(undefined)
      }
    });

    const result = await repository.readWritingIndexes(defaultLimits);

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [
          {
            kind: "chapter",
            id: "chapter-01",
            label: "Opening",
            wordCount: 321
          }
        ],
        storyBibleIndexRevision: null,
        storyBibleIndexChecksum: null,
        degradedDependencies: ["story_bible"]
      }
    });
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("chapter body");
  });

  test("reads only writing metadata headers from a guarded legacy project without foreshadows", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-writing-index-"));
    roots.push(root);
    await mkdir(join(root, "chapters"), { recursive: true });
    await mkdir(join(root, "characters"), { recursive: true });
    await writeFile(
      join(root, "chapters", "chapter-01.md"),
      '---\nschemaVersion: "1.0"\nid: chapter-01\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\nwordCount: 123\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\nCHAPTER_BODY_MUST_NOT_APPEAR\n',
      "utf8"
    );
    await writeFile(
      join(root, "characters", "alex.json"),
      '{"schemaVersion":"1.0","id":"character-alex","type":"character","title":"Alex","status":"active","summary":"STORY_BIBLE_BODY_MUST_NOT_APPEAR"}',
      "utf8"
    );

    const metadata = new WorkspaceOutlineProjectMetadataRepository({ projectRoot: root });
    const chapters = await metadata.readChapterIndex();
    const storyBible = await metadata.readStoryBibleIndex();

    expect(chapters).toMatchObject({
      ok: true,
      value: { entries: [{ id: "chapter-01", title: "Opening", wordCount: 123 }] }
    });
    expect(storyBible).toMatchObject({
      ok: true,
      value: { entries: [{ assetId: "character-alex", title: "Alex", assetType: "character" }] }
    });
    expect(JSON.stringify({ chapters, storyBible })).not.toContain("BODY_MUST_NOT_APPEAR");
  });

  test("indexes direct foreshadows and includes them in revisions and checksums", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-foreshadows-"));
    roots.push(root);
    await mkdir(join(root, "foreshadows", "nested"), { recursive: true });
    await writeFile(
      join(root, "foreshadows", "nested", "ignored.json"),
      '{"id":"foreshadow-nested","title":"Nested","type":"foreshadow"}',
      "utf8"
    );

    const metadata = new WorkspaceOutlineProjectMetadataRepository({ projectRoot: root });
    const repository = new WorkspaceOutlineIndexRepository({ writingMetadata: metadata });
    const before = await repository.readWritingIndexes(defaultLimits);
    if (!before.ok) throw before.error;

    await writeFile(
      join(root, "foreshadows", "foreshadow-sealed-letter.json"),
      '{"id":"foreshadow-sealed-letter","title":"Sealed Letter","type":"foreshadow","notes":"BODY_MUST_NOT_APPEAR"}',
      "utf8"
    );

    const storyBible = await metadata.readStoryBibleIndex();
    const after = await repository.readWritingIndexes(defaultLimits);
    if (!storyBible.ok) throw storyBible.error;
    if (!after.ok) throw after.error;

    expect(storyBible.value).toMatchObject({
      entries: [
        {
          assetId: "foreshadow-sealed-letter",
          title: "Sealed Letter",
          assetType: "foreshadow",
          relativePath: "foreshadows/foreshadow-sealed-letter.json"
        }
      ]
    });
    expect(JSON.stringify(storyBible.value)).not.toContain("BODY_MUST_NOT_APPEAR");
    expect(after.value.entries).toEqual([
      {
        kind: "story_bible_asset",
        id: "foreshadow-sealed-letter",
        label: "Sealed Letter",
        assetType: "foreshadow"
      }
    ]);
    expect(after.value.storyBibleIndexRevision).not.toBe(before.value.storyBibleIndexRevision);
    expect(after.value.storyBibleIndexChecksum).not.toBe(before.value.storyBibleIndexChecksum);
  });

  test("keeps a metadata header bound to its opened file after a leaf symlink swap", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-writing-race-"));
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-outline-writing-race-outside-"));
    roots.push(root, outside);
    await mkdir(join(root, "chapters"), { recursive: true });
    const targetPath = join(root, "chapters", "chapter-01.md");
    const outsidePath = join(outside, "chapter-01.md");
    await writeFile(
      targetPath,
      '---\nschemaVersion: "1.0"\nid: chapter-inside\ntype: chapter\ntitle: Inside\norder: 1\nstatus: draft\nwordCount: 1\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\ninside body\n',
      "utf8"
    );
    await writeFile(
      outsidePath,
      '---\nschemaVersion: "1.0"\nid: chapter-outside\ntype: chapter\ntitle: Outside\norder: 1\nstatus: draft\nwordCount: 1\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\noutside body\n',
      "utf8"
    );

    try {
      const probePath = join(root, "symlink-probe.md");
      await symlink(outsidePath, probePath, "file");
      await rm(probePath, { force: true });
    } catch {
      // File symlink creation can be unavailable in restricted Windows environments.
      return;
    }

    class SwapAfterVerificationRepository extends WorkspaceOutlineProjectMetadataRepository {
      protected override async afterPathIdentityVerified(fullPath: string): Promise<void> {
        if (fullPath !== targetPath) return;
        await rm(targetPath, { force: true });
        await symlink(outsidePath, targetPath, "file");
      }
    }

    const metadata = new SwapAfterVerificationRepository({ projectRoot: root });
    expect(await metadata.readChapterIndex()).toMatchObject({
      ok: true,
      value: { entries: [{ id: "chapter-inside", title: "Inside" }] }
    });
  });

  test("includes normalized writing source paths in revisions and checksums so metadata-preserving renames stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-writing-rename-"));
    roots.push(root);
    await mkdir(join(root, "chapters"), { recursive: true });
    await mkdir(join(root, "characters"), { recursive: true });
    await writeFile(
      join(root, "chapters", "chapter-01.md"),
      "---\nid: chapter-01\ntitle: Opening\nwordCount: 123\n---\nunchanged body\n",
      "utf8"
    );
    await writeFile(
      join(root, "characters", "alex.json"),
      '{"id":"character-alex","title":"Alex","type":"character","summary":"unchanged body"}',
      "utf8"
    );

    const metadata = new WorkspaceOutlineProjectMetadataRepository({ projectRoot: root });
    const repository = new WorkspaceOutlineIndexRepository({ writingMetadata: metadata });
    const first = await repository.readWritingIndexes(defaultLimits);
    if (!first.ok) throw first.error;

    await rename(join(root, "chapters", "chapter-01.md"), join(root, "chapters", "opening.md"));
    await rename(
      join(root, "characters", "alex.json"),
      join(root, "characters", "alex-renamed.json")
    );
    const second = await repository.readWritingIndexes(defaultLimits);
    if (!second.ok) throw second.error;

    expect(second.value.entries).toEqual(first.value.entries);
    expect(second.value.chapterIndexRevision).not.toBe(first.value.chapterIndexRevision);
    expect(second.value.chapterIndexChecksum).not.toBe(first.value.chapterIndexChecksum);
    expect(second.value.storyBibleIndexRevision).not.toBe(first.value.storyBibleIndexRevision);
    expect(second.value.storyBibleIndexChecksum).not.toBe(first.value.storyBibleIndexChecksum);
  });

  test("turns a metadata header deadline into an auditable writing-outline degradation", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-outline-writing-deadline-"));
    roots.push(root);
    await mkdir(join(root, "chapters"), { recursive: true });
    await writeFile(
      join(root, "chapters", "chapter-01.md"),
      `---\nid: chapter-01\ntitle: Opening\n${"x".repeat(2_000)}`,
      "utf8"
    );

    let clock = 0;
    const metadata = new WorkspaceOutlineProjectMetadataRepository({
      projectRoot: root,
      maxHeaderBytes: 2_048,
      now: () => clock++
    });
    const repository = new WorkspaceOutlineIndexRepository({ writingMetadata: metadata });
    const result = await repository.readWritingIndexes({ ...defaultLimits, maxDurationMs: 40 });

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [],
        truncated: true,
        truncationReasons: ["max_duration"],
        degradedDependencies: ["chapters", "story_bible"]
      }
    });
    expect(clock).toBeLessThan(100);
  });

  test("derives creative outlines only from the safe snapshot and excludes managed paths", () => {
    const first = buildCreativeProjectFileTreeOutlineIndex({
      snapshot: creativeSnapshot("node:first"),
      policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
      limits: defaultLimits
    });
    const second = buildCreativeProjectFileTreeOutlineIndex({
      snapshot: creativeSnapshot("node:changed"),
      policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
      limits: defaultLimits
    });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) return;
    expect(first.value.entries.map((entry) => entry.relativePath)).toEqual([
      "notes",
      "notes/brief.md"
    ]);
    expect(first.value.entries.map((entry) => entry.relativePath)).not.toEqual(
      expect.arrayContaining([
        "chapters",
        "chapters/secret.md",
        "foreshadows",
        "foreshadows/clue.json"
      ])
    );
    expect(first.value.visibleNodeChecksum).toBe(second.value.visibleNodeChecksum);
    expect(JSON.stringify(first.value)).not.toContain("secret chapter body");
  });

  test("marks a creative snapshot as truncated when its bounded source or materialization is capped", () => {
    const result = buildCreativeProjectFileTreeOutlineIndex({
      snapshot: {
        ...creativeSnapshot("node:first"),
        truncated: true,
        truncationReasons: ["max_items"]
      },
      policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
      limits: { ...defaultLimits, maxEntries: 1 }
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.entries).toHaveLength(1);
    expect(result.value.truncationReasons).toEqual(
      expect.arrayContaining(["source_truncated", "max_entries"])
    );
  });
});

function guardedEntries(
  entries: Readonly<
    Record<
      string,
      readonly {
        readonly name: string;
        readonly relativePath: string;
        readonly kind: "directory" | "file";
      }[]
    >
  >
): WorkspaceOutlineGuardedEntryReader {
  return {
    listEntries: async (relativeDirectory, limits) =>
      ok(boundedGuardedEntries(entries[relativeDirectory] ?? [], limits))
  };
}

function boundedGuardedEntries(
  entries: readonly {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: "directory" | "file";
  }[],
  limits: { readonly maxEntries: number; readonly maxBytes: number }
) {
  const visible: (typeof entries)[number][] = [];
  const reasons = new Set<"max_scanned_entries" | "max_bytes">();
  let scannedEntries = 0;
  let scannedBytes = 0;
  for (const value of entries) {
    if (scannedEntries >= limits.maxEntries) {
      reasons.add("max_scanned_entries");
      break;
    }
    const bytes = Buffer.byteLength(`${value.kind}\0${value.relativePath}`, "utf8");
    if (scannedBytes + bytes > limits.maxBytes) {
      reasons.add("max_bytes");
      break;
    }
    scannedEntries += 1;
    scannedBytes += bytes;
    visible.push(value);
  }
  return {
    entries: visible,
    scannedEntries,
    scannedBytes,
    truncationReasons: [...reasons]
  };
}

function entry(
  relativePath: string,
  kind: "directory" | "file"
): { readonly name: string; readonly relativePath: string; readonly kind: "directory" | "file" } {
  return { name: relativePath.split("/").at(-1) ?? relativePath, relativePath, kind };
}

function creativeSnapshot(nodeRevision: string): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.0",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
    treeRevision: "tree:stable",
    nodes: [
      {
        id: "node:notes",
        name: "notes",
        kind: "directory",
        path: "notes",
        nodeRevision,
        children: [
          {
            id: "node:brief",
            name: "brief.md",
            kind: "file",
            path: "notes/brief.md",
            nodeRevision
          }
        ]
      },
      {
        id: "node:chapters",
        name: "chapters",
        kind: "directory",
        path: "chapters",
        nodeRevision,
        children: [
          {
            id: "node:secret",
            name: "secret.md",
            kind: "file",
            path: "chapters/secret.md",
            nodeRevision,
            content: "secret chapter body"
          } as never
        ]
      },
      {
        id: "node:foreshadows",
        name: "foreshadows",
        kind: "directory",
        path: "foreshadows",
        nodeRevision,
        children: [
          {
            id: "node:clue",
            name: "clue.json",
            kind: "file",
            path: "foreshadows/clue.json",
            nodeRevision
          }
        ]
      }
    ],
    truncated: false,
    truncationReasons: [],
    dependencyManifestChecksum: "f".repeat(64)
  };
}
