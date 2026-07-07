import { describe, expect, test } from "vitest";

import {
  findEditorMatches,
  replaceAllEditorMatches,
  replaceCurrentEditorMatch
} from "../src/editor-find-replace.js";

describe("editor find and replace", () => {
  test("finds next and previous matches with optional case sensitivity", () => {
    const body = "Moon over moonbase.\nmoon over Moon.";

    expect(findEditorMatches({ body, query: "moon", caseSensitive: false })).toEqual([
      { startOffset: 0, endOffset: 4 },
      { startOffset: 10, endOffset: 14 },
      { startOffset: 20, endOffset: 24 },
      { startOffset: 30, endOffset: 34 }
    ]);
    expect(findEditorMatches({ body, query: "moon", caseSensitive: true })).toEqual([
      { startOffset: 10, endOffset: 14 },
      { startOffset: 20, endOffset: 24 }
    ]);
  });

  test("replaces the active match and all matches without touching non-matches", () => {
    const body = "Moon over moonbase.\nmoon over Moon.";

    expect(
      replaceCurrentEditorMatch({
        body,
        query: "moon",
        replacement: "sun",
        caseSensitive: false,
        activeMatchIndex: 1
      })
    ).toEqual({
      body: "Moon over sunbase.\nmoon over Moon.",
      replaced: true,
      nextSelection: { anchor: 10, head: 13 }
    });

    expect(
      replaceAllEditorMatches({
        body,
        query: "moon",
        replacement: "sun",
        caseSensitive: false
      })
    ).toEqual({
      body: "sun over sunbase.\nsun over sun.",
      replaceCount: 4
    });
  });
});
