import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createDesktopWorkspaceContextPolicyStore } from "../src/main/workspace-context-policy-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace context policy store", () => {
  test("fails closed when no policy has been persisted", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    expect(await store.read(binding(contentRoot))).toMatchObject({
      workspaceTrust: "untrusted",
      projectConventionsEnabled: false,
      sourcePreferences: [],
      sharingDefaults: null
    });
  });

  test("persists an explicit trust decision across store instances and revisions policy changes", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    const defaultPolicy = await store.read(binding(contentRoot));

    const enabled = await store.enableTrustedConventions(binding(contentRoot));
    expect(enabled).toMatchObject({
      ok: true,
      value: { workspaceTrust: "trusted", projectConventionsEnabled: true }
    });
    if (!enabled.ok) throw enabled.error;
    expect(enabled.value.sharingDefaultsRevision).toBe(defaultPolicy.sharingDefaultsRevision);

    const restored = await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(
      binding(contentRoot)
    );
    expect(restored).toEqual(enabled.value);
    expect(restored.policyRevision).not.toBe(defaultPolicy.policyRevision);

    const disabled = await store.disableConventions(binding(contentRoot));
    expect(disabled).toMatchObject({
      ok: true,
      value: { workspaceTrust: "trusted", projectConventionsEnabled: false }
    });
    if (!disabled.ok) throw disabled.error;
    expect(disabled.value.policyRevision).not.toBe(restored.policyRevision);

    const revoked = await store.revokeTrust(binding(contentRoot));
    expect(revoked).toMatchObject({
      ok: true,
      value: { workspaceTrust: "untrusted", projectConventionsEnabled: false }
    });
    if (!revoked.ok) throw revoked.error;
    expect(revoked.value.policyRevision).not.toBe(disabled.value.policyRevision);
  });

  test("does not elevate a default-untrusted workspace when conventions are disabled", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    await expect(store.disableConventions(binding(contentRoot))).resolves.toMatchObject({
      ok: true,
      value: { workspaceTrust: "untrusted", projectConventionsEnabled: false }
    });
  });

  test("does not inherit policy after the canonical workspace identity changes", async () => {
    const userDataRoot = await createRoot("user-data");
    const firstRoot = await createRoot("workspace-first");
    const secondRoot = await createRoot("workspace-second");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    await expect(store.enableTrustedConventions(binding(firstRoot))).resolves.toMatchObject({
      ok: true
    });
    expect(await store.read(binding(secondRoot))).toMatchObject({
      workspaceTrust: "untrusted",
      projectConventionsEnabled: false
    });
  });

  test("does not inherit trust when a workspace root is replaced at the same canonical path", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace-replaced");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    await expect(store.enableTrustedConventions(binding(contentRoot))).resolves.toMatchObject({
      ok: true,
      value: { workspaceTrust: "trusted", projectConventionsEnabled: true }
    });
    await rm(contentRoot, { recursive: true, force: true });
    await mkdir(contentRoot);

    expect(
      await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(binding(contentRoot))
    ).toMatchObject({ workspaceTrust: "untrusted", projectConventionsEnabled: false });
  });

  test("fails closed when the supplied workspace root is not a verified directory", async () => {
    const userDataRoot = await createRoot("user-data");
    const parent = await createRoot("workspace-parent");
    const contentRoot = join(parent, "not-a-directory.txt");
    await writeFile(contentRoot, "not a workspace", "utf8");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    expect(await store.read(binding(contentRoot))).toMatchObject({
      workspaceTrust: "untrusted",
      projectConventionsEnabled: false
    });
    await expect(store.enableTrustedConventions(binding(contentRoot))).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID" }
    });
  });

  test("fails closed for a malformed persisted file", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const policyDirectory = join(userDataRoot, "workspace-context-policy");
    await mkdir(policyDirectory);
    await writeFile(join(policyDirectory, "policies.json"), "not JSON", "utf8");

    expect(
      await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(binding(contentRoot))
    ).toMatchObject({ workspaceTrust: "untrusted", projectConventionsEnabled: false });
  });

  test("reads schema 1.0 policies and upgrades them on the next idempotent write", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    const enabled = await store.enableTrustedConventions(binding(contentRoot));
    expect(enabled.ok).toBe(true);

    const targetPath = policyPath(userDataRoot);
    const legacy = await readStoredPolicyFile(targetPath);
    legacy.schemaVersion = "1.0";
    for (const entry of Object.values(legacy.policies)) {
      delete entry.sourcePreferences;
      delete entry.sharingDefaults;
      delete entry.sharingRevision;
    }
    await writeFile(targetPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const restored = await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(
      binding(contentRoot)
    );
    expect(restored).toMatchObject({
      workspaceTrust: "trusted",
      projectConventionsEnabled: true,
      sourcePreferences: []
    });

    const upgraded = await createDesktopWorkspaceContextPolicyStore({
      userDataRoot
    }).enableTrustedConventions(binding(contentRoot));
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.value.policyRevision).toBe(restored.policyRevision);
    expect(await readStoredPolicyFile(targetPath)).toMatchObject({
      schemaVersion: "1.2",
      policies: expect.objectContaining({
        [Object.keys(legacy.policies)[0] as string]: expect.objectContaining({
          sourcePreferences: [],
          sharingDefaults: null,
          sharingRevision: 0
        })
      })
    });
  });

  test("persists sharing defaults independently from workspace trust", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    const initial = await store.read(binding(contentRoot));

    const selected = await store.setSharingDefaults(binding(contentRoot), {
      outlineMetadata: "automatic",
      activeResource: "off",
      conversationSummary: "ask",
      toolReadResults: "deny"
    });
    expect(selected).toMatchObject({
      ok: true,
      value: {
        workspaceTrust: "untrusted",
        projectConventionsEnabled: false,
        sharingDefaults: {
          outlineMetadata: "automatic",
          activeResource: "off",
          conversationSummary: "ask",
          toolReadResults: "deny"
        }
      }
    });
    if (!selected.ok) throw selected.error;
    expect(selected.value.sharingDefaultsRevision).not.toBe(initial.sharingDefaultsRevision);

    const trusted = await store.enableTrustedConventions(binding(contentRoot));
    expect(trusted.ok).toBe(true);
    if (!trusted.ok) throw trusted.error;
    expect(trusted.value.sharingDefaults).toEqual(selected.value.sharingDefaults);
    expect(trusted.value.sharingDefaultsRevision).toBe(selected.value.sharingDefaultsRevision);
    expect(trusted.value.policyRevision).not.toBe(selected.value.policyRevision);

    const restored = await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(
      binding(contentRoot)
    );
    expect(restored).toEqual(trusted.value);
  });

  test("fails closed for malformed sharing defaults and can return to first-use blocking state", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    await expect(
      store.setSharingDefaults(
        binding(contentRoot),
        JSON.parse(
          '{"outlineMetadata":"automatic","activeResource":"automatic","conversationSummary":"allow","toolReadResults":"allow","extra":true}'
        )
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_CONTEXT_POLICY_SHARING_INVALID" }
    });

    const selected = await store.setSharingDefaults(binding(contentRoot), {
      outlineMetadata: "automatic",
      activeResource: "automatic",
      conversationSummary: "allow",
      toolReadResults: "ask"
    });
    if (!selected.ok) throw selected.error;
    const cleared = await store.setSharingDefaults(binding(contentRoot), null);
    expect(cleared).toMatchObject({ ok: true, value: { sharingDefaults: null } });
    if (!cleared.ok) throw cleared.error;
    expect(cleared.value.sharingDefaultsRevision).not.toBe(selected.value.sharingDefaultsRevision);
  });

  test("persists, orders, deletes, and idempotently updates source preferences", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    const excluded = {
      refId: "story_bible:world_main",
      decision: "excluded" as const,
      priority: 20
    };
    const pinned = {
      refId: "chapter:ch_01",
      decision: "pinned" as const,
      priority: 80,
      ref: {
        kind: "chapter" as const,
        refId: "chapter:ch_01",
        chapterId: "ch_01",
        label: "第一章",
        range: { start: 0, end: 120 }
      }
    };

    await expect(store.setSourcePreference(binding(contentRoot), excluded)).resolves.toMatchObject({
      ok: true
    });
    const saved = await store.setSourcePreference(binding(contentRoot), pinned);
    expect(saved).toMatchObject({
      ok: true,
      value: { sourcePreferences: [pinned, excluded] }
    });
    if (!saved.ok) return;

    const repeated = await store.setSourcePreference(binding(contentRoot), pinned);
    expect(repeated).toMatchObject({ ok: true, value: { sourcePreferences: [pinned, excluded] } });
    if (!repeated.ok) return;
    expect(repeated.value.policyRevision).toBe(saved.value.policyRevision);
    expect(
      await createDesktopWorkspaceContextPolicyStore({ userDataRoot }).read(binding(contentRoot))
    ).toEqual(repeated.value);

    const removed = await store.setSourcePreference(binding(contentRoot), {
      refId: pinned.refId,
      decision: null
    });
    expect(removed).toMatchObject({ ok: true, value: { sourcePreferences: [excluded] } });
    if (!removed.ok) return;
    expect(removed.value.policyRevision).not.toBe(repeated.value.policyRevision);

    const repeatedRemoval = await store.setSourcePreference(binding(contentRoot), {
      refId: pinned.refId,
      decision: null
    });
    expect(repeatedRemoval).toMatchObject({ ok: true, value: { sourcePreferences: [excluded] } });
    if (!repeatedRemoval.ok) return;
    expect(repeatedRemoval.value.policyRevision).toBe(removed.value.policyRevision);
  });

  test("rejects invalid source preferences before persistence", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });

    await expect(
      store.setSourcePreference(binding(contentRoot), {
        refId: "chapter:ch_01",
        decision: "pinned",
        priority: 101
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID" }
    });
    await expect(
      store.setSourcePreference(binding(contentRoot), {
        refId: "file:notes",
        decision: "pinned",
        priority: 50,
        ref: {
          kind: "project_file",
          refId: "file:notes",
          relativePath: "../outside.md",
          label: "越界路径"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID" }
    });
    await expect(
      store.setSourcePreference(binding(contentRoot), {
        refId: "chapter:ch_01",
        decision: "pinned",
        priority: 50,
        ref: {
          kind: "chapter",
          refId: "chapter:other",
          chapterId: "ch_01",
          label: "第一章"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID" }
    });
    expect(await store.read(binding(contentRoot))).toMatchObject({ sourcePreferences: [] });
  });

  test("fails closed when a persisted source preference is malformed", async () => {
    const userDataRoot = await createRoot("user-data");
    const contentRoot = await createRoot("workspace");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    await store.enableTrustedConventions(binding(contentRoot));
    await store.setSourcePreference(binding(contentRoot), {
      refId: "story_bible:world_main",
      decision: "pinned",
      priority: 50
    });
    const targetPath = policyPath(userDataRoot);
    const malformed = await readStoredPolicyFile(targetPath);
    const entry = Object.values(malformed.policies)[0];
    if (entry === undefined) throw new Error("expected a stored policy entry");
    entry.sourcePreferences = [
      { refId: "story_bible:world_main", decision: "pinned", priority: -1 }
    ];
    await writeFile(targetPath, `${JSON.stringify(malformed, null, 2)}\n`, "utf8");

    expect(await store.read(binding(contentRoot))).toMatchObject({
      workspaceTrust: "untrusted",
      projectConventionsEnabled: false,
      sourcePreferences: []
    });
  });

  test("isolates source preferences by canonical workspace binding", async () => {
    const userDataRoot = await createRoot("user-data");
    const firstRoot = await createRoot("workspace-first");
    const secondRoot = await createRoot("workspace-second");
    const store = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
    await store.setSourcePreference(binding(firstRoot), {
      refId: "story_bible:world_main",
      decision: "excluded",
      priority: 30
    });

    expect(await store.read(binding(firstRoot))).toMatchObject({
      sourcePreferences: [{ refId: "story_bible:world_main", decision: "excluded", priority: 30 }]
    });
    expect(await store.read(binding(secondRoot))).toMatchObject({ sourcePreferences: [] });
  });
});

function binding(contentRoot: string) {
  return {
    workspaceKind: "creativeProject" as const,
    workspaceId: "workspace_01",
    contentRoot
  };
}

async function createRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-${label}-`));
  roots.push(root);
  return root;
}

function policyPath(userDataRoot: string): string {
  return join(userDataRoot, "workspace-context-policy", "policies.json");
}

interface MutableStoredPolicyFile {
  schemaVersion: string;
  policies: Record<
    string,
    {
      sourcePreferences?: Array<{ refId: string; decision: string; priority: number }>;
      sharingDefaults?: Record<string, unknown> | null;
      sharingRevision?: number;
    }
  >;
}

async function readStoredPolicyFile(targetPath: string): Promise<MutableStoredPolicyFile> {
  return JSON.parse(await readFile(targetPath, "utf8")) as MutableStoredPolicyFile;
}
