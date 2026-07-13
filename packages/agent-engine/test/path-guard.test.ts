import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent project path guard", () => {
  test("accepts canonical project text paths and rejects escape or internal paths", () => {
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRelativePath"
    ];
    expect(typeof validate).toBe("function");
    if (typeof validate !== "function") return;

    expect(validate("chapters/ch_01.md")).toEqual({
      ok: true,
      value: { relativePath: "chapters/ch_01.md" }
    });
    for (const path of [
      "",
      "../outside.md",
      "chapters/../outside.md",
      "C:/outside.md",
      "\\\\server\\share\\file.md",
      "chapters\\ch_01.md",
      "chapters/file.md:secret",
      "CON.txt",
      "history/agent-runs/run.json",
      ".git/config",
      "node_modules/pkg/index.js",
      "images/cover.png"
    ]) {
      expect(validate(path)).toMatchObject({
        ok: false,
        error: { code: "AGENT_PATH_REJECTED" }
      });
    }
  });
});
