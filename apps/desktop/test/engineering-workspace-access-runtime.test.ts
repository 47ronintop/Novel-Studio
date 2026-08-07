import { describe, expect, test, vi } from "vitest";

import {
  createEngineeringFileAccessAddonLoader,
  createEngineeringWorkspaceAccessPort,
  isEngineeringWorkspaceAccessOperation
} from "../src/main/engineering-file-access-adapter.js";
import { createEngineeringFileAccessQualificationService } from "../src/main/engineering-file-access-qualification.js";
import { createEngineeringWorkspaceAccessRuntime } from "../src/main/engineering-workspace-access-runtime.js";

describe("engineering workspace access runtime", () => {
  test("validates only the fixed B6 addon metadata and caches the Main loader result", () => {
    const loadModule = vi.fn(() => ({ adapterInfo: () => validMetadata() }));
    const loader = createEngineeringFileAccessAddonLoader({
      addonPath: "only-engineering-file-access.node",
      loadModule
    });

    const first = loader.load();
    const second = loader.load();

    expect(first).toMatchObject({ status: "loaded", metadata: validMetadata() });
    expect(second).toBe(first);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledWith("only-engineering-file-access.node");
  });

  test.each([
    [{}, "missing adapterInfo"],
    [{ adapterInfo: () => ({ ...validMetadata(), mutation: "available" }) }, "mutation enabled"],
    [{ adapterInfo: () => ({ ...validMetadata(), recovery: "available" }) }, "recovery enabled"],
    [{ adapterInfo: () => ({ ...validMetadata(), extra: true }) }, "unexpected metadata"]
  ])("rejects invalid addon metadata: %s", (addon) => {
    const loader = createEngineeringFileAccessAddonLoader({ loadModule: () => addon });

    expect(loader.load()).toEqual({ status: "unavailable", reason: "native_module_invalid" });
  });

  test("keeps every B6 request unavailable when qualification is unavailable", async () => {
    const qualificationService = createEngineeringFileAccessQualificationService({
      packageKind: "production",
      platform: "win32",
      arch: "x64",
      now: () => "2026-08-07T00:00:00.000Z",
      candidateInspector: { inspect: async () => "missing" }
    });
    const loader = {
      load: vi.fn(() => ({
        status: "loaded" as const,
        addon: { adapterInfo: () => validMetadata() },
        metadata: validMetadata()
      }))
    };
    const runtime = createEngineeringWorkspaceAccessRuntime({
      qualificationService,
      addonLoader: loader
    });

    expect(runtime.operations).toEqual(["list", "read", "search", "index"]);
    await expect(runtime.request("read")).resolves.toEqual({
      status: "unavailable",
      operation: "read",
      reason: "qualification_unavailable"
    });
    expect(loader.load).not.toHaveBeenCalled();
  });

  test("keeps a metadata-validated B6 port unavailable without calling an access ABI", () => {
    const addon = { adapterInfo: () => validMetadata() };
    const loader = createEngineeringFileAccessAddonLoader({ loadModule: () => addon });
    const port = createEngineeringWorkspaceAccessPort({ addonLoader: loader });

    expect(port.request("index")).toEqual({
      status: "unavailable",
      operation: "index",
      reason: "production_wiring_not_enabled"
    });
  });

  test.each([
    "replace",
    "create",
    "move",
    "delete",
    "create-directory",
    "recover",
    "replace_file",
    "create_file",
    "move_file",
    "delete_file",
    "create_directory"
  ])("excludes B7/B8 and recovery operation %s before loading native code", async (operation) => {
    const loader = { load: vi.fn() };
    const runtime = createEngineeringWorkspaceAccessRuntime({
      qualificationService: {
        readAttestation: async () => ({}) as never
      },
      addonLoader: loader
    });

    expect(isEngineeringWorkspaceAccessOperation(operation)).toBe(false);
    await expect(runtime.request(operation)).resolves.toEqual({
      status: "unavailable",
      operation,
      reason: "operation_not_available_in_batch_6"
    });
    expect(loader.load).not.toHaveBeenCalled();
  });
});

function validMetadata() {
  return {
    adapterId: "novel_studio_engineering_file_access" as const,
    target: "win32-x64" as const,
    batch: "6" as const,
    accessEligible: "unavailable" as const,
    mutation: "unavailable" as const,
    recovery: "unavailable" as const
  };
}
