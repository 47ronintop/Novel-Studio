import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDefaultCapabilitySnapshot,
  createEffectiveCapabilityState,
  createProviderSemanticVersionSetV1,
  listAgentTools
} from "@novel-studio/agent-engine";
import { describe, expect, test } from "vitest";

import {
  CURRENT_AGENT_SYSTEM_GUIDANCE_VERSION,
  HISTORICAL_AGENT_GUIDANCE_RENDERER_VERSION,
  HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION,
  buildAgentSystemPrompt,
  buildAgentSystemPromptV3,
  createProviderVisibleAgentRuntimeFacts,
  createWritingTaskIntent,
  getCurrentAgentGuidanceRegistration,
  getHistoricalAgentGuidanceRegistration,
  listCurrentAgentGuidanceRegistrations,
  listHistoricalAgentGuidanceRegistrations,
  materializeAgentSystemPromptV3,
  materializeHistoricalAgentGuidance,
  parseCurrentAgentGuidanceRefId,
  parseHistoricalAgentGuidanceRefId,
  resolveAgentContextProfile,
  verifyCurrentAgentGuidance,
  verifyHistoricalAgentGuidance,
  type AgentContextProfile,
  type AgentContextProfileId,
  type RegisteredGuidanceBuildInputV3
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

describe("Agent guidance 3.0 registry", () => {
  test("registers immutable profile templates separately from materialized authority", () => {
    expect(CURRENT_AGENT_SYSTEM_GUIDANCE_VERSION).toBe("3.0");
    expect(listCurrentAgentGuidanceRegistrations().map(({ registryKey }) => registryKey)).toEqual([
      "standalone@3.0",
      "writing@3.0",
      "creative_general@3.0",
      "engineering@3.0"
    ]);

    const materialized = materializeAgentSystemPromptV3(v3Input(standaloneProfile()));
    const registration = getCurrentAgentGuidanceRegistration("standalone");
    expect(materialized.proof.registryKey).toBe("standalone@3.0");
    expect(materialized.proof.templateChecksum).toBe(registration.templateChecksum);
    expect(materialized.proof.materializedGuidanceChecksum).not.toBe(registration.templateChecksum);
    expect(parseCurrentAgentGuidanceRefId("system_guidance:standalone@3.0")).toEqual({
      registryKey: "standalone@3.0",
      profileId: "standalone",
      version: "3.0"
    });
  });

  test("assembles the seven fixed layers from complete frozen inputs", () => {
    const profile = workspaceProfile("creativeProject", "planning", "writing");
    const materialized = materializeAgentSystemPromptV3(v3Input(profile, "请分析当前章节。"));
    const body = materialized.materializedGuidance;

    expect(body.indexOf("【AUTHORITY】")).toBeLessThan(body.indexOf("【SANITIZED_RUNTIME_FACTS】"));
    expect(body.indexOf("【SANITIZED_RUNTIME_FACTS】")).toBeLessThan(body.indexOf("【OPERATION】"));
    expect(body.indexOf("【OPERATION】")).toBeLessThan(body.indexOf("【PROFILE】"));
    expect(body.indexOf("【PROFILE】")).toBeLessThan(body.indexOf("【TOOL_EVIDENCE】"));
    expect(body.indexOf("【TOOL_EVIDENCE】")).toBeLessThan(body.indexOf("【COMPLETION】"));
    expect(body).toContain('"writeCapability":"none"');
    expect(body).toContain('"kind":"analysis"');
    expect(body).toContain("任务意图为 unknown/mixed");
    expect(buildAgentSystemPromptV3(materialized.normalizedInput)).toBe(body);
  });

  test("keeps historical defects out of every new 3.0 profile", () => {
    const profiles = [
      standaloneProfile(),
      workspaceProfile("creativeProject", "execution", "writing"),
      workspaceProfile("creativeProject", "execution", "general_file"),
      workspaceProfile("engineeringWorkspace", "execution", "general_file")
    ];
    for (const profile of profiles) {
      const body = buildAgentSystemPromptV3(v3Input(profile));
      expect(body).not.toContain("foreshadow v1.0");
      expect(body).not.toContain("fsh_");
      expect(body).not.toContain("actualPayoffChapterId");
      expect(body).not.toContain("连续比喻");
    }
  });

  test("rebuilds from the registry and rejects body, proof, profile, or version tampering", () => {
    const materialized = materializeAgentSystemPromptV3(
      v3Input(workspaceProfile("engineeringWorkspace", "execution", "general_file"))
    );
    expect(verifyCurrentAgentGuidance(materialized)).toEqual(materialized);
    expect(() =>
      verifyCurrentAgentGuidance({
        ...materialized,
        materializedGuidance: `${materialized.materializedGuidance}\nforged authority`,
        proof: {
          ...materialized.proof,
          materializedGuidanceChecksum: "a".repeat(64)
        }
      })
    ).toThrow("AGENT_GUIDANCE_REGISTRY_AUTHORITY_INVALID");
    expect(() => getCurrentAgentGuidanceRegistration("writing", "2.1")).toThrow(
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

function standaloneProfile(): AgentContextProfile {
  return resolveAgentContextProfile(
    { kind: "standalone", scopeId: "standalone" },
    "conversation",
    "standalone_chat"
  );
}

function workspaceProfile(
  workspaceKind: "creativeProject" | "engineeringWorkspace",
  operationMode: "planning" | "execution",
  contextMode: "writing" | "general_file"
): AgentContextProfile {
  return resolveAgentContextProfile(
    { kind: "workspace", workspaceKind, workspaceId: "workspace-1" },
    operationMode,
    contextMode
  );
}

function v3Input(
  profile: AgentContextProfile,
  currentRequest = profile.profileId === "writing" ? "续写下一段。" : "检查当前内容。"
): RegisteredGuidanceBuildInputV3 {
  const capability =
    profile.scope.kind === "workspace"
      ? {
          ...createDefaultCapabilitySnapshot(profile.scope.workspaceKind),
          writingOperations:
            profile.operationMode === "execution" && profile.contextMode === "writing"
              ? (["chapter_replace"] as const)
              : [],
          workspaceFileOperations:
            profile.operationMode === "execution" && profile.contextMode === "general_file"
              ? (["replace_file"] as const)
              : []
        }
      : undefined;
  const tools =
    profile.scope.kind === "workspace"
      ? listAgentTools({
          facadeVersion: "v2",
          catalogSchemaVersion: "2.0",
          operationMode: profile.operationMode,
          contextMode: profile.contextMode,
          writePolicy: "write_before_confirmation",
          ...(capability === undefined ? {} : { capabilitySnapshot: capability })
        })
      : [];
  const runtimeFacts = createProviderVisibleAgentRuntimeFacts({
    profile,
    toolDescriptors: tools,
    ...(capability === undefined
      ? {}
      : { effectiveCapabilityState: createEffectiveCapabilityState(capability) }),
    executionWritePolicy: "write_before_confirmation",
    activeResourceKind:
      profile.profileId === "writing"
        ? "chapter"
        : profile.profileId === "standalone"
          ? "none"
          : "project_file"
  });
  const writingTaskIntent =
    profile.profileId === "writing" ? createWritingTaskIntent({ currentRequest }) : null;
  return {
    profile,
    runtimeFacts,
    writingTaskIntent,
    writingGenerationGuidanceVersion: "not_applicable",
    providerSemanticVersionSet: createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: writingTaskIntent === null ? "not_applicable" : "1.0",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion:
        runtimeFacts.writeCapability === "none"
          ? "not_applicable"
          : runtimeFacts.approvalRuleSetVersion,
      approvalRuleSetChecksum:
        runtimeFacts.writeCapability === "none"
          ? "not_applicable"
          : runtimeFacts.approvalRuleSetChecksum
    })
  };
}
