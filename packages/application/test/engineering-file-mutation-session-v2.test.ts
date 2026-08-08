import { describe, expect, test } from "vitest";

import {
  checksumEngineeringFileMutationToolPayloadV2,
  engineeringToolCallPayloadConflictV2
} from "../src/engineering-file-mutation-session-v2.js";

describe("Engineering file mutation session V2 contract", () => {
  test("canonicalizes equivalent replace payloads and changes the digest for any argument drift", () => {
    const fileRef = `engineering_file_ref:${"a".repeat(64)}`;
    const first = checksumEngineeringFileMutationToolPayloadV2({
      toolName: "propose_file_write",
      arguments: {
        replacement: "new\r\ntext",
        fileRef,
        range: { end: 3, unit: "character", start: 1 }
      }
    });
    const reordered = checksumEngineeringFileMutationToolPayloadV2({
      toolName: "propose_file_write",
      arguments: {
        fileRef,
        range: { unit: "character", start: 1, end: 3 },
        replacement: "new\r\ntext"
      }
    });
    const changed = checksumEngineeringFileMutationToolPayloadV2({
      toolName: "propose_file_write",
      arguments: {
        fileRef,
        range: { unit: "character", start: 1, end: 4 },
        replacement: "new\r\ntext"
      }
    });

    expect(first).toEqual(reordered);
    expect(first.ok && changed.ok && first.value).not.toBe(changed.ok ? changed.value : "");
  });

  test("rejects non-canonical ranges, provider-controlled path fields, and unsafe leaf names", () => {
    const fileRef = `engineering_file_ref:${"a".repeat(64)}`;
    const parentRef = `engineering_directory_ref:${"b".repeat(64)}`;
    expect(
      checksumEngineeringFileMutationToolPayloadV2({
        toolName: "propose_file_write",
        arguments: {
          fileRef,
          range: { unit: "character", start: 4, end: 3 },
          replacement: "x"
        }
      })
    ).toMatchObject({ ok: false });
    expect(
      checksumEngineeringFileMutationToolPayloadV2({
        toolName: "propose_file_write",
        arguments: {
          fileRef,
          range: { unit: "character", start: 0, end: 0 },
          replacement: "x",
          path: "src/index.ts"
        }
      })
    ).toMatchObject({ ok: false });
    for (const name of [".", "..", "CON", "trailing. ", "nested/file.ts"]) {
      expect(
        checksumEngineeringFileMutationToolPayloadV2({
          toolName: "propose_file_create",
          arguments: { parentRef, name, candidate: "x" }
        })
      ).toMatchObject({ ok: false });
    }
  });

  test("uses the stable conflict code required by same-toolCallId replay", () => {
    expect(engineeringToolCallPayloadConflictV2()).toMatchObject({
      code: "ENGINEERING_TOOL_CALL_ID_PAYLOAD_CONFLICT"
    });
  });
});
