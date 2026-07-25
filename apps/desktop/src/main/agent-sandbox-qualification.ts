import { createHash } from "node:crypto";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  SANDBOX_PROTOCOL_VERSION,
  SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION,
  isSha256
} from "./agent-sandbox-runtime-manifest.js";

export type SandboxCapabilityStatus = "verified" | "unavailable";

export interface SandboxCapabilityEvidence {
  readonly fileIsolation: SandboxCapabilityStatus;
  readonly networkIsolation: SandboxCapabilityStatus;
  readonly jobObjectKillOnClose: SandboxCapabilityStatus;
  readonly appContainerOrLowBox: SandboxCapabilityStatus;
}

/** Evidence emitted by the independently packaged native probe. */
export interface SandboxQualificationEvidence {
  readonly schemaVersion: typeof SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION;
  readonly evidenceId: string;
  readonly hostDigest: string;
  readonly probeDigest: string;
  readonly osVersion: string;
  readonly protocolVersion: typeof SANDBOX_PROTOCOL_VERSION;
  readonly policyRevision: string;
  readonly testVectorRevision: string;
  readonly generatedAt: string;
  readonly capabilities: SandboxCapabilityEvidence;
}

export interface SandboxQualificationProbe {
  run(): Promise<Result<SandboxQualificationEvidence, UnifiedError>>;
}

export interface SandboxQualificationBinding {
  readonly hostDigest: string;
  readonly probeDigest: string;
  readonly protocolVersion: typeof SANDBOX_PROTOCOL_VERSION;
  readonly policyRevision: string;
  readonly testVectorRevision: string;
}

export interface AgentSandboxAttestation extends SandboxQualificationBinding {
  readonly attestationId: string;
  readonly osVersion: string;
  readonly evidenceId: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly capabilities: {
    readonly fileIsolation: "verified";
    readonly networkIsolation: "verified";
    readonly jobObjectKillOnClose: "verified";
    readonly appContainerOrLowBox: "verified";
  };
}

const ATTESTATION_LIFETIME_MS = 60 * 60 * 1000;
const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

/**
 * No direct, adapter-supplied boolean can qualify a sandbox. The default probe
 * intentionally returns unavailable; production composition must supply the
 * independently verified native probe plus its packaged binding.
 */
export async function runSandboxQualification(): Promise<
  Result<AgentSandboxAttestation, UnifiedError>
> {
  return new SandboxQualificationService().qualify();
}

export class SandboxQualificationService {
  private currentAttestation: AgentSandboxAttestation | undefined;
  private readonly probe: SandboxQualificationProbe | undefined;
  private readonly binding: SandboxQualificationBinding | undefined;
  private readonly clock: () => number;

  constructor(
    options: {
      readonly probe?: SandboxQualificationProbe;
      readonly binding?: SandboxQualificationBinding;
      readonly clock?: () => number;
    } = {}
  ) {
    this.probe = options.probe;
    this.binding = options.binding;
    this.clock = options.clock ?? Date.now;
  }

  /**
   * An attestation is issued only after a native probe returns complete evidence
   * that is cryptographically bound to the current packaged runtime revisions.
   */
  async qualify(): Promise<Result<AgentSandboxAttestation, UnifiedError>> {
    if (process.platform !== "win32" || process.arch !== "x64") {
      return err(
        unavailableError(
          "AGENT_SANDBOX_NOT_SUPPORTED",
          "Sandbox requires Windows x64 with AppContainer support."
        )
      );
    }
    if (this.probe === undefined || this.binding === undefined) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Sandbox qualification requires a verified packaged native host and probe."
        )
      );
    }
    if (!isValidBinding(this.binding)) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Sandbox qualification binding is missing a valid package digest or revision."
        )
      );
    }

    const probeResult = await this.probe.run();
    if (!probeResult.ok) return probeResult;
    const evidence = probeResult.value;
    if (
      parseSandboxQualificationEvidence(evidence) === undefined ||
      !isFreshEvidence(evidence.generatedAt, this.clock())
    ) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Sandbox probe evidence is malformed, stale, or from an invalid clock epoch."
        )
      );
    }
    if (!matchesBinding(evidence, this.binding)) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Sandbox probe evidence does not match the packaged host/probe binding."
        )
      );
    }
    if (!hasEveryVerifiedCapability(evidence.capabilities)) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Sandbox probe did not verify every required isolation capability."
        )
      );
    }

    const now = this.clock();
    const generatedAt = new Date(now).toISOString();
    const attestation: AgentSandboxAttestation = {
      attestationId: makeAttestationId(),
      hostDigest: evidence.hostDigest,
      probeDigest: evidence.probeDigest,
      osVersion: evidence.osVersion,
      protocolVersion: evidence.protocolVersion,
      policyRevision: evidence.policyRevision,
      testVectorRevision: evidence.testVectorRevision,
      evidenceId: evidence.evidenceId,
      generatedAt,
      expiresAt: new Date(now + ATTESTATION_LIFETIME_MS).toISOString(),
      capabilities: {
        fileIsolation: "verified",
        networkIsolation: "verified",
        jobObjectKillOnClose: "verified",
        appContainerOrLowBox: "verified"
      }
    };
    this.currentAttestation = attestation;
    return ok(attestation);
  }

  getAttestation(): AgentSandboxAttestation | undefined {
    if (this.currentAttestation === undefined) return undefined;
    if (new Date(this.currentAttestation.expiresAt).getTime() <= this.clock()) {
      this.currentAttestation = undefined;
      return undefined;
    }
    return this.currentAttestation;
  }

  getAttestationById(attestationId: string): AgentSandboxAttestation | undefined {
    const attestation = this.getAttestation();
    return attestation?.attestationId === attestationId ? attestation : undefined;
  }

  isAttestationValid(attestationId: string): boolean {
    return this.getAttestationById(attestationId) !== undefined;
  }

  requiresRequalification(_reason: string): void {
    void _reason;
    this.currentAttestation = undefined;
  }
}

export function parseSandboxQualificationEvidence(
  value: unknown
): SandboxQualificationEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const expectedKeys = new Set([
    "schemaVersion",
    "evidenceId",
    "hostDigest",
    "probeDigest",
    "osVersion",
    "protocolVersion",
    "policyRevision",
    "testVectorRevision",
    "generatedAt",
    "capabilities"
  ]);
  if (Object.keys(value).some((key) => !expectedKeys.has(key))) return undefined;
  if (Object.keys(value).length !== expectedKeys.size) return undefined;
  if (
    value.schemaVersion !== SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION ||
    value.protocolVersion !== SANDBOX_PROTOCOL_VERSION ||
    !isNonEmptyString(value.evidenceId) ||
    !isSha256(value.hostDigest) ||
    !isSha256(value.probeDigest) ||
    !isNonEmptyString(value.osVersion) ||
    !isNonEmptyString(value.policyRevision) ||
    !isNonEmptyString(value.testVectorRevision) ||
    !isValidIsoTimestamp(value.generatedAt) ||
    !isRecord(value.capabilities) ||
    !isCapabilityStatus(value.capabilities.fileIsolation) ||
    !isCapabilityStatus(value.capabilities.networkIsolation) ||
    !isCapabilityStatus(value.capabilities.jobObjectKillOnClose) ||
    !isCapabilityStatus(value.capabilities.appContainerOrLowBox)
  ) {
    return undefined;
  }
  const expectedCapabilityKeys = new Set([
    "fileIsolation",
    "networkIsolation",
    "jobObjectKillOnClose",
    "appContainerOrLowBox"
  ]);
  if (
    Object.keys(value.capabilities).length !== expectedCapabilityKeys.size ||
    Object.keys(value.capabilities).some((key) => !expectedCapabilityKeys.has(key))
  ) {
    return undefined;
  }

  return {
    schemaVersion: SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION,
    evidenceId: value.evidenceId,
    hostDigest: value.hostDigest,
    probeDigest: value.probeDigest,
    osVersion: value.osVersion,
    protocolVersion: SANDBOX_PROTOCOL_VERSION,
    policyRevision: value.policyRevision,
    testVectorRevision: value.testVectorRevision,
    generatedAt: value.generatedAt,
    capabilities: {
      fileIsolation: value.capabilities.fileIsolation,
      networkIsolation: value.capabilities.networkIsolation,
      jobObjectKillOnClose: value.capabilities.jobObjectKillOnClose,
      appContainerOrLowBox: value.capabilities.appContainerOrLowBox
    }
  };
}

function isValidBinding(binding: SandboxQualificationBinding): boolean {
  return (
    isSha256(binding.hostDigest) &&
    isSha256(binding.probeDigest) &&
    binding.protocolVersion === SANDBOX_PROTOCOL_VERSION &&
    isNonEmptyString(binding.policyRevision) &&
    isNonEmptyString(binding.testVectorRevision)
  );
}

function matchesBinding(
  evidence: SandboxQualificationEvidence,
  binding: SandboxQualificationBinding
): boolean {
  return (
    evidence.hostDigest === binding.hostDigest &&
    evidence.probeDigest === binding.probeDigest &&
    evidence.protocolVersion === binding.protocolVersion &&
    evidence.policyRevision === binding.policyRevision &&
    evidence.testVectorRevision === binding.testVectorRevision
  );
}

function hasEveryVerifiedCapability(capabilities: SandboxCapabilityEvidence): boolean {
  return (
    capabilities.fileIsolation === "verified" &&
    capabilities.networkIsolation === "verified" &&
    capabilities.jobObjectKillOnClose === "verified" &&
    capabilities.appContainerOrLowBox === "verified"
  );
}

function makeAttestationId(): string {
  return `attest_${createHash("sha256")
    .update(`${Date.now()}${Math.random()}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256
  );
}

function isCapabilityStatus(value: unknown): value is SandboxCapabilityStatus {
  return value === "verified" || value === "unavailable";
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isFreshEvidence(generatedAt: string, now: number): boolean {
  const generatedAtMs = Date.parse(generatedAt);
  return (
    Number.isFinite(generatedAtMs) &&
    generatedAtMs <= now + MAX_CLOCK_SKEW_MS &&
    generatedAtMs >= now - MAX_EVIDENCE_AGE_MS
  );
}

function unavailableError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Install a production-qualified Windows sandbox bundle and re-run sandbox qualification.",
    traceId: "agent-sandbox-qualification"
  });
}
