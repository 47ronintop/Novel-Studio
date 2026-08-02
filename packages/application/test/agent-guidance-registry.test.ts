import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  HISTORICAL_AGENT_GUIDANCE_RENDERER_VERSION,
  HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION,
  buildAgentSystemPrompt,
  getHistoricalAgentGuidanceRegistration,
  listHistoricalAgentGuidanceRegistrations,
  materializeHistoricalAgentGuidance,
  parseHistoricalAgentGuidanceRefId,
  verifyHistoricalAgentGuidance,
  type AgentContextProfileId
} from "../src/index.js";

interface GuidanceFixtureManifest {
  readonly schemaVersion: "1.0";
  readonly guidanceVersion: "2.1";
  readonly rendererVersion: "historical-2.1";
  readonly disposition: "replay_only";
  readonly baselineCommit: string;
  readonly fixtures: readonly {
    readonly profileId: AgentContextProfileId;
    readonly file: string;
    readonly sha256: string;
    readonly utf8Bytes: number;
    readonly knownDeviationCodes: readonly string[];
  }[];
  readonly knownDeviations: readonly {
    readonly code: string;
    readonly profiles: readonly AgentContextProfileId[];
    readonly classification: "historical_replay_only";
    readonly notANewRunContract: true;
  }[];
  readonly futureAssertions: readonly {
    readonly ownerTask: string;
    readonly assertion: string;
  }[];
}

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "agent-system-guidance-2.1"
);

describe("historical Agent guidance registry", () => {
  test("freezes the four 2.1 profile renderings byte-for-byte from the implementation baseline", async () => {
    const manifest = await readManifest();
    expect(manifest).toMatchObject({
      schemaVersion: "1.0",
      guidanceVersion: HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION,
      rendererVersion: HISTORICAL_AGENT_GUIDANCE_RENDERER_VERSION,
      disposition: "replay_only",
      baselineCommit: "5c234d4"
    });
    expect(manifest.fixtures.map(({ profileId }) => profileId)).toEqual([
      "standalone",
      "writing",
      "creative_general",
      "engineering"
    ]);

    const registrations = listHistoricalAgentGuidanceRegistrations();
    expect(Object.isFrozen(registrations)).toBe(true);
    expect(registrations.map(({ registryKey }) => registryKey)).toEqual([
      "standalone@2.1",
      "writing@2.1",
      "creative_general@2.1",
      "engineering@2.1"
    ]);

    for (const fixture of manifest.fixtures) {
      const bytes = await readFile(join(fixtureDirectory, fixture.file));
      const text = bytes.toString("utf8");
      const registration = getHistoricalAgentGuidanceRegistration(fixture.profileId, "2.1");
      expect(bytes.byteLength, fixture.file).toBe(fixture.utf8Bytes);
      expect(sha256(bytes), fixture.file).toBe(fixture.sha256);
      expect(text, fixture.file).toBe(registration.materialize());
      expect(text, fixture.file).toBe(materializeHistoricalAgentGuidance(fixture.profileId));
      expect(text, fixture.file).toBe(buildAgentSystemPrompt(fixture.profileId));
      expect(registration.templateChecksum, fixture.file).toBe(fixture.sha256);
      expect(registration.knownDeviationCodes).toEqual(fixture.knownDeviationCodes);
      expect(registration.disposition).toBe("replay_only");
    }
  });

  test("records known 2.1 defects only as replay compatibility", async () => {
    const manifest = await readManifest();
    expect(manifest.knownDeviations.map(({ code }) => code)).toEqual([
      "profile_only_capability_claims",
      "embedded_foreshadow_v1_contract",
      "paid_off_actual_payoff_required",
      "permanent_writing_style_pack"
    ]);
    expect(
      manifest.knownDeviations.every(
        ({ classification, notANewRunContract }) =>
          classification === "historical_replay_only" && notANewRunContract
      )
    ).toBe(true);
    expect(manifest.futureAssertions).toEqual([
      { ownerTask: "1.1", assertion: "new_runs_select_registered_guidance_3.0" },
      {
        ownerTask: "1.6",
        assertion: "guidance_3.0_omits_foreshadow_v1_and_uses_paid_off_v1.1_warning_semantics"
      }
    ]);
    expect(() => getHistoricalAgentGuidanceRegistration("writing", "3.0")).toThrow(
      "AGENT_GUIDANCE_REGISTRY_ENTRY_UNKNOWN"
    );
  });

  test("rejects unknown keys and every profile/version/body/checksum cross-invariant", () => {
    const registration = getHistoricalAgentGuidanceRegistration("writing", "2.1");
    const body = registration.materialize();
    const parsed = parseHistoricalAgentGuidanceRefId("system_guidance:writing@2.1");
    expect(parsed).toEqual({ registryKey: "writing@2.1", profileId: "writing", version: "2.1" });
    expect(
      verifyHistoricalAgentGuidance({
        ...parsed,
        templateChecksum: registration.templateChecksum,
        materializedGuidance: body
      })
    ).toBe(registration);

    const tampered = `${body}\nforged authority`;
    expect(() =>
      verifyHistoricalAgentGuidance({
        ...parsed,
        templateChecksum: sha256(Buffer.from(tampered, "utf8")),
        materializedGuidance: tampered
      })
    ).toThrow("AGENT_GUIDANCE_REGISTRY_AUTHORITY_INVALID");
    expect(() =>
      verifyHistoricalAgentGuidance({
        ...parsed,
        registryKey: "engineering@2.1",
        templateChecksum: registration.templateChecksum,
        materializedGuidance: body
      })
    ).toThrow("AGENT_GUIDANCE_REGISTRY_AUTHORITY_INVALID");
    expect(() => parseHistoricalAgentGuidanceRefId("system_guidance:writing@99.0")).toThrow(
      "AGENT_GUIDANCE_REGISTRY_ENTRY_UNKNOWN"
    );
    expect(() => parseHistoricalAgentGuidanceRefId("system_guidance:unknown@2.1")).toThrow(
      "AGENT_GUIDANCE_REGISTRY_ENTRY_UNKNOWN"
    );
  });
});

async function readManifest(): Promise<GuidanceFixtureManifest> {
  return JSON.parse(
    await readFile(join(fixtureDirectory, "manifest.json"), "utf8")
  ) as GuidanceFixtureManifest;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
