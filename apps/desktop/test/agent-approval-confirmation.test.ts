import { describe, expect, test, vi } from "vitest";

import { createApprovalBindingV2 } from "@novel-studio/agent-engine";
import { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { ok } from "@novel-studio/shared";

import {
  MainApprovalConfirmationCoordinator,
  TRUSTED_APPROVAL_DISPLAY_LIMITS,
  TRUSTED_APPROVAL_IPC_CHANNELS,
  createTrustedApprovalSafeDisplayDto,
  registerTrustedApprovalIpc,
  type MainOnlyHumanIntentEvidenceV1,
  type TrustedApprovalSurfaceQualificationV1
} from "../src/main/agent-approval-confirmation.js";

const now = "2099-01-01T00:00:10.000Z";
const checksum = "a".repeat(64);

function safeDisplay(
  overrides: {
    readonly workspaceLabel?: string;
    readonly canonicalDiff?: string;
    readonly recoverySideEffect?: string;
    readonly operationCount?: number;
  } = {}
) {
  const count = overrides.operationCount ?? 1;
  const result = createTrustedApprovalSafeDisplayDto({
    schemaVersion: "1.0",
    workspaceLabel: overrides.workspaceLabel ?? "示例小说",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    selectedOperations: Array.from({ length: count }, (_, index) => ({
      operationId: index === 0 ? "notes/one.md" : `notes/operation_${index}.md`,
      operationKind: "replace_file",
      paths: [
        { role: "source" as const, path: index === 0 ? "notes/one.md" : `notes/${index}.md` },
        { role: "target" as const, path: index === 0 ? "notes/one.md" : `notes/${index}.md` }
      ],
      summary: `更新文件 ${index + 1}`
    })),
    canonicalDiff: overrides.canonicalDiff ?? "--- notes/one.md\n+++ notes/one.md\n-old\n+new",
    recoverySideEffect: overrides.recoverySideEffect ?? "not_applicable"
  });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const displayChecksum = safeDisplay().displayChecksum;

function binding() {
  return createApprovalBindingV2({
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: checksum,
    providerSemanticVersionSetChecksum: checksum,
    operationKind: "replace_file",
    selectionChecksum: checksum,
    selectedOperationIds: ["notes/one.md"],
    operationOrderChecksum: checksum,
    sourceRef: "file:notes/one.md",
    targetRef: "file:notes/one.md",
    baseChecksum: checksum,
    candidateChecksum: "b".repeat(64),
    baseManifestChecksum: checksum,
    candidateManifestChecksum: "b".repeat(64),
    encoding: "utf-8",
    bom: "absent",
    eol: "lf",
    approvalRuleSetVersion: "rules-2.0",
    approvalRuleSetChecksum: checksum,
    proofId: "proof_01",
    proofChecksum: checksum,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    approvalSource: "human_confirmation",
    issuedAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
}

function coordinator(nativeConfirm = vi.fn(async () => true)) {
  return {
    nativeConfirm,
    coordinator: new MainApprovalConfirmationCoordinator({
      authorizationLedger: new ApprovalAuthorizationLedger({ now: () => now }),
      nativeConfirm,
      now: () => now,
      createId: (() => {
        let id = 0;
        return () => `id_${++id}`;
      })()
    })
  };
}

function qualifiedCoordinator(
  options: {
    readonly nativeConfirm?: (preview: {
      readonly previewId: string;
      readonly action: "plan_to_act" | "change_set";
      readonly displayChecksum: string;
      readonly expiresAt: string;
    }) => Promise<boolean>;
    readonly now?: () => string;
    readonly qualification?: () => TrustedApprovalSurfaceQualificationV1 | undefined;
  } = {}
) {
  const evidence: MainOnlyHumanIntentEvidenceV1[] = [];
  const revokedEvidence: Array<{ readonly evidenceId: string; readonly reason: string }> = [];
  const ledger = new ApprovalAuthorizationLedger({ now: options.now ?? (() => now) });
  const nativeConfirm = vi.fn(options.nativeConfirm ?? (async () => true));
  const qualification: TrustedApprovalSurfaceQualificationV1 = {
    schemaVersion: "1.0",
    status: "qualified",
    bundleDigest: checksum,
    qualificationRevision: "approval-ui-r1",
    sourceRevision: "1".repeat(40),
    approvalArtifactManifestChecksum: "2".repeat(64),
    qualificationMatrixRevision: "adr-0004-qualification-r1",
    qualificationMatrixChecksum: "3".repeat(64),
    automatedReportChecksum: "4".repeat(64),
    ownerApprovalId: "owner-approval-1",
    ownerKeyId: "owner-key-1",
    issuedAt: "2098-12-01T00:00:00.000Z",
    expiresAt: "2099-02-01T00:00:00.000Z",
    attestationChecksum: "5".repeat(64)
  };
  const subject = new MainApprovalConfirmationCoordinator({
    authorizationLedger: ledger,
    nativeConfirm,
    getSurfaceQualification: options.qualification ?? (() => qualification),
    humanIntentEvidenceJournal: {
      async issue(value) {
        evidence.push(value);
        return ok(undefined);
      },
      async revoke(evidenceId, reason) {
        revokedEvidence.push({ evidenceId, reason });
        return ok(undefined);
      }
    },
    now: options.now ?? (() => now),
    createId: (() => {
      let id = 0;
      return () => `id_${++id}`;
    })()
  });
  return { subject, nativeConfirm, ledger, evidence, revokedEvidence };
}

function prepare(coordinator: MainApprovalConfirmationCoordinator) {
  const display = safeDisplay();
  return coordinator.prepare({
    parentWebContentsId: 10,
    action: "plan_to_act",
    displayChecksum: display.displayChecksum,
    display,
    canonicalChecksum: checksum,
    binding: binding(),
    bundleDigest: checksum,
    qualificationRevision: "approval-ui-r1",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
}

describe("ADR-0004 Main approval confirmation", () => {
  test("keeps every production confirmation entrypoint unavailable before qualification", async () => {
    const { coordinator: subject, nativeConfirm } = coordinator();
    expect(prepare(subject)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(subject.openFromRenderer(10, "preview_forged", 22)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(subject.readFromModal(22, "preview_forged")).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: "preview_forged",
        modalInstanceId: "modal_forged",
        nonce: "nonce_forged",
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test("does not let caller-supplied bundle or qualification claims enable the surface", async () => {
    const nativeConfirm = vi.fn(async () => true);
    const { coordinator: subject } = coordinator(nativeConfirm);
    const forged = {
      parentWebContentsId: 10,
      action: "plan_to_act" as const,
      displayChecksum,
      display: safeDisplay(),
      canonicalChecksum: checksum,
      binding: binding(),
      bundleDigest: "f".repeat(64),
      qualificationRevision: "caller-claims-qualified-r999",
      expiresAt: "2099-01-01T01:00:00.000Z"
    };
    expect(subject.prepare(forged)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: "approval_claimed",
        modalInstanceId: "modal_claimed",
        nonce: "nonce_claimed",
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test("issues one Main-only authorization after isolated modal and native confirmation", async () => {
    const { subject, nativeConfirm, ledger, evidence } = qualifiedCoordinator();
    const prepared = prepare(subject);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        previewId: "preview_id_1",
        displayChecksum,
        attestationChecksum: "5".repeat(64)
      }
    });
    if (!prepared.ok) return;
    const waiting = subject.waitForDecision(prepared.value.previewId);
    const concurrentWaiting = subject.waitForDecision(prepared.value.previewId);

    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    expect(displayed).toMatchObject({
      ok: true,
      value: {
        previewId: "preview_id_1",
        modalInstanceId: "modal_id_2",
        nonce: expect.any(String)
      }
    });
    if (!displayed.ok) return;
    expect(displayed.value.display).toEqual(safeDisplay());
    expect(subject.readFromModal(22, prepared.value.previewId)).toEqual(displayed);

    const issued = await subject.decideFromModal(22, {
      previewId: prepared.value.previewId,
      modalInstanceId: displayed.value.modalInstanceId,
      nonce: displayed.value.nonce,
      decision: "approve"
    });
    expect(issued).toMatchObject({
      ok: true,
      value: {
        authorizationId: "auth_id_4",
        humanIntentEvidenceId: "intent_id_5",
        displayChecksum
      }
    });
    expect(nativeConfirm).toHaveBeenCalledOnce();
    expect(nativeConfirm).toHaveBeenCalledWith(prepared.value);
    expect(evidence).toEqual([
      expect.objectContaining({
        schemaVersion: "1.0",
        source: "main_owned_isolated_modal_v1",
        authorizationId: "auth_id_4",
        evidenceId: "intent_id_5",
        parentWebContentsId: 10,
        modalWebContentsId: 22,
        modalInstanceId: "modal_id_2",
        displayChecksum,
        canonicalChecksum: checksum,
        bundleDigest: checksum,
        qualificationRevision: "approval-ui-r1",
        sourceRevision: "1".repeat(40),
        approvalArtifactManifestChecksum: "2".repeat(64),
        qualificationMatrixRevision: "adr-0004-qualification-r1",
        qualificationMatrixChecksum: "3".repeat(64),
        automatedReportChecksum: "4".repeat(64),
        ownerApprovalId: "owner-approval-1",
        ownerKeyId: "owner-key-1",
        issuedAt: "2098-12-01T00:00:00.000Z",
        qualificationExpiresAt: "2099-02-01T00:00:00.000Z",
        attestationChecksum: "5".repeat(64),
        selectedOperationIds: ["notes/one.md"]
      })
    ]);
    await expect(ledger.query("auth_id_4")).resolves.toMatchObject({
      ok: true,
      value: { state: "issued", binding: { runId: "run_01" } }
    });
    await expect(waiting).resolves.toMatchObject({
      ok: true,
      value: { status: "issued", issued: { authorizationId: "auth_id_4" } }
    });
    await expect(concurrentWaiting).resolves.toMatchObject({
      ok: true,
      value: { status: "issued", issued: { authorizationId: "auth_id_4" } }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: prepared.value.previewId,
        modalInstanceId: displayed.value.modalInstanceId,
        nonce: displayed.value.nonce,
        decision: "approve"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "TRUSTED_APPROVAL_REPLAY_REJECTED" } });
    expect(nativeConfirm).toHaveBeenCalledOnce();
  });

  test("revokes a guessed preview used by the wrong ordinary renderer", () => {
    const { subject, nativeConfirm } = qualifiedCoordinator();
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    expect(subject.openFromRenderer(11, prepared.value.previewId, 22)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_RENDERER_MISMATCH" }
    });
    expect(subject.openFromRenderer(10, prepared.value.previewId, 22)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_REPLAY_REJECTED" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test.each([
    { sender: 23, modal: "modal_id_2", nonce: "valid", label: "wrong sender" },
    { sender: 22, modal: "modal_forged", nonce: "valid", label: "wrong modal instance" },
    { sender: 22, modal: "modal_id_2", nonce: "forged", label: "wrong nonce" }
  ])("rejects and revokes a $label decision", async ({ sender, modal, nonce }) => {
    const { subject, nativeConfirm, evidence } = qualifiedCoordinator();
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;
    const result = await subject.decideFromModal(sender, {
      previewId: prepared.value.previewId,
      modalInstanceId: modal,
      nonce: nonce === "valid" ? displayed.value.nonce : nonce,
      decision: "approve"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_DECISION_MISMATCH" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(evidence).toEqual([]);
    expect(subject.readFromModal(22, prepared.value.previewId)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_REPLAY_REJECTED" }
    });
  });

  test.each(["reject", "cancel"] as const)(
    "%s produces no evidence or authorization",
    async (decision) => {
      const { subject, nativeConfirm, evidence, ledger } = qualifiedCoordinator();
      const prepared = prepare(subject);
      if (!prepared.ok) return;
      const waiting = subject.waitForDecision(prepared.value.previewId);
      const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
      if (!displayed.ok) return;
      await expect(
        subject.decideFromModal(22, {
          previewId: prepared.value.previewId,
          modalInstanceId: displayed.value.modalInstanceId,
          nonce: displayed.value.nonce,
          decision
        })
      ).resolves.toEqual({ ok: true, value: undefined });
      expect(nativeConfirm).not.toHaveBeenCalled();
      expect(evidence).toEqual([]);
      await expect(waiting).resolves.toEqual({
        ok: true,
        value: { status: "dismissed", reason: decision }
      });
      await expect(ledger.query("auth_id_4")).resolves.toMatchObject({
        ok: false,
        error: { code: "AUTHORIZATION_LEDGER_NOT_FOUND" }
      });
    }
  );

  test("fails closed when qualification drifts after display", async () => {
    let qualification: TrustedApprovalSurfaceQualificationV1 | undefined = {
      schemaVersion: "1.0",
      status: "qualified",
      bundleDigest: checksum,
      qualificationRevision: "approval-ui-r1",
      sourceRevision: "1".repeat(40),
      approvalArtifactManifestChecksum: "2".repeat(64),
      qualificationMatrixRevision: "adr-0004-qualification-r1",
      qualificationMatrixChecksum: "3".repeat(64),
      automatedReportChecksum: "4".repeat(64),
      ownerApprovalId: "owner-approval-1",
      ownerKeyId: "owner-key-1",
      issuedAt: "2098-12-01T00:00:00.000Z",
      expiresAt: "2099-02-01T00:00:00.000Z",
      attestationChecksum: "5".repeat(64)
    };
    const { subject, nativeConfirm, evidence } = qualifiedCoordinator({
      qualification: () => qualification
    });
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;
    qualification = { ...qualification, attestationChecksum: "b".repeat(64) };
    await expect(
      subject.decideFromModal(22, {
        previewId: prepared.value.previewId,
        modalInstanceId: displayed.value.modalInstanceId,
        nonce: displayed.value.nonce,
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_CHANGED" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(evidence).toEqual([]);
  });

  test("rejects new previews and revokes a displayed preview after the qualification expires", async () => {
    let clock = "2099-01-01T00:00:10.000Z";
    const qualification: TrustedApprovalSurfaceQualificationV1 = {
      schemaVersion: "1.0",
      status: "qualified",
      bundleDigest: checksum,
      qualificationRevision: "approval-ui-r1",
      sourceRevision: "1".repeat(40),
      approvalArtifactManifestChecksum: "2".repeat(64),
      qualificationMatrixRevision: "adr-0004-qualification-r1",
      qualificationMatrixChecksum: "3".repeat(64),
      automatedReportChecksum: "4".repeat(64),
      ownerApprovalId: "owner-approval-1",
      ownerKeyId: "owner-key-1",
      issuedAt: "2098-12-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:11.000Z",
      attestationChecksum: "5".repeat(64)
    };
    const { subject, nativeConfirm, evidence } = qualifiedCoordinator({
      now: () => clock,
      qualification: () => qualification
    });
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;

    clock = "2099-01-01T00:00:11.000Z";
    expect(prepare(subject)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: prepared.value.previewId,
        modalInstanceId: displayed.value.modalInstanceId,
        nonce: displayed.value.nonce,
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_CHANGED" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(evidence).toEqual([]);
  });

  test("expires a displayed preview without calling native confirmation", async () => {
    let clock = now;
    const { subject, nativeConfirm } = qualifiedCoordinator({ now: () => clock });
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;
    clock = "2099-01-01T01:00:00.000Z";
    await expect(
      subject.decideFromModal(22, {
        previewId: prepared.value.previewId,
        modalInstanceId: displayed.value.modalInstanceId,
        nonce: displayed.value.nonce,
        decision: "approve"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "TRUSTED_APPROVAL_EXPIRED" } });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test("a modal crash during native confirmation revokes before ledger issuance", async () => {
    let resolveNative: ((value: boolean) => void) | undefined;
    const native = () =>
      new Promise<boolean>((resolve) => {
        resolveNative = resolve;
      });
    const { subject, ledger, evidence, revokedEvidence } = qualifiedCoordinator({
      nativeConfirm: native
    });
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const waiting = subject.waitForDecision(prepared.value.previewId);
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;
    const pending = subject.decideFromModal(22, {
      previewId: prepared.value.previewId,
      modalInstanceId: displayed.value.modalInstanceId,
      nonce: displayed.value.nonce,
      decision: "approve"
    });
    subject.revoke(prepared.value.previewId, "modal_crashed");
    resolveNative?.(true);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_REVOKED" }
    });
    await expect(waiting).resolves.toEqual({
      ok: true,
      value: { status: "revoked", reason: "modal_crashed" }
    });
    expect(evidence).toEqual([]);
    expect(revokedEvidence).toEqual([]);
    await expect(ledger.query("auth_id_4")).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTHORIZATION_LEDGER_NOT_FOUND" }
    });
  });

  test("isolated IPC rejects extra decision fields and never returns Main-only capability data", async () => {
    const { subject } = qualifiedCoordinator();
    const prepared = prepare(subject);
    if (!prepared.ok) return;
    const displayed = subject.openFromRenderer(10, prepared.value.previewId, 22);
    if (!displayed.ok) return;
    const handlers = new Map<
      string,
      (event: { sender: { id: number } }, ...args: unknown[]) => unknown
    >();
    registerTrustedApprovalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      subject
    );
    const decide = handlers.get(TRUSTED_APPROVAL_IPC_CHANNELS.decide);
    expect(decide).toBeDefined();
    const invalid = await decide?.(
      { sender: { id: 22 } },
      { ...displayed.value, decision: "approve", binding: binding() }
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: "TRUSTED_APPROVAL_IPC_INVALID" } });
    const result = await decide?.(
      { sender: { id: 22 } },
      {
        previewId: displayed.value.previewId,
        modalInstanceId: displayed.value.modalInstanceId,
        nonce: displayed.value.nonce,
        decision: "approve"
      }
    );
    expect(result).toEqual({ ok: true, value: { status: "approved" } });
    expect(JSON.stringify(result)).not.toContain("capability");
    expect(JSON.stringify(result)).not.toContain("auth_id");
  });

  test("normalizes and visibly escapes canonical display content without truncating it", () => {
    const result = createTrustedApprovalSafeDisplayDto({
      schemaVersion: "1.0",
      workspaceLabel: "<项目>\u202E\u0000\\u202E",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      selectedOperations: [
        {
          operationId: "notes/one.md",
          operationKind: "replace_file",
          paths: [{ role: "target", path: "notes/\u200Bone<&>.md" }],
          summary: "**更新**\u2066文件"
        }
      ],
      canonicalDiff: "<script>alert(1)</script>\r\n-old\u200B\n+new",
      recoverySideEffect: "不可恢复\u00A0副作用"
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        workspaceLabel: "\\u{003C}项目\\u{003E}\\u{202E}\\u{0000}\\u202E",
        selectedOperations: [
          {
            paths: [{ path: "notes/\\u{200B}one\\u{003C}\\u{0026}\\u{003E}.md" }],
            summary: "**更新**\\u{2066}文件"
          }
        ],
        canonicalDiff:
          "\\u{003C}script\\u{003E}alert(1)\\u{003C}/script\\u{003E}\n-old\\u{200B}\n+new",
        recoverySideEffect: "不可恢复\\u{00A0}副作用",
        displayChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    if (!result.ok) return;
    expect(result.value.canonicalDiff.split("\n")).toHaveLength(3);
    expect(JSON.stringify(result.value)).not.toContain("<script>");
    expect(JSON.stringify(result.value)).not.toContain("\u202E");
    const { subject } = qualifiedCoordinator();
    const prepared = subject.prepare({
      parentWebContentsId: 10,
      action: "change_set",
      displayChecksum: result.value.displayChecksum,
      display: result.value,
      canonicalChecksum: checksum,
      binding: binding(),
      bundleDigest: checksum,
      qualificationRevision: "approval-ui-r1",
      expiresAt: "2099-01-01T01:00:00.000Z"
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(subject.openFromRenderer(10, prepared.value.previewId, 22)).toMatchObject({
      ok: true,
      value: { display: result.value }
    });
  });

  test("fails closed instead of truncating oversized operations, paths, or canonical diff", () => {
    const content = {
      schemaVersion: "1.0" as const,
      workspaceLabel: "示例小说",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      selectedOperations: [
        {
          operationId: "notes/one.md",
          operationKind: "replace_file",
          paths: [{ role: "target" as const, path: "notes/one.md" }],
          summary: "更新文件"
        }
      ],
      canonicalDiff: "full diff",
      recoverySideEffect: "not_applicable"
    };
    expect(
      createTrustedApprovalSafeDisplayDto({
        ...content,
        canonicalDiff: "x".repeat(TRUSTED_APPROVAL_DISPLAY_LIMITS.canonicalDiffUtf8Bytes + 1)
      })
    ).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_DISPLAY_LIMIT_EXCEEDED" }
    });
    expect(
      createTrustedApprovalSafeDisplayDto({
        ...content,
        selectedOperations: [
          {
            operationId: "notes/one.md",
            operationKind: "replace_file",
            summary: "更新文件",
            paths: [
              {
                role: "target" as const,
                path: "x".repeat(TRUSTED_APPROVAL_DISPLAY_LIMITS.pathUtf8Bytes + 1)
              }
            ]
          }
        ]
      })
    ).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_DISPLAY_LIMIT_EXCEEDED" }
    });
    expect(
      createTrustedApprovalSafeDisplayDto({
        ...content,
        selectedOperations: Array.from(
          { length: TRUSTED_APPROVAL_DISPLAY_LIMITS.operationCount + 1 },
          (_, index) => ({
            operationId: `operation_${index}`,
            operationKind: "replace_file",
            paths: [],
            summary: "update"
          })
        )
      })
    ).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_DISPLAY_LIMIT_EXCEEDED" }
    });
  });

  test("rejects display checksum tampering and selected-operation omissions", () => {
    const { subject } = qualifiedCoordinator();
    const display = safeDisplay();
    expect(
      subject.prepare({
        parentWebContentsId: 10,
        action: "change_set",
        displayChecksum: display.displayChecksum,
        display: { ...display, canonicalDiff: `${display.canonicalDiff}\nforged` },
        canonicalChecksum: checksum,
        binding: binding(),
        bundleDigest: checksum,
        qualificationRevision: "approval-ui-r1",
        expiresAt: "2099-01-01T01:00:00.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "TRUSTED_APPROVAL_DISPLAY_INVALID" } });

    const omitted = createTrustedApprovalSafeDisplayDto({
      schemaVersion: "1.0",
      workspaceLabel: "示例小说",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      selectedOperations: [
        {
          operationId: "different_operation",
          operationKind: "replace_file",
          paths: [],
          summary: "wrong selection"
        }
      ],
      canonicalDiff: "full diff",
      recoverySideEffect: "not_applicable"
    });
    if (!omitted.ok) return;
    expect(
      subject.prepare({
        parentWebContentsId: 10,
        action: "change_set",
        displayChecksum: omitted.value.displayChecksum,
        display: omitted.value,
        canonicalChecksum: checksum,
        binding: binding(),
        bundleDigest: checksum,
        qualificationRevision: "approval-ui-r1",
        expiresAt: "2099-01-01T01:00:00.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "TRUSTED_APPROVAL_BINDING_MISMATCH" } });
  });

  test("waitForDecision resolves fail closed on qualification drift without a modal event", async () => {
    vi.useFakeTimers();
    try {
      let qualification: TrustedApprovalSurfaceQualificationV1 | undefined = {
        schemaVersion: "1.0",
        status: "qualified",
        bundleDigest: checksum,
        qualificationRevision: "approval-ui-r1",
        sourceRevision: "1".repeat(40),
        approvalArtifactManifestChecksum: "2".repeat(64),
        qualificationMatrixRevision: "adr-0004-qualification-r1",
        qualificationMatrixChecksum: "3".repeat(64),
        automatedReportChecksum: "4".repeat(64),
        ownerApprovalId: "owner-approval-1",
        ownerKeyId: "owner-key-1",
        issuedAt: "2098-12-01T00:00:00.000Z",
        expiresAt: "2099-02-01T00:00:00.000Z",
        attestationChecksum: "5".repeat(64)
      };
      const { subject } = qualifiedCoordinator({ qualification: () => qualification });
      const prepared = prepare(subject);
      if (!prepared.ok) return;
      const waiting = subject.waitForDecision(prepared.value.previewId);
      qualification = undefined;
      await vi.advanceTimersByTimeAsync(100);
      await expect(waiting).resolves.toEqual({
        ok: true,
        value: { status: "revoked", reason: "qualification_changed" }
      });
      await expect(subject.waitForDecision(prepared.value.previewId)).resolves.toEqual({
        ok: true,
        value: { status: "revoked", reason: "qualification_changed" }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("waitForDecision resolves fail closed when an unattended preview expires", async () => {
    vi.useFakeTimers();
    try {
      let clock = now;
      const { subject } = qualifiedCoordinator({ now: () => clock });
      const prepared = prepare(subject);
      if (!prepared.ok) return;
      const waiting = subject.waitForDecision(prepared.value.previewId);
      clock = "2099-01-01T01:00:00.000Z";
      await vi.advanceTimersByTimeAsync(100);
      await expect(waiting).resolves.toEqual({
        ok: true,
        value: { status: "revoked", reason: "expired" }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("revokeAll resolves every outstanding Main waiter during runtime replacement", async () => {
    const { subject } = qualifiedCoordinator();
    const first = prepare(subject);
    if (!first.ok) return;
    const secondDisplay = safeDisplay();
    const second = subject.prepare({
      parentWebContentsId: 11,
      action: "change_set",
      displayChecksum: secondDisplay.displayChecksum,
      display: secondDisplay,
      canonicalChecksum: checksum,
      binding: binding(),
      bundleDigest: checksum,
      qualificationRevision: "approval-ui-r1",
      expiresAt: "2099-01-01T01:00:00.000Z"
    });
    if (!second.ok) return;
    const firstWaiting = subject.waitForDecision(first.value.previewId);
    const secondWaiting = subject.waitForDecision(second.value.previewId);
    subject.revokeAll("workspace_runtime_replaced");
    await expect(firstWaiting).resolves.toEqual({
      ok: true,
      value: { status: "revoked", reason: "workspace_runtime_replaced" }
    });
    await expect(secondWaiting).resolves.toEqual({
      ok: true,
      value: { status: "revoked", reason: "workspace_runtime_replaced" }
    });
  });
});
