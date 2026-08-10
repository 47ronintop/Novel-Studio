import { describe, expect, test } from "vitest";

import { createEngineeringFileAccessAddonLoader } from "../src/main/engineering-file-access-adapter.js";

describe("engineering file access addon loader", () => {
  test.each([
    {
      batch: "6",
      mutation: "unavailable",
      recovery: "unavailable"
    },
    {
      batch: "7",
      mutation: "available",
      recovery: "available",
      mutationV2Probe: "available",
      recoveryScanProbe: "available",
      stateDurabilityProbe: "available"
    },
    {
      batch: "8",
      mutation: "available",
      recovery: "available",
      mutationV2Probe: "available",
      recoveryScanProbe: "available",
      stateDurabilityProbe: "available"
    }
  ] as const)("accepts the signed Batch $batch addon declaration", (capability) => {
    const loader = createEngineeringFileAccessAddonLoader({
      addonPath: "C:\\fixture\\engineering_file_access.node",
      loadModule: () => addonWithMetadata(capability)
    });

    expect(loader.load()).toMatchObject({
      status: "loaded",
      metadata: {
        adapterId: "novel_studio_engineering_file_access",
        target: "win32-x64",
        accessEligible: "available",
        ...capability
      }
    });
  });

  test.each(["7", "8"] as const)("rejects a mixed B%s declaration", (batch) => {
    const loader = createEngineeringFileAccessAddonLoader({
      addonPath: "C:\\fixture\\engineering_file_access.node",
      loadModule: () =>
        addonWithMetadata({
          batch,
          mutation: "unavailable",
          recovery: "unavailable",
          mutationV2Probe: "available",
          recoveryScanProbe: "available",
          stateDurabilityProbe: "available"
        })
    });

    expect(loader.load()).toEqual({ status: "unavailable", reason: "native_module_invalid" });
  });

  test("rejects a Batch 7 declaration missing the native mutation probe boundary", () => {
    const loader = createEngineeringFileAccessAddonLoader({
      addonPath: "C:\\fixture\\engineering_file_access.node",
      loadModule: () =>
        addonWithMetadata({ batch: "7", mutation: "available", recovery: "available" })
    });

    expect(loader.load()).toEqual({ status: "unavailable", reason: "native_module_invalid" });
  });

  test.each([
    {
      name: "a B6 declaration with a B7 field",
      capability: {
        batch: "6",
        mutation: "unavailable",
        recovery: "unavailable",
        mutationV2Probe: "available"
      }
    },
    {
      name: "a B7 declaration with an unavailable mutation probe",
      capability: {
        batch: "7",
        mutation: "available",
        recovery: "available",
        mutationV2Probe: "unavailable",
        recoveryScanProbe: "available",
        stateDurabilityProbe: "available"
      }
    },
    {
      name: "a B8 declaration with an unavailable recovery-scan probe",
      capability: {
        batch: "8",
        mutation: "available",
        recovery: "available",
        mutationV2Probe: "available",
        recoveryScanProbe: "unavailable",
        stateDurabilityProbe: "available"
      }
    },
    {
      name: "a B7 declaration with an unavailable recovery-scan probe",
      capability: {
        batch: "7",
        mutation: "available",
        recovery: "available",
        mutationV2Probe: "available",
        recoveryScanProbe: "unavailable",
        stateDurabilityProbe: "available"
      }
    },
    {
      name: "a B7 declaration with an unavailable state-durability probe",
      capability: {
        batch: "7",
        mutation: "available",
        recovery: "available",
        mutationV2Probe: "available",
        recoveryScanProbe: "available",
        stateDurabilityProbe: "unavailable"
      }
    },
    {
      name: "a declaration with an extra field",
      capability: {
        batch: "7",
        mutation: "available",
        recovery: "available",
        mutationV2Probe: "available",
        recoveryScanProbe: "available",
        stateDurabilityProbe: "available",
        unexpected: "available"
      }
    }
  ])("rejects $name", ({ capability }) => {
    const loader = createEngineeringFileAccessAddonLoader({
      addonPath: "C:\\fixture\\engineering_file_access.node",
      loadModule: () => addonWithMetadata(capability)
    });

    expect(loader.load()).toEqual({ status: "unavailable", reason: "native_module_invalid" });
  });
});

function addonWithMetadata(capability: {
  readonly batch: string;
  readonly mutation: string;
  readonly recovery: string;
  readonly mutationV2Probe?: string;
  readonly recoveryScanProbe?: string;
  readonly stateDurabilityProbe?: string;
  readonly unexpected?: string;
}) {
  return {
    adapterInfo: () => ({
      adapterId: "novel_studio_engineering_file_access",
      target: "win32-x64",
      accessEligible: "available",
      ...capability
    }),
    openWorkspaceRoot: () => 1n,
    closeWorkspaceRoot: () => undefined,
    listDirectory: () => ({ entries: [], truncated: false }),
    readFile: () => Buffer.alloc(0),
    searchText: () => ({ matches: [], truncated: false }),
    buildIndex: () => ({ entries: [], truncated: false })
  };
}
