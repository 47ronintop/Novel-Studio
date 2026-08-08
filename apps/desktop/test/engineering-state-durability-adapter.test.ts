import { describe, expect, test, vi } from "vitest";

import { createEngineeringStateDurabilityPortV2 } from "../src/main/engineering-file-access-adapter.js";

describe("EngineeringStateDurabilityPortV2 adapter", () => {
  test("maps only Main-owned state-root paths to the single native addon durability ABI", async () => {
    const addon = stateAddon();
    const port = createEngineeringStateDurabilityPortV2({
      stateRoot: "C:\\Novel Studio\\state",
      addonLoader: loadedAddon(addon)
    });
    if (port === undefined) throw new Error("expected qualified durability port");

    await port.ensureDirectoryNoFollow("C:\\Novel Studio\\state\\engineering-v2\\wal");
    await port.flushDirectory("C:\\Novel Studio\\state\\engineering-v2\\wal");
    const handle = await port.openExclusiveNoFollow(
      "C:\\Novel Studio\\state\\engineering-v2\\wal\\record.tmp"
    );
    await handle.writeFile(new Uint8Array([1, 2, 3]));
    await handle.sync();
    await handle.close();
    await handle.close();
    await expect(handle.writeFile(new Uint8Array([4]))).rejects.toThrow(
      "Engineering state file handle is closed"
    );

    await expect(
      port.readFileNoFollow("C:\\Novel Studio\\state\\engineering-v2\\wal\\record.json")
    ).resolves.toEqual(new Uint8Array([4, 5]));
    await expect(
      port.readDirectoryNoFollow("C:\\Novel Studio\\state\\engineering-v2\\wal")
    ).resolves.toEqual([
      { name: "record.json", kind: "file" },
      { name: "unexpected", kind: "other" }
    ]);
    await port.linkNoFollow(
      "C:\\Novel Studio\\state\\engineering-v2\\wal\\record.tmp",
      "C:\\Novel Studio\\state\\engineering-v2\\wal\\record.json"
    );
    await port.renameReplaceNoFollow(
      "C:\\Novel Studio\\state\\engineering-v2\\wal\\record.tmp",
      "C:\\Novel Studio\\state\\engineering-v2\\wal\\record.json"
    );
    await port.unlinkNoFollow("C:\\Novel Studio\\state\\engineering-v2\\wal\\record.tmp");

    expect(addon.openEngineeringStateRoot).toHaveBeenCalledWith("C:\\Novel Studio\\state");
    expect(addon.ensureEngineeringStateDirectoryNoFollow).toHaveBeenCalledWith(
      9n,
      "engineering-v2/wal"
    );
    expect(addon.openEngineeringStateExclusiveNoFollow).toHaveBeenCalledWith(
      9n,
      "engineering-v2/wal/record.tmp"
    );
    expect(addon.linkEngineeringStateFileNoFollow).toHaveBeenCalledWith(
      9n,
      "engineering-v2/wal/record.tmp",
      "engineering-v2/wal/record.json"
    );
    expect(addon.closeEngineeringStateFile).toHaveBeenCalledTimes(1);
  });

  test("disposes the Main-owned native state root exactly once, even when close throws", () => {
    const addon = stateAddon();
    addon.closeEngineeringStateRoot.mockImplementation(() => {
      throw new Error("native close failed");
    });
    const port = createEngineeringStateDurabilityPortV2({
      stateRoot: "C:\\Novel Studio\\state",
      addonLoader: loadedAddon(addon)
    });
    if (port === undefined) throw new Error("expected qualified durability port");

    expect(() => port.dispose()).toThrow("native close failed");
    expect(() => port.dispose()).not.toThrow();
    expect(addon.closeEngineeringStateRoot).toHaveBeenCalledTimes(1);
    expect(addon.closeEngineeringStateRoot).toHaveBeenCalledWith(9n);
  });

  test("fails closed when native ABI is absent, state root is relative, or a path escapes the root", async () => {
    const addon = stateAddon();
    expect(
      createEngineeringStateDurabilityPortV2({
        stateRoot: "relative-state",
        addonLoader: loadedAddon(addon)
      })
    ).toBeUndefined();
    expect(
      createEngineeringStateDurabilityPortV2({
        stateRoot: "C:\\Novel Studio\\state",
        addonLoader: { load: () => ({ status: "unavailable", reason: "native_module_invalid" }) }
      })
    ).toBeUndefined();

    const port = createEngineeringStateDurabilityPortV2({
      stateRoot: "C:\\Novel Studio\\state",
      addonLoader: loadedAddon(addon)
    });
    if (port === undefined) throw new Error("expected qualified durability port");
    await expect(port.readFileNoFollow("C:\\Novel Studio\\other\\record.json")).rejects.toThrow(
      "escapes the Main-owned state root"
    );
    expect(addon.readEngineeringStateFileNoFollow).not.toHaveBeenCalled();

    const missingAddon = stateAddon();
    missingAddon.readEngineeringStateFileNoFollow.mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENGINEERING_ACCESS_NOT_FOUND" });
    });
    const missingPort = createEngineeringStateDurabilityPortV2({
      stateRoot: "C:\\Novel Studio\\state",
      addonLoader: loadedAddon(missingAddon)
    });
    if (missingPort === undefined) throw new Error("expected qualified durability port");
    await expect(
      missingPort.readFileNoFollow("C:\\Novel Studio\\state\\engineering-v2\\missing.json")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function loadedAddon(addon: ReturnType<typeof stateAddon>) {
  return {
    load: () => ({
      status: "loaded" as const,
      addon,
      metadata: {
        adapterId: "novel_studio_engineering_file_access" as const,
        target: "win32-x64" as const,
        batch: "6" as const,
        accessEligible: "available" as const,
        mutation: "unavailable" as const,
        recovery: "unavailable" as const
      }
    })
  };
}

function stateAddon() {
  return {
    adapterInfo: vi.fn(),
    openWorkspaceRoot: vi.fn(),
    closeWorkspaceRoot: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    searchText: vi.fn(),
    buildIndex: vi.fn(),
    openEngineeringStateRoot: vi.fn(() => 9n),
    closeEngineeringStateRoot: vi.fn(),
    ensureEngineeringStateDirectoryNoFollow: vi.fn(),
    flushEngineeringStateDirectory: vi.fn(),
    openEngineeringStateExclusiveNoFollow: vi.fn(() => 12n),
    writeEngineeringStateFile: vi.fn(),
    syncEngineeringStateFile: vi.fn(),
    closeEngineeringStateFile: vi.fn(),
    readEngineeringStateFileNoFollow: vi.fn(() => new Uint8Array([4, 5])),
    readEngineeringStateDirectoryNoFollow: vi.fn(() => [
      { name: "record.json", kind: "file" },
      { name: "unexpected", kind: "other" }
    ]),
    linkEngineeringStateFileNoFollow: vi.fn(),
    renameReplaceEngineeringStateFileNoFollow: vi.fn(),
    unlinkEngineeringStateFileNoFollow: vi.fn()
  };
}
