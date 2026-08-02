import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { HistoryRepository } from "@novel-studio/repository";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";
import { createStoryBibleBridge } from "../src/renderer/story-bible-bridge.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const characterId = "chr_legacy";
const now = "2026-07-31T02:00:00.000Z";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Story Bible manual edit desktop composition", () => {
  test("lazily upgrades a legacy asset through the renderer and preserves passthrough", async () => {
    const { projectRoot, characterPath, legacyContent } = await createLegacyProject();
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Legacy Story Bible Project",
      projectLockOwnerId: "story-bible-manual-upgrade-test",
      now: () => now
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const bridge = createStoryBibleBridge(apiFor(application));
      await bridge.load("prj_minimal_chapter");

      const selected = await bridge.selectEntryForEditing(characterId);
      expect(selected).toMatchObject({
        dirty: false,
        draft: {
          id: characterId,
          title: "Legacy archivist",
          details: { role: "Archivist" }
        }
      });
      expect(selected.draft.details).not.toHaveProperty("legacyDetail");

      bridge.updateDraft("character", {
        title: "Archive keeper",
        details: { role: "Keeper" }
      });
      const saved = await bridge.saveDraft();

      expect(saved).toMatchObject({
        dirty: false,
        status: "saved",
        draft: { id: characterId, title: "Archive keeper" }
      });
      const persisted = JSON.parse(await readFile(characterPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(persisted).toMatchObject({
        schemaVersion: "1.1",
        id: characterId,
        title: "Archive keeper",
        revision: 1,
        updatedAt: now,
        details: { role: "Keeper" },
        passthrough: {
          sourceSchemaVersion: "1.0",
          rootFields: { legacyRoot: ["keep"] },
          detailFieldsByPointer: { "/legacyDetail": { value: { keep: true } } }
        }
      });
      expect(persisted).not.toHaveProperty("legacyRoot");
      expect(persisted["details"]).not.toHaveProperty("legacyDetail");

      const history = new HistoryRepository({ projectRoot });
      const versions = await history.listTextAssetSnapshots({
        assetType: "text",
        assetId: characterId
      });
      expect(versions).toMatchObject({
        ok: true,
        value: [{ reason: "manual-save", createdBy: "user" }]
      });
      if (!versions.ok || versions.value[0] === undefined) return;
      const snapshot = await history.readTextAssetSnapshot({
        assetType: "text",
        assetId: characterId,
        versionId: versions.value[0].versionId
      });
      expect(snapshot).toMatchObject({ ok: true, value: { body: legacyContent } });
    } finally {
      await application.shutdown();
    }
  });

  test("records the original path before manually migrating a noncanonical legacy asset", async () => {
    const { projectRoot, characterPath, canonicalCharacterPath, legacyContent } =
      await createLegacyProject({ noncanonical: true });
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Legacy Story Bible Project",
      projectLockOwnerId: "story-bible-manual-path-history-test",
      now: () => now
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const bridge = createStoryBibleBridge(apiFor(application));
      await bridge.load("prj_minimal_chapter");
      await bridge.selectEntryForEditing(characterId);
      bridge.updateDraft("character", { title: "Migrated keeper" });

      await expect(bridge.saveDraft()).resolves.toMatchObject({
        dirty: false,
        status: "saved",
        draft: { id: characterId, title: "Migrated keeper" }
      });

      await expect(readFile(characterPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(canonicalCharacterPath, "utf8"))).toMatchObject({
        schemaVersion: "1.1",
        id: characterId,
        revision: 1
      });
      const history = new HistoryRepository({ projectRoot });
      const versions = await history.listTextAssetSnapshotRecords({
        assetType: "text",
        assetId: characterId
      });
      expect(versions).toMatchObject({
        ok: true,
        value: [
          {
            reason: "manual-save",
            createdBy: "user",
            targetRelativePath: "characters/legacy/legacy-character.json"
          }
        ]
      });
      if (!versions.ok || versions.value[0] === undefined) return;
      await expect(
        history.readTextAssetSnapshot({
          assetType: "text",
          assetId: characterId,
          versionId: versions.value[0].versionId
        })
      ).resolves.toMatchObject({ ok: true, value: { body: legacyContent } });
    } finally {
      await application.shutdown();
    }
  });

  test("keeps an externally changed legacy file when the renderer checksum is stale", async () => {
    const { projectRoot, characterPath, legacyAsset } = await createLegacyProject();
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Legacy Story Bible Project",
      projectLockOwnerId: "story-bible-manual-conflict-test",
      now: () => now
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const bridge = createStoryBibleBridge(apiFor(application));
      await bridge.load("prj_minimal_chapter");
      await bridge.selectEntryForEditing(characterId);
      bridge.updateDraft("character", { title: "Local title" });

      const externalContent = `${JSON.stringify(
        { ...legacyAsset, summary: "Externally updated summary." },
        null,
        2
      )}\n`;
      await writeFile(characterPath, externalContent, "utf8");
      const result = await bridge.saveDraft();

      expect(result).toMatchObject({
        dirty: true,
        status: "error",
        draft: { title: "Local title" }
      });
      expect(await readFile(characterPath, "utf8")).toBe(externalContent);
    } finally {
      await application.shutdown();
    }
  });

  test("previews deletion impact and restores the status recorded in manual-save History", async () => {
    const { projectRoot, characterPath } = await createLegacyProject();
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Legacy Story Bible Project",
      projectLockOwnerId: "story-bible-manual-status-test",
      now: () => now
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const bridge = createStoryBibleBridge(apiFor(application));
      await bridge.load("prj_minimal_chapter");
      await bridge.selectEntryForEditing(characterId);

      const deletionPreview = await bridge.requestStatusAction("move-to-deleted");
      expect(deletionPreview.statusAction).toMatchObject({
        status: "confirmation",
        action: "move-to-deleted",
        canSetDeleted: true,
        affectedReferenceCount: 0
      });
      const deletion = await bridge.confirmStatusAction();
      expect(deletion.readyToSave).toBe(true);
      bridge.beginSave();
      const deleted = await bridge.saveDraft({ chapterIds: [chapterId] });
      expect(deleted).toMatchObject({
        status: "saved",
        dirty: false,
        draft: { id: characterId, status: "deleted" }
      });
      expect(JSON.parse(await readFile(characterPath, "utf8"))).toMatchObject({
        id: characterId,
        status: "deleted",
        revision: 1
      });

      const restorePreview = await bridge.requestStatusAction("restore");
      expect(restorePreview.statusAction).toMatchObject({
        status: "confirmation",
        action: "restore"
      });
      const restore = await bridge.confirmStatusAction();
      expect(restore).toMatchObject({
        readyToSave: true,
        editor: { draft: { status: "active" } }
      });
      bridge.beginSave();
      const restored = await bridge.saveDraft({ chapterIds: [chapterId] });
      expect(restored).toMatchObject({
        status: "saved",
        dirty: false,
        draft: { id: characterId, status: "active" }
      });
      expect(JSON.parse(await readFile(characterPath, "utf8"))).toMatchObject({
        id: characterId,
        status: "active",
        revision: 2
      });
    } finally {
      await application.shutdown();
    }
  }, 15_000);

  test("restores the exact pre-delete status when History snapshots share a timestamp", async () => {
    const { projectRoot } = await createLegacyProject();
    const versionIds = ["ver_z_active", "ver_a_archived"];
    let versionIndex = 0;
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Legacy Story Bible Project",
      projectLockOwnerId: "story-bible-manual-status-order-test",
      now: () => now,
      createVersionId: () => versionIds[versionIndex++] ?? `ver_extra_${versionIndex}`
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const bridge = createStoryBibleBridge(apiFor(application));
      await bridge.load("prj_minimal_chapter");
      await bridge.selectEntryForEditing(characterId);

      bridge.updateDraft("character", { status: "archived" });
      await expect(bridge.saveDraft({ chapterIds: [chapterId] })).resolves.toMatchObject({
        status: "saved",
        draft: { status: "archived" }
      });

      await bridge.requestStatusAction("move-to-deleted");
      const deletion = await bridge.confirmStatusAction();
      expect(deletion.readyToSave).toBe(true);
      bridge.beginSave();
      await expect(bridge.saveDraft({ chapterIds: [chapterId] })).resolves.toMatchObject({
        status: "saved",
        draft: { status: "deleted", id: characterId }
      });

      const history = new HistoryRepository({ projectRoot });
      await expect(
        history.listTextAssetSnapshots({ assetType: "text", assetId: characterId })
      ).resolves.toMatchObject({
        ok: true,
        value: [{ versionId: "ver_z_active" }, { versionId: "ver_a_archived" }]
      });

      await bridge.requestStatusAction("restore");
      const restore = await bridge.confirmStatusAction();
      expect(restore).toMatchObject({
        readyToSave: true,
        editor: { draft: { status: "archived" } }
      });
    } finally {
      await application.shutdown();
    }
  }, 15_000);
});

function apiFor(application: ReturnType<typeof createProjectDesktopApplication>) {
  const handlers = createApplicationIpcHandlers(application);
  return createNovelStudioApi({
    async invoke(channel, ...args) {
      return handlers[channel](...args);
    }
  });
}

async function createLegacyProject(options: { readonly noncanonical?: boolean } = {}): Promise<{
  readonly projectRoot: string;
  readonly characterPath: string;
  readonly canonicalCharacterPath: string;
  readonly legacyAsset: Record<string, unknown>;
  readonly legacyContent: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-manual-"));
  tempRoots.push(projectRoot);
  await mkdir(join(projectRoot, "chapters"), { recursive: true });
  await mkdir(join(projectRoot, "characters"), { recursive: true });
  await writeFile(
    join(projectRoot, "project.json"),
    await readFile(join(fixtureRoot, "project.json"))
  );
  await writeFile(
    join(projectRoot, "settings.json"),
    await readFile(join(fixtureRoot, "settings.json"))
  );
  await writeFile(
    join(projectRoot, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );
  const legacyAsset = {
    schemaVersion: "1.0",
    id: characterId,
    type: "character",
    title: "Legacy archivist",
    status: "active",
    summary: "Keeps the archive ledger.",
    aliases: ["Archivist"],
    details: {
      role: "Archivist",
      legacyDetail: { keep: true }
    },
    legacyRoot: ["keep"],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
  const canonicalCharacterPath = join(projectRoot, "characters", `${characterId}.json`);
  const characterPath = options.noncanonical
    ? join(projectRoot, "characters", "legacy", "legacy-character.json")
    : canonicalCharacterPath;
  const legacyContent = `${JSON.stringify(legacyAsset, null, 2)}\n`;
  await mkdir(dirname(characterPath), { recursive: true });
  await writeFile(characterPath, legacyContent, "utf8");
  return { projectRoot, characterPath, canonicalCharacterPath, legacyAsset, legacyContent };
}
