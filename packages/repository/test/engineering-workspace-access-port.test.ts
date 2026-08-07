import {
  createEngineeringPathPolicy,
  defaultEngineeringPathPolicy
} from "@novel-studio/agent-engine";
import { describe, expect, test, vi } from "vitest";

import {
  createEngineeringWorkspaceAccessPort,
  type EngineeringWorkspaceAccessNativeAddon
} from "../src/engineering-workspace-access-port.js";

describe("EngineeringWorkspaceAccessPort", () => {
  test("delegates only the B6 read-only ABI and binds every result to Main-issued root policy", async () => {
    const addon = nativeAddon();
    addon.listDirectory = vi.fn(() => [
      { name: "main.ts", directory: false, byteLength: 21n },
      { name: "nested", directory: true, byteLength: 0n }
    ]);
    addon.readFile = vi.fn(() => Buffer.from("\ufeffexport const needle = 1;\n", "utf8"));
    addon.searchText = vi.fn(() => ({
      matches: [{ relativePath: "src/main.ts", byteOffset: 13n }],
      truncated: false
    }));
    addon.buildIndex = vi.fn(() => ({
      files: [{ relativePath: "src/main.ts", byteLength: 28n }],
      truncated: false
    }));
    const port = createEngineeringWorkspaceAccessPort({ addon });

    const opened = await port.open(openRequest());

    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.binding).toEqual({
      rootBindingId: "root_binding_01",
      pathPolicyRevision: "engineering-policy-01"
    });

    const listed = await opened.value.listDirectory({ relativeIdentity: "src" });
    const read = await opened.value.readTextFile({ relativeIdentity: "src/main.ts" });
    const searched = await opened.value.searchText({ query: "needle" });
    const indexed = await opened.value.buildIndex();

    expect(listed).toMatchObject({ ok: true });
    expect(read).toMatchObject({ ok: true });
    expect(searched).toMatchObject({ ok: true });
    expect(indexed).toMatchObject({ ok: true });
    if (!listed.ok || !read.ok || !searched.ok || !indexed.ok) throw new Error("expected success");
    expect(listed.value.entries).toEqual([
      expect.objectContaining({ relativeIdentity: "src/main.ts", kind: "file", byteLength: 21 }),
      expect.objectContaining({ relativeIdentity: "src/nested", kind: "directory", byteLength: 0 })
    ]);
    expect(read.value).toMatchObject({
      relativeIdentity: "src/main.ts",
      content: "export const needle = 1;\n",
      byteLength: 28,
      encoding: "utf-8",
      bom: "utf-8"
    });
    expect(read.value.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(searched.value.matches).toEqual([
      expect.objectContaining({ relativeIdentity: "src/main.ts", byteOffset: 13 })
    ]);
    expect(indexed.value.files).toEqual([
      expect.objectContaining({ relativeIdentity: "src/main.ts", byteLength: 28 })
    ]);
    for (const result of [
      ...listed.value.entries,
      read.value,
      ...searched.value.matches,
      ...indexed.value.files
    ]) {
      expect(result.binding).toEqual(opened.value.binding);
      expect(result.refChecksum).toMatch(/^[0-9a-f]{64}$/u);
    }

    expect(addon.openWorkspaceRoot).toHaveBeenCalledWith("C:\\workspace");
    expect(addon.listDirectory).toHaveBeenCalledWith(17n, "src");
    expect(addon.readFile).toHaveBeenCalledWith(17n, "src/main.ts");
    expect(addon.searchText).toHaveBeenCalledWith(17n, "needle");
    expect(addon.buildIndex).toHaveBeenCalledWith(17n);
    expect(Object.keys(port)).toEqual(["open"]);
    expect("replaceFile" in opened.value).toBe(false);
    expect("createFile" in opened.value).toBe(false);
    expect("moveFile" in opened.value).toBe(false);
    expect("deleteFile" in opened.value).toBe(false);
  });

  test("fails closed for malformed DTOs, unsafe relative identities, and unsupported policy classes", async () => {
    const addon = nativeAddon();
    const port = createEngineeringWorkspaceAccessPort({ addon });

    await expect(port.open({ rootPath: "C:\\workspace" })).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_INPUT_REJECTED" }
    });
    expect(addon.openWorkspaceRoot).not.toHaveBeenCalled();

    const opened = await port.open(openRequest());
    if (!opened.ok) throw new Error(opened.error.message);
    for (const input of [
      { relativeIdentity: "../outside.txt" },
      { relativeIdentity: "src\\main.ts" },
      { relativeIdentity: ".git/config" },
      { relativeIdentity: "node_modules/pkg/index.js" },
      { relativeIdentity: "src/main.ts", extra: true }
    ]) {
      await expect(opened.value.readTextFile(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_WORKSPACE_ACCESS_INPUT_REJECTED" }
      });
    }
    await expect(opened.value.searchText({ query: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_INPUT_REJECTED" }
    });
    await expect(opened.value.searchText({ query: "needle", extra: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_INPUT_REJECTED" }
    });
    expect(addon.readFile).not.toHaveBeenCalled();
    expect(addon.searchText).not.toHaveBeenCalled();
  });

  test("filters ignored generated results but treats hard-denied or malformed native output as opaque protocol failure", async () => {
    const addon = nativeAddon();
    addon.listDirectory = vi.fn(() => [
      { name: "node_modules", directory: true, byteLength: 0n },
      { name: "visible.ts", directory: false, byteLength: 1n }
    ]);
    addon.buildIndex = vi.fn(() => ({
      files: [
        { relativePath: "dist/generated.js", byteLength: 1n },
        { relativePath: "src/visible.ts", byteLength: 1n }
      ],
      truncated: false
    }));
    const port = createEngineeringWorkspaceAccessPort({ addon });
    const opened = await port.open(openRequest());
    if (!opened.ok) throw new Error(opened.error.message);

    const listed = await opened.value.listDirectory();
    const indexed = await opened.value.buildIndex();
    if (!listed.ok || !indexed.ok) throw new Error("expected filtered result");
    expect(listed.value.entries.map((entry) => entry.relativeIdentity)).toEqual(["visible.ts"]);
    expect(addon.listDirectory).toHaveBeenCalledWith(17n);
    expect(indexed.value.files.map((entry) => entry.relativeIdentity)).toEqual(["src/visible.ts"]);

    addon.searchText = vi.fn(() => ({
      matches: [{ relativePath: ".env.production", byteOffset: 0n }],
      truncated: false
    }));
    const rejected = await opened.value.searchText({ query: "needle" });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_NATIVE_PROTOCOL_INVALID" }
    });
    expect(JSON.stringify(rejected)).not.toContain(".env.production");
  });

  test("does not disclose native absolute-path exceptions and preserves root-change invalidation", async () => {
    const addon = nativeAddon();
    addon.readFile = vi.fn(() => {
      const error = new Error("D:\\secrets\\outside.txt");
      error.name = "native failure";
      throw error;
    });
    const port = createEngineeringWorkspaceAccessPort({ addon });
    const opened = await port.open(openRequest());
    if (!opened.ok) throw new Error(opened.error.message);

    const failure = await opened.value.readTextFile({ relativeIdentity: "src/main.ts" });
    expect(failure).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    expect(JSON.stringify(failure)).not.toContain("D:\\secrets\\outside.txt");

    addon.buildIndex = vi.fn(() => {
      const error = new Error("changed");
      Object.assign(error, { code: "ENGINEERING_ACCESS_ROOT_CHANGED" });
      throw error;
    });
    await expect(opened.value.buildIndex()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_ROOT_CHANGED" }
    });
  });

  test("closes the native root once and makes the session unavailable afterwards", async () => {
    const addon = nativeAddon();
    const port = createEngineeringWorkspaceAccessPort({ addon });
    const opened = await port.open(openRequest({ pathPolicy: policyWithCustomIgnoredRoot() }));
    if (!opened.ok) throw new Error(opened.error.message);

    await expect(opened.value.close()).resolves.toEqual({ ok: true, value: { closed: true } });
    await expect(opened.value.close()).resolves.toEqual({ ok: true, value: { closed: false } });
    await expect(opened.value.buildIndex()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE" }
    });
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledTimes(1);
    expect(addon.closeWorkspaceRoot).toHaveBeenCalledWith(17n);
  });
});

function nativeAddon(): EngineeringWorkspaceAccessNativeAddon &
  Record<string, ReturnType<typeof vi.fn>> {
  return {
    openWorkspaceRoot: vi.fn(() => ({ rootId: 17n, capability: "available" })),
    closeWorkspaceRoot: vi.fn(() => true),
    listDirectory: vi.fn(() => []),
    readFile: vi.fn(() => Buffer.from("text", "utf8")),
    searchText: vi.fn(() => ({ matches: [], truncated: false })),
    buildIndex: vi.fn(() => ({ files: [], truncated: false }))
  };
}

function openRequest(overrides: Record<string, unknown> = {}) {
  return {
    rootPath: "C:\\workspace",
    rootBinding: {
      schemaVersion: "1.0",
      rootBindingId: "root_binding_01",
      workspaceId: "workspace_01",
      workspaceKind: "engineeringWorkspace",
      volumeIdentity: "volume_01",
      directoryIdentity: "directory_01",
      canonicalPathIdentityChecksum: "a".repeat(64),
      pathPolicyRevision: "engineering-policy-01",
      issuedAt: "2026-08-07T00:00:00.000Z"
    },
    pathPolicy: defaultEngineeringPathPolicy,
    ...overrides
  };
}

function policyWithCustomIgnoredRoot() {
  const policy = createEngineeringPathPolicy({ ignoredRootNames: ["generated"] });
  if (!policy.ok) throw new Error("test policy failed");
  return policy.value;
}
