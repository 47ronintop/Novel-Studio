import { describe, expect, test } from "vitest";
import { createUnifiedError } from "@novel-studio/shared";

import {
  NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
  WindowsNativeFileOperations,
  parseNativeFileOperationsManifest,
  type NativeFileOperationsTransport
} from "../src/main/native-file-operations.js";

describe("WindowsNativeFileOperations", () => {
  test("does not treat the source-tree placeholder as a usable lifecycle host", async () => {
    const result = await WindowsNativeFileOperations.fromPackagedResources({
      resourcesBase: "apps/desktop/resources"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED" }
    });
  });

  test("keeps the source-tree placeholder unavailable", () => {
    expect(
      parseNativeFileOperationsManifest({
        schemaVersion: "1.0",
        status: "unavailable",
        protocolVersion: "1.1",
        artifact: {
          path: "native/agent-file-operations/agent-file-operations-host.exe",
          digest: "placeholder"
        }
      })
    ).toMatchObject({ status: "unavailable" });
    expect(
      parseNativeFileOperationsManifest({
        schemaVersion: "1.0",
        status: "qualified",
        protocolVersion: "1.1",
        artifact: {
          path: "native/agent-file-operations/agent-file-operations-host.exe",
          digest: "placeholder"
        }
      })
    ).toBeUndefined();
  });

  test("rejects manifest extensions and resource-path escapes", () => {
    expect(
      parseNativeFileOperationsManifest({
        schemaVersion: "1.0",
        status: "unavailable",
        protocolVersion: "1.1",
        artifact: { path: "../host.exe", digest: "placeholder" },
        callerControlled: true
      })
    ).toBeUndefined();
    expect(
      parseNativeFileOperationsManifest({
        schemaVersion: "1.0",
        status: "unavailable",
        protocolVersion: "1.1",
        artifact: { path: "C:\\host.exe", digest: "placeholder" }
      })
    ).toBeUndefined();
  });

  test("binds the root in Main before forwarding an immutable lifecycle mutation", async () => {
    const requests: unknown[] = [];
    const transport: NativeFileOperationsTransport = {
      async invoke(_binaryPath, request) {
        requests.push(request);
        return { schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION, ok: true };
      }
    };
    const host = WindowsNativeFileOperations.forTesting({ transport });
    const lifecycleResult = await host.withProjectRoot("C:\\projects\\story");
    expect(lifecycleResult.ok).toBe(true);
    if (!lifecycleResult.ok) throw new Error("test root binding failed");
    const lifecycle = lifecycleResult.value;

    const result = await lifecycle.mutate({
      kind: "create_file",
      relativePath: "notes/new.md",
      content: "new text",
      before: [{ kind: "missing", relativePath: "notes/new.md" }],
      after: [
        {
          kind: "file",
          relativePath: "notes/new.md",
          content: "new text",
          checksum: "a".repeat(64)
        }
      ]
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(requests).toEqual([
      {
        schemaVersion: "1.1",
        root: "C:\\projects\\story",
        rootIdentity: { device: "1", inode: "2" },
        operation: {
          kind: "create_file",
          relativePath: "notes/new.md",
          content: "new text",
          before: [{ kind: "missing", relativePath: "notes/new.md" }],
          after: [
            {
              kind: "file",
              relativePath: "notes/new.md",
              content: "new text",
              checksum: "a".repeat(64)
            }
          ]
        }
      }
    ]);
  });

  test("does not allow the unbound host to mutate a caller-selected root", async () => {
    const host = WindowsNativeFileOperations.forTesting({
      transport: {
        async invoke() {
          throw new Error("must not be called");
        }
      }
    });
    const result = await host.mutate({
      kind: "create_directory",
      relativePath: "notes",
      before: [{ kind: "missing", relativePath: "notes" }],
      after: [{ kind: "directory", relativePath: "notes" }]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED" }
    });
  });

  test("fails closed when the bound root identity cannot be captured", async () => {
    let invoked = false;
    const host = WindowsNativeFileOperations.forTesting({
      transport: {
        async invoke() {
          invoked = true;
          throw new Error("must not be called");
        }
      },
      rootIdentityReader: async () => ({
        ok: false,
        error: createUnifiedError({
          code: "AGENT_WRITE_PATH_REJECTED",
          category: "StorageError",
          message: "root changed",
          recoverability: "user-action",
          suggestedAction: "retry",
          traceId: "test"
        })
      })
    });

    const result = await host.withProjectRoot("C:\\projects\\story");

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_PATH_REJECTED" } });
    expect(invoked).toBe(false);
  });

  test("maps a native reparse-point rejection to the transaction path boundary", async () => {
    const host = WindowsNativeFileOperations.forTesting({
      transport: {
        async invoke() {
          return {
            schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
            ok: false,
            code: "REPARSE_POINT_REJECTED"
          };
        }
      }
    });
    const lifecycleResult = await host.withProjectRoot("C:\\projects\\story");
    expect(lifecycleResult.ok).toBe(true);
    if (!lifecycleResult.ok) throw new Error("test root binding failed");
    const lifecycle = lifecycleResult.value;
    const result = await lifecycle.mutate({
      kind: "create_directory",
      relativePath: "notes",
      before: [{ kind: "missing", relativePath: "notes" }],
      after: [{ kind: "directory", relativePath: "notes" }]
    });

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_PATH_REJECTED" } });
  });
});
