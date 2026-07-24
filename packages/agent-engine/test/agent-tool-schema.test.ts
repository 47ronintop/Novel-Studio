import { describe, expect, test } from "vitest";
import {
  validateStrictToolSchema,
  validateToolText,
  TOOL_SCHEMA_MAX_BYTES,
  TOOL_DESCRIPTION_MAX_BYTES
} from "../src/agent-tool-schema.js";

describe("validateStrictToolSchema", () => {
  test("accepts valid simple object schema", () => {
    expect(
      validateStrictToolSchema({
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: { type: "string", minLength: 1, maxLength: 1024 } }
      })
    ).toEqual({ ok: true });
  });

  test("rejects unknown keywords", () => {
    const result = validateStrictToolSchema({
      type: "object",
      "$id": "https://example.com/schema"
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/Unknown schema keyword/);
  });

  test("rejects $ref", () => {
    const result = validateStrictToolSchema({
      type: "object",
      "$ref": "#/definitions/foo"
    });
    expect(result.ok).toBe(false);
  });

  test("rejects schema exceeding byte limit", () => {
    const bigEnum = Array.from({ length: 200 }, (_, i) => `value_${i}`);
    const result = validateStrictToolSchema({
      type: "string",
      enum: bigEnum,
      description: "x".repeat(TOOL_SCHEMA_MAX_BYTES)
    });
    expect(result.ok).toBe(false);
  });

  test("rejects deeply nested schema", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 10; i++) {
      schema = { type: "object", properties: { nested: schema } };
    }
    const result = validateStrictToolSchema(schema);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/nesting/);
  });

  test("rejects dangerous regex patterns", () => {
    const result = validateStrictToolSchema({
      type: "string",
      pattern: "(a+)+"
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/catastrophic/i);
  });

  test("rejects invalid regex pattern", () => {
    const result = validateStrictToolSchema({
      type: "string",
      pattern: "["
    });
    expect(result.ok).toBe(false);
  });

  test("rejects too many enum values", () => {
    const result = validateStrictToolSchema({
      type: "string",
      enum: Array.from({ length: 200 }, (_, i) => `v${i}`)
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/Enum/);
  });

  test("accepts nested objects within depth limit", () => {
    expect(
      validateStrictToolSchema({
        type: "object",
        properties: {
          range: {
            type: "object",
            additionalProperties: false,
            required: ["unit"],
            properties: { unit: { type: "string", enum: ["character", "line"] } }
          }
        }
      })
    ).toEqual({ ok: true });
  });
});

describe("validateToolText", () => {
  test("accepts normal text", () => {
    expect(validateToolText("hello world", TOOL_DESCRIPTION_MAX_BYTES, "description")).toEqual({
      ok: true
    });
  });

  test("rejects control characters", () => {
    const result = validateToolText("hello\x01world", TOOL_DESCRIPTION_MAX_BYTES, "description");
    expect(result.ok).toBe(false);
  });

  test("rejects oversized text", () => {
    const result = validateToolText(
      "x".repeat(TOOL_DESCRIPTION_MAX_BYTES + 1),
      TOOL_DESCRIPTION_MAX_BYTES,
      "description"
    );
    expect(result.ok).toBe(false);
  });
});
