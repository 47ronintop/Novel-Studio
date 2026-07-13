import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";
import { createUnifiedError } from "../src/errors.js";
import { err, isErr, isOk, ok, unwrapOr } from "../src/result.js";

describe("Result helpers", () => {
  test("represents successful and failed outcomes without throwing", () => {
    const success = ok({ projectId: "prj_test" });
    const failure = err("missing project.json");

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(success.value.projectId).toBe("prj_test");

    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);
    expect(failure.error).toBe("missing project.json");
    expect(unwrapOr(failure, "fallback")).toBe("fallback");
  });
});

describe("Unified Error", () => {
  test("keeps the shared error factory safe for browser renderer bundles", () => {
    const source = readFileSync(new URL("../src/errors.ts", import.meta.url), "utf8");

    expect(source).not.toContain("node:crypto");
  });

  test("creates the stable error shape required by the schema contract", () => {
    const error = createUnifiedError({
      code: "PROJECT_FILE_INVALID",
      category: "ValidationError",
      message: "project.json failed schema validation",
      recoverability: "user-action",
      suggestedAction: "Fix project.json and retry.",
      traceId: "trace_test",
      redactedDetail: {
        fileName: "project.json"
      }
    });

    expect(error.schemaVersion).toBe("1.0");
    expect(error.errorId).toMatch(/^err_/);
    expect(error.code).toBe("PROJECT_FILE_INVALID");
    expect(error.category).toBe("ValidationError");
    expect(error.createdAt).toMatch(/Z$/);
    expect(error.redactedDetail).toEqual({ fileName: "project.json" });
  });
});
