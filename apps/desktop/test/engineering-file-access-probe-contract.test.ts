import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

// @ts-expect-error The probe is executable JavaScript and intentionally has no desktop type surface.
import {
  probeReadOnlyAbi,
  readOnlyAvailabilityFor
} from "../../../scripts/probe-engineering-file-access-package.mjs";

const fixturePath = fileURLToPath(
  new URL("./engineering-file-access-probe-fixtures/ordinary-utf8.txt", import.meta.url)
);

describe("engineering file access development probe contract", () => {
  test("exercises the read-only ABI with a deterministic ordinary UTF-8 read and safe traversal canaries", async () => {
    const fixture = normalizeProbeFixture(await readFile(fixturePath, "utf8"));
    const adapter = hardenedReadOnlyFixtureAdapter(fixture);

    await expect(probeReadOnlyAbi(adapter)).resolves.toMatchObject({
      status: "passed",
      ordinaryUtf8Read: "passed",
      ordinaryUtf8List: "passed",
      ordinaryUtf8Index: "passed",
      ordinaryUtf8Search: "passed",
      rootRelativeTraversal: "passed",
      rejectedPaths: expect.arrayContaining([
        "../engineering-file-access-probe-outside.txt",
        "docs/../../engineering-file-access-probe-outside.txt",
        "C:\\engineering-file-access-probe-outside.txt",
        "\\\\server\\share\\engineering-file-access-probe-outside.txt"
      ])
    });
    expect(adapter.paths).toEqual(
      expect.arrayContaining([
        "docs/ordinary-utf8.txt",
        "../engineering-file-access-probe-outside.txt"
      ])
    );
  });

  test("fails closed when an otherwise available ABI reads an adversarial path", async () => {
    const adapter = hardenedReadOnlyFixtureAdapter(
      normalizeProbeFixture(await readFile(fixturePath, "utf8"))
    );
    const hardenedRead = adapter.readFile;
    adapter.readFile = (rootId: bigint, relativePath: string) => {
      adapter.paths.push(relativePath);
      if (relativePath === "docs/ordinary-utf8.txt") return hardenedRead(rootId, relativePath);
      return Buffer.from("incorrectly reachable", "utf8");
    };

    await expect(probeReadOnlyAbi(adapter)).rejects.toThrow(
      'B6 readFile unexpectedly accepted adversarial path: "../engineering-file-access-probe-outside.txt"'
    );
  });

  test("allows only complete read-only capability declarations", async () => {
    expect(
      readOnlyAvailabilityFor({
        eligibility: {
          root: "unavailable",
          access: "unavailable",
          read: "unavailable",
          index: "unavailable"
        }
      })
    ).toBe("unavailable");
    expect(
      readOnlyAvailabilityFor({
        eligibility: {
          root: "available",
          access: "available",
          read: "available",
          index: "available"
        }
      })
    ).toBe("available");
    expect(() =>
      readOnlyAvailabilityFor({
        eligibility: {
          root: "available",
          access: "unavailable",
          read: "unavailable",
          index: "unavailable"
        }
      })
    ).toThrow("must not partially advertise B6 read-only capabilities");
  });
});

function hardenedReadOnlyFixtureAdapter(expectedFixture: string) {
  let workspaceRoot: string | undefined;
  const expectedBytes = Buffer.from(expectedFixture, "utf8");
  const adapter = {
    paths: [] as string[],
    openWorkspaceRoot(root: string) {
      workspaceRoot = root;
      return {
        rootId: 1n,
        capability: "available",
        rootIdentity: {
          volumeIdentity: "d0c0b0a0",
          directoryIdentity: "0000000000000001",
          canonicalPathIdentityChecksum: "a".repeat(64)
        }
      };
    },
    readFile(rootId: bigint, relativePath: string) {
      adapter.paths.push(relativePath);
      if (rootId !== 1n || !workspaceRoot || relativePath !== "docs/ordinary-utf8.txt") {
        throw new Error("rejected by fixture root-relative reader");
      }
      const bytes = readFileSync(join(workspaceRoot, relativePath));
      expect(bytes.toString("utf8")).toBe(expectedFixture);
      return bytes;
    },
    listDirectory(rootId: bigint, relativePath: string) {
      if (rootId !== 1n || relativePath !== "docs") {
        throw new Error("rejected by fixture root-relative lister");
      }
      return [
        {
          name: "ordinary-utf8.txt",
          directory: false,
          byteLength: BigInt(expectedBytes.byteLength)
        }
      ];
    },
    buildIndex(rootId: bigint) {
      if (rootId !== 1n) throw new Error("rejected by fixture root-relative indexer");
      return {
        files: [
          {
            relativePath: "docs/ordinary-utf8.txt",
            byteLength: BigInt(expectedBytes.byteLength)
          }
        ],
        truncated: false
      };
    },
    searchText(rootId: bigint, query: string) {
      if (rootId !== 1n || query !== "needle: deterministic-search") {
        throw new Error("rejected by fixture root-relative searcher");
      }
      return {
        matches: [
          {
            relativePath: "docs/ordinary-utf8.txt",
            byteOffset: BigInt(expectedBytes.indexOf(Buffer.from(query, "utf8")))
          }
        ],
        truncated: false
      };
    },
    closeWorkspaceRoot(rootId: bigint) {
      if (rootId !== 1n) throw new Error("rejected by fixture root closer");
      workspaceRoot = undefined;
      return true;
    }
  };
  return adapter;
}

function normalizeProbeFixture(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}
