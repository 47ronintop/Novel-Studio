import { describe, expect, test } from "vitest";

import {
  projectPublicReleaseCatalog,
  projectPublicReleaseDescriptors,
  validateCatalogClaims,
  validatePublicReleaseCatalog
} from "../../../scripts/public-release-catalog.mjs";

const digest = "a".repeat(64);
const descriptor = { id: "read_text", name: "read_text", descriptorDigest: digest };
const phase = { id: "phase-a", status: "Complete", releaseEligible: true };

function manifest(
  catalogClaims: unknown[] = [
    {
      toolId: "read_text",
      contextProfileId: "engineering",
      descriptorDigest: digest,
      phaseIds: ["phase-a"]
    }
  ]
) {
  return { phases: [phase], catalogClaims };
}

const catalogEntry = {
  contextProfileId: "engineering",
  descriptor
};

describe("public release catalog evidence gate", () => {
  test("projects only a descriptor with one matching eligible claim", () => {
    const result = projectPublicReleaseDescriptors({
      descriptors: [descriptor],
      contextProfileId: "engineering",
      manifest: manifest()
    });
    expect(result.descriptors).toEqual([descriptor]);
    expect(result.errors).toEqual([]);
  });

  test("fails closed for missing, duplicate, stale, and digest-drifted claims", () => {
    for (const claims of [
      [],
      [
        {
          toolId: "read_text",
          contextProfileId: "engineering",
          descriptorDigest: digest,
          phaseIds: ["phase-a"]
        },
        {
          toolId: "read_text",
          contextProfileId: "engineering",
          descriptorDigest: digest,
          phaseIds: ["phase-a"]
        }
      ],
      [
        {
          toolId: "read_text",
          contextProfileId: "engineering",
          descriptorDigest: digest,
          phaseIds: ["missing"]
        }
      ],
      [
        {
          toolId: "read_text",
          contextProfileId: "engineering",
          descriptorDigest: "b".repeat(64),
          phaseIds: ["phase-a"]
        }
      ]
    ]) {
      const result = projectPublicReleaseDescriptors({
        descriptors: [descriptor],
        contextProfileId: "engineering",
        manifest: manifest(claims)
      });
      expect(result.descriptors).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("requires machine-readable claim shape", () => {
    expect(validateCatalogClaims({ phases: [] })).toEqual([
      "Stage 5 evidence manifest must declare catalogClaims for public release projection."
    ]);
    expect(validateCatalogClaims(manifest([{ toolId: "read_text" }]))).toEqual([
      "Stage 5 catalog claim is incomplete."
    ]);
  });

  test("rejects duplicate claims and claims that reference unknown phases", () => {
    const duplicate = manifest([
      {
        toolId: "read_text",
        contextProfileId: "engineering",
        descriptorDigest: digest,
        phaseIds: ["phase-a"]
      },
      {
        toolId: "read_text",
        contextProfileId: "engineering",
        descriptorDigest: digest,
        phaseIds: ["phase-a"]
      }
    ]);
    expect(validateCatalogClaims(duplicate)).toEqual([
      "Stage 5 catalog claim is duplicated: read_text."
    ]);
    expect(
      validateCatalogClaims(
        manifest([
          {
            toolId: "read_text",
            contextProfileId: "engineering",
            descriptorDigest: digest,
            phaseIds: ["phase-missing"]
          }
        ])
      )
    ).toEqual(["Stage 5 catalog claim is incomplete."]);
  });

  test("rejects duplicate phase ids instead of using array order", () => {
    const duplicatedPhases = {
      ...manifest(),
      phases: [phase, { id: "phase-a", status: "Partial", releaseEligible: false }]
    };
    expect(validateCatalogClaims(duplicatedPhases)).toEqual([
      "Stage 5 phase id is duplicated: phase-a."
    ]);
    expect(
      projectPublicReleaseDescriptors({
        descriptors: [descriptor],
        contextProfileId: "engineering",
        manifest: duplicatedPhases
      }).descriptors
    ).toEqual([]);
  });

  test("rejects claims that reference incomplete or ineligible phases", () => {
    const incompletePhase = {
      ...manifest(),
      phases: [{ id: "phase-a", status: "Partial", releaseEligible: false }]
    };
    expect(validateCatalogClaims(incompletePhase)).toEqual([
      "Stage 5 catalog claim is incomplete."
    ]);
    const ineligiblePhase = {
      ...manifest(),
      phases: [{ id: "phase-a", status: "Complete", releaseEligible: false }]
    };
    expect(validateCatalogClaims(ineligiblePhase)).toEqual([
      "Stage 5 catalog claim is incomplete."
    ]);
  });

  test("does not publish a partial descriptor projection", () => {
    const result = projectPublicReleaseDescriptors({
      descriptors: [descriptor, { id: "write_text", name: "write_text", descriptorDigest: digest }],
      contextProfileId: "engineering",
      manifest: manifest()
    });
    expect(result.descriptors).toEqual([]);
    expect(result.errors).toEqual(["write_text has 0 matching catalog claims"]);
  });

  test("connects the manifest's public catalog to descriptor claims", () => {
    const valid = { ...manifest(), publicReleaseCatalog: [catalogEntry] };
    expect(
      projectPublicReleaseCatalog({ entries: valid.publicReleaseCatalog, manifest: valid }).entries
    ).toEqual([catalogEntry]);
    expect(validatePublicReleaseCatalog(valid)).toEqual([]);

    const missingClaim = {
      ...manifest([]),
      publicReleaseCatalog: [catalogEntry]
    };
    expect(validatePublicReleaseCatalog(missingClaim)).toEqual([
      "read_text has 0 matching catalog claims"
    ]);
    expect(validatePublicReleaseCatalog(manifest())).toEqual([
      "Stage 5 evidence manifest must declare publicReleaseCatalog for public release projection."
    ]);
  });

  test("rejects duplicate public catalog entries", () => {
    const duplicated = {
      ...manifest(),
      publicReleaseCatalog: [catalogEntry, catalogEntry]
    };
    expect(validatePublicReleaseCatalog(duplicated)).toEqual([
      "Stage 5 public release catalog entry is duplicated: read_text."
    ]);
  });
});
