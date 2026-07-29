import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      projectConventionsEnabled: false
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
