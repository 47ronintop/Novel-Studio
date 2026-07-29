import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";
import {
  createForeshadowEvidence,
  hashForeshadowEvidence,
  normalizeForeshadowEvidence
} from "../src/foreshadow.js";

describe("foreshadow evidence helpers", () => {
  test("normalizes Unicode, line endings, and surrounding whitespace", () => {
    expect(normalizeForeshadowEvidence("  Cafe\u0301\r\n线索\r下一行  ")).toBe(
      "Café\n线索\n下一行"
    );
  });

  test("hashes the normalized UTF-8 evidence with SHA-256", async () => {
    await expect(hashForeshadowEvidence("  Cafe\u0301\r\n线索\r下一行  ")).resolves.toBe(
      "bdc59e1a92ad834992943ce6d0ac1bdbb892092f3fe9777a9b1ad03c447b4d7f"
    );
    await expect(hashForeshadowEvidence("Café\n线索\n下一行")).resolves.toBe(
      "bdc59e1a92ad834992943ce6d0ac1bdbb892092f3fe9777a9b1ad03c447b4d7f"
    );
  });

  test("creates a source reference with normalized evidence and its hash", async () => {
    await expect(createForeshadowEvidence("ch_01", "  旧钥匙\r\n再次出现。  ")).resolves.toEqual({
      chapterId: "ch_01",
      excerpt: "旧钥匙\n再次出现。",
      excerptHash: "ce823ea3a48d0b7382735aea98776b6282746d17a8d70d52a8e93916a840e09b"
    });
  });

  test("keeps the shared helper safe for browser renderer bundles", () => {
    const source = readFileSync(new URL("../src/foreshadow.ts", import.meta.url), "utf8");

    expect(source).not.toContain("node:crypto");
  });
});
