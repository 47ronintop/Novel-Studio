import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent run tool catalog snapshots", () => {
  function descriptors() {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    return listTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation"
    });
  }

  function snapshot() {
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshot"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    return create({
      runId: "run_catalog_01",
      facadeVersion: "v2",
      descriptors: descriptors(),
      createdAt: "2026-07-26T00:00:00.000Z"
    });
  }

  test("derives deterministic revisions from the facade and descriptor contents", () => {
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshot"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const first = snapshot();
    const second = create({
      runId: "run_catalog_01",
      facadeVersion: "v2",
      descriptors: descriptors(),
      createdAt: "2026-07-27T00:00:00.000Z"
    });

    expect(first["descriptorRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(first["providerMappingRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(first["catalogRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatchObject({
      descriptorRevision: first["descriptorRevision"],
      providerMappingRevision: first["providerMappingRevision"],
      catalogRevision: first["catalogRevision"]
    });
  });

  test("rejects descriptor, descriptor revision, and provider mapping tampering", () => {
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean };
    const original = snapshot();
    const originalDescriptors = original["descriptors"] as Record<string, unknown>[];
    const tamperedDescriptor = {
      ...original,
      descriptors: [
        { ...originalDescriptors[0], description: "tampered" },
        ...originalDescriptors.slice(1)
      ]
    };

    expect(validate(original)).toMatchObject({ ok: true });
    expect(validate(tamperedDescriptor)).toMatchObject({ ok: false });
    expect(validate({ ...original, descriptorRevision: "0".repeat(64) })).toMatchObject({
      ok: false
    });
    expect(validate({ ...original, providerMappingRevision: "0".repeat(64) })).toMatchObject({
      ok: false
    });
  });
});
