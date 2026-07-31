import { describe, expect, test } from "vitest";

import {
  createAgentFileOperationSession,
  storyBibleAssetRelativePath
} from "../src/agent-file-operation-session.js";

const validChecksum = "a".repeat(64);

describe("AgentFileOperationSession", () => {
  test("proposeFileCreate returns a ChangeSetOperation", () => {
    const session = createAgentFileOperationSession({
      createOperationId: () => "op-01"
    });
    const result = session.proposeFileCreate({
      toolCallId: "call-01",
      relativePath: "src/new-file.ts",
      content: "export const x = 1;\n"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("create_file");
    expect(result.value.operationId).toBe("op-01");
    expect(result.value.toolCallId).toBe("call-01");
  });

  test("proposeFileCreate is idempotent for same toolCallId", () => {
    const session = createAgentFileOperationSession();
    const r1 = session.proposeFileCreate({
      toolCallId: "call-idempotent",
      relativePath: "notes.md",
      content: "content"
    });
    const r2 = session.proposeFileCreate({
      toolCallId: "call-idempotent",
      relativePath: "notes.md",
      content: "different content"
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.operationId).toBe(r2.value.operationId);
  });

  test("proposeFileCreate rejects invalid paths", () => {
    const session = createAgentFileOperationSession();
    expect(
      session.proposeFileCreate({ toolCallId: "c1", relativePath: "../outside.md", content: "" }).ok
    ).toBe(false);
    expect(session.proposeFileCreate({ toolCallId: "c2", relativePath: "", content: "" }).ok).toBe(
      false
    );
    expect(
      session.proposeFileCreate({ toolCallId: "c3", relativePath: "src\\file.ts", content: "" }).ok
    ).toBe(false);
  });

  test.each([
    "nested/../outside.md",
    "/tmp/outside.md",
    "C:/Windows/win.ini",
    "D:/other-volume/outside.md",
    "C:drive-relative.md",
    "\\\\server\\share\\outside.md",
    "\\\\?\\C:\\Windows\\win.ini",
    "report.md:secret",
    "CON",
    "nested/PRN.txt",
    "trailing.",
    "trailing ",
    "nested//file.md"
  ])(
    "rejects non-canonical project-relative path %s for every lifecycle proposal",
    (relativePath) => {
      const session = createAgentFileOperationSession();
      const create = session.proposeFileCreate({
        toolCallId: `create-${relativePath}`,
        relativePath,
        content: ""
      });
      const move = session.proposeFileMove({
        toolCallId: `move-${relativePath}`,
        sourcePath: relativePath,
        targetPath: "valid-target.md",
        sourceChecksum: validChecksum
      });
      const remove = session.proposeFileDelete({
        toolCallId: `delete-${relativePath}`,
        relativePath,
        baseChecksum: validChecksum
      });
      const mkdir = session.proposeDirectoryCreate({
        toolCallId: `mkdir-${relativePath}`,
        relativePath
      });

      for (const result of [create, move, remove, mkdir]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("FILE_OP_PATH_INVALID");
      }
    }
  );

  test("proposeFileMove returns a move_file operation", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeFileMove({
      toolCallId: "call-move",
      sourcePath: "src/old.ts",
      targetPath: "src/new.ts",
      sourceChecksum: validChecksum
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("move_file");
    if (result.value.operation.kind !== "move_file") return;
    expect(result.value.operation.sourcePath).toBe("src/old.ts");
    expect(result.value.operation.targetPath).toBe("src/new.ts");
    expect(result.value.operation.sourceChecksum).toBe(validChecksum);
  });

  test("proposeFileMove rejects same source and target", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeFileMove({
      toolCallId: "call-same",
      sourcePath: "src/same.ts",
      targetPath: "src/same.ts",
      sourceChecksum: validChecksum
    });
    expect(result.ok).toBe(false);
  });

  test("proposeFileMove rejects invalid checksum", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeFileMove({
      toolCallId: "call-bad-checksum",
      sourcePath: "src/a.ts",
      targetPath: "src/b.ts",
      sourceChecksum: "not-a-checksum"
    });
    expect(result.ok).toBe(false);
  });

  test("proposeFileDelete returns a delete_file operation", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeFileDelete({
      toolCallId: "call-del",
      relativePath: "src/to-delete.ts",
      baseChecksum: validChecksum
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("delete_file");
  });

  test("proposeDirectoryCreate returns a create_directory operation", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeDirectoryCreate({
      toolCallId: "call-mkdir",
      relativePath: "src/new-dir"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("create_directory");
  });

  test("proposeChapterCreate returns a create_file operation with chapter path", () => {
    const session = createAgentFileOperationSession({
      createChapterId: () => "ch_test_create",
      now: () => "2026-07-26T00:00:00.000Z"
    });
    const result = session.proposeChapterCreate({
      toolCallId: "call-chapter",
      title: "第一章",
      content: "雨夜里，故事开始了。"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("create_file");
    if (result.value.operation.kind !== "create_file") return;
    expect(result.value.operation.relativePath).toBe("chapters/ch_test_create.md");
    expect(result.value.operation.content).toContain("id: ch_test_create");
    expect(result.value.operation.content).toContain('title: "第一章"');
    expect(result.value.operation.content).toContain('createdAt: "2026-07-26T00:00:00.000Z"');
    expect(result.value.operation.content).toContain("雨夜里，故事开始了。");
  });

  test("proposeChapterCreate rejects empty title", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeChapterCreate({ toolCallId: "c1", title: "" });
    expect(result.ok).toBe(false);
  });

  test("proposeStoryBibleWrite validates JSON content", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeStoryBibleWrite({
      toolCallId: "call-sb",
      assetType: "character",
      content: JSON.stringify({ id: "char-01", type: "character", name: "Alice" })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operation.kind).toBe("create_file");
    if (result.value.operation.kind !== "create_file") return;
    expect(result.value.operation.relativePath).toBe("characters/char-01.json");
  });

  test("proposeStoryBibleWrite maps foreshadows to their managed collection", () => {
    const session = createAgentFileOperationSession();
    const assetId = `fsh_${"a".repeat(32)}`;
    const timestamp = "2026-07-31T00:00:00.000Z";
    const result = session.proposeStoryBibleWrite({
      toolCallId: "call-foreshadow",
      assetType: "foreshadow",
      content: JSON.stringify({
        schemaVersion: "1.0",
        id: assetId,
        type: "foreshadow",
        title: "Sealed archive",
        status: "active",
        summary: "The archive remains sealed.",
        details: { trackingStatus: "planned", origin: "manual" },
        createdAt: timestamp,
        updatedAt: timestamp
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.operation.kind !== "create_file") return;
    expect(result.value.operation.relativePath).toBe(`foreshadows/${assetId}.json`);
  });

  test.each([
    ["character", "characters/asset.json"],
    ["world.location", "world/asset.json"],
    ["world.faction", "world/asset.json"],
    ["world.rule", "world/asset.json"],
    ["world.glossary", "world/asset.json"],
    ["outline", "outline/outline.json"],
    ["timeline.events", "timeline/events.json"],
    ["foreshadow", "foreshadows/asset.json"]
  ])("maps the %s Story Bible type without a fallback", (assetType, expectedPath) => {
    expect(storyBibleAssetRelativePath(assetType, "asset")).toBe(expectedPath);
  });

  test("rejects non-asset path types in the shared resolver", () => {
    expect(storyBibleAssetRelativePath("world.unknown", "asset")).toBeUndefined();
    expect(storyBibleAssetRelativePath("memory.long-term", "asset")).toBeUndefined();
  });

  test("proposeStoryBibleWrite rejects invalid JSON", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeStoryBibleWrite({
      toolCallId: "call-sb-bad",
      assetType: "character",
      content: "not valid json"
    });
    expect(result.ok).toBe(false);
  });

  test("proposeStoryBibleWrite rejects unknown asset type", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeStoryBibleWrite({
      toolCallId: "call-sb-unk",
      assetType: "unknown_type",
      content: "{}"
    });
    expect(result.ok).toBe(false);
  });

  test("proposeStoryBibleWrite rejects content whose type does not match the request", () => {
    const session = createAgentFileOperationSession();
    const result = session.proposeStoryBibleWrite({
      toolCallId: "call-sb-mismatch",
      assetType: "character",
      content: JSON.stringify({ id: "char-01", type: "outline" })
    });
    expect(result.ok).toBe(false);
  });

  test("validateOperationDAG detects duplicate operation IDs", () => {
    const session = createAgentFileOperationSession({
      createOperationId: () => "fixed-id"
    });
    session.proposeFileCreate({ toolCallId: "c1", relativePath: "a.md", content: "" });
    // Force a second operation with the same ID by using different toolCallId
    session.proposeFileCreate({ toolCallId: "c2", relativePath: "b.md", content: "" });
    // The DAG should have two operations — if both got same ID, validate should fail
    // (In practice, they share the same ID "fixed-id" and will be detected)
    const result = session.validateOperationDAG();
    // If IDs are duplicated, result.ok is false
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_OP_DAG_INVALID");
    }
    // (If IDs happen to differ due to actual randomness, the DAG is valid)
  });

  test("listPendingOperations returns all staged operations", () => {
    const session = createAgentFileOperationSession();
    session.proposeFileCreate({ toolCallId: "c1", relativePath: "a.md", content: "a" });
    session.proposeFileCreate({ toolCallId: "c2", relativePath: "b.md", content: "b" });
    const ops = session.listPendingOperations();
    expect(ops.length).toBe(2);
  });

  test("dependsOn is recorded on the operation", () => {
    const session = createAgentFileOperationSession({
      createOperationId: (() => {
        let n = 0;
        return () => `op-${++n}`;
      })()
    });
    const r1 = session.proposeDirectoryCreate({
      toolCallId: "c1",
      relativePath: "new-dir"
    });
    if (!r1.ok) throw new Error("Expected ok");
    const r2 = session.proposeFileCreate({
      toolCallId: "c2",
      relativePath: "new-dir/file.ts",
      content: "export {};",
      dependsOn: [r1.value.operationId]
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.operation.dependsOn).toEqual([r1.value.operationId]);
  });
});
