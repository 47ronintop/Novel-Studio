import { describe, expect, test } from "vitest";

import {
  CANONICAL_LEAF_NAME_MAX_UTF8_BYTES,
  canonicalLeafNameCollisionKey,
  findCanonicalLeafNameCollision,
  validateCanonicalLeafName
} from "../src/index.js";

describe("CanonicalLeafName", () => {
  test("accepts canonical printable names and yields a locale-neutral collision key", () => {
    const source = validateCanonicalLeafName("src-file_01.ts");
    const unicode = validateCanonicalLeafName("caf\u00e9.txt");
    expect(source).toMatchObject({ ok: true, value: "src-file_01.ts" });
    expect(unicode).toMatchObject({ ok: true, value: "caf\u00e9.txt" });
    if (!source.ok || !unicode.ok) return;
    expect(canonicalLeafNameCollisionKey(source.value)).toBe("src-file_01.ts");
    expect(findCanonicalLeafNameCollision([source.value, unicode.value])).toEqual({
      collision: false
    });
  });

  test("rejects traversal, namespace, reserved-device, and trailing-name aliases", () => {
    for (const [input, code] of [
      ["", "empty"],
      [".", "dot_segment"],
      ["..", "dot_segment"],
      ["src/index.ts", "separator"],
      ["src\\index.ts", "separator"],
      ["file.txt:stream", "ads_or_drive_prefix"],
      ["CON.txt", "windows_reserved_name"],
      ["lPt9", "windows_reserved_name"],
      ["report. ", "trailing_dot_or_space"],
      ["name ", "trailing_dot_or_space"],
      ["bad?.txt", "platform_illegal_character"]
    ] as const) {
      expect(validateCanonicalLeafName(input)).toEqual({ ok: false, code });
    }
  });

  test("rejects controls, bidi and invisible format characters without normalizing aliases", () => {
    for (const input of [
      "line\nfeed",
      "nul\0byte",
      "safe\u202Etxt",
      "join\u200Dme",
      "cafe\u0301.txt",
      "\ud800"
    ]) {
      expect(validateCanonicalLeafName(input)).toMatchObject({ ok: false });
    }
    expect(validateCanonicalLeafName("cafe\u0301.txt")).toEqual({
      ok: false,
      code: "non_canonical_unicode"
    });
  });

  test("enforces a UTF-8 byte ceiling and catches case collisions", () => {
    const accepted = validateCanonicalLeafName("Readme.md");
    const colliding = validateCanonicalLeafName("README.md");
    expect(validateCanonicalLeafName("a".repeat(CANONICAL_LEAF_NAME_MAX_UTF8_BYTES + 1))).toEqual({
      ok: false,
      code: "too_long"
    });
    if (!accepted.ok || !colliding.ok) return;
    expect(findCanonicalLeafNameCollision([accepted.value, colliding.value])).toEqual({
      collision: true
    });
  });
});
