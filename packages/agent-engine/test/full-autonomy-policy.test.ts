import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  createAgentRunCoordinator,
  createChangeSetRevision,
  decideChangeSetApproval,
  type StartAgentRunCommand
} from "../src/index.js";

describe("Stage 3 full-autonomy policy", () => {
  test("keeps manual confirmation as the default execution policy", () => {
    const coordinator = createAgentRunCoordinator({ createRunId: () => "run_manual" });

    expect(coordinator.startRun(startCommand())).toMatchObject({
      ok: true,
      value: {
        operationMode: "execution",
        writePolicy: "write_before_confirmation"
      }
    });
  });

  test("normalizes a missing write policy to manual confirmation", () => {
    const coordinator = createAgentRunCoordinator({ createRunId: () => "run_missing_policy" });
    const { writePolicy: _writePolicy, ...commandWithoutPolicy } = startCommand();
    void _writePolicy;

    expect(
      coordinator.startRun(commandWithoutPolicy as StartAgentRunCommand)
    ).toMatchObject({
      ok: true,
      value: {
        operationMode: "execution",
        writePolicy: "write_before_confirmation"
      }
    });
  });

  test("rejects an unknown write policy at the coordinator boundary", () => {
    const coordinator = createAgentRunCoordinator({ createRunId: () => "run_unknown_policy" });

    expect(
      coordinator.startRun({
        ...startCommand(),
        writePolicy: "persisted_auto_write" as never
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_POLICY_INVALID" } });
  });

  test("rejects null instead of treating it as a missing write policy", () => {
    const coordinator = createAgentRunCoordinator({ createRunId: () => "run_null_policy" });

    expect(
      coordinator.startRun({
        ...startCommand(),
        writePolicy: null as never
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_POLICY_INVALID" } });
  });

  test("revokes persisted automatic authorization when a run is restored", () => {
    const original = createAgentRunCoordinator({ createRunId: () => "run_restored_auto" });
    const started = original.startRun({
      ...startCommand(),
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const restored = createAgentRunCoordinator().restoreRun(
      started.value,
      original.readEvents(started.value.runId)
    );

    expect(restored).toMatchObject({
      ok: true,
      value: { writePolicy: "write_before_confirmation" }
    });
  });

  test("rejects an unknown persisted write policy during restore", () => {
    const original = createAgentRunCoordinator({ createRunId: () => "run_bad_restore" });
    const started = original.startRun(startCommand());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const forgedSnapshot = {
      ...started.value,
      writePolicy: "persisted_auto_write" as never
    };
    const restoringCoordinator = createAgentRunCoordinator();
    const restored = restoringCoordinator.restoreRun(
      forgedSnapshot,
      original.readEvents(started.value.runId)
    );

    expect(restored).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_POLICY_INVALID" }
    });
    expect(restoringCoordinator.readSnapshot(started.value.runId)).toBeUndefined();
  });

  test("rejects automatic writes for planning and without explicit acknowledgement", () => {
    const planningCoordinator = createAgentRunCoordinator({
      createRunId: () => "run_planning_auto"
    });
    expect(
      planningCoordinator.startRun({
        ...startCommand(),
        operationMode: "planning",
        writePolicy: "user_preapproved_run",
        writePolicyAcknowledged: true
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_POLICY_NOT_AVAILABLE" } });

    const unacknowledgedCoordinator = createAgentRunCoordinator({
      createRunId: () => "run_unacknowledged_auto"
    });
    expect(
      unacknowledgedCoordinator.startRun({
        ...startCommand(),
        writePolicy: "user_preapproved_run"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_POLICY_ACK_REQUIRED" } });
  });

  test("accepts an acknowledged execution-only policy for the current run", () => {
    const coordinator = createAgentRunCoordinator({ createRunId: () => "run_auto" });

    expect(
      coordinator.startRun({
        ...startCommand(),
        writePolicy: "user_preapproved_run",
        writePolicyAcknowledged: true
      })
    ).toMatchObject({
      ok: true,
      value: {
        runId: "run_auto",
        operationMode: "execution",
        writePolicy: "user_preapproved_run"
      }
    });
  });

  test("keeps the public approval gate human-only for an automatic-policy Change Set", async () => {
    const baseContent = "before\n";
    const input = {
      changeSetId: "change_auto",
      runId: "run_auto",
      projectId: "project-01",
      checkpointId: "checkpoint-01",
      contextSnapshotId: "context-01",
      createdAt: "2026-07-13T01:00:00.000Z",
      proposal: {
        relativePath: "notes/outline.md",
        assetType: "text",
        baseContent,
        baseChecksum: sha256(baseContent),
        range: { unit: "character", start: 0, end: baseContent.length },
        replacement: "after\n"
      }
    } as const;
    const manualChangeSet = await createChangeSetRevision(
      { ...input, writePolicy: "write_before_confirmation" },
      { createHunkId: () => "hunk_policy" }
    );
    const changeSet = await createChangeSetRevision(
      { ...input, writePolicy: "user_preapproved_run" },
      { createHunkId: () => "hunk_policy" }
    );

    expect(changeSet.writePolicy).toBe("user_preapproved_run");
    expect(manualChangeSet.writePolicy).toBe("write_before_confirmation");
    expect(changeSet.checksum).not.toBe(manualChangeSet.checksum);

    expect(
      decideChangeSetApproval({
        changeSet,
        approvalSource: "user_preapproved_run",
        decision: "apply_selected",
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        checksum: changeSet.checksum,
        resolvedAt: "2026-07-13T02:00:00.000Z"
      } as never)
    ).toMatchObject({
      ok: true,
      value: {
        decision: "apply_selected",
        approvalSource: "human_confirmation",
        binding: {
          changeSetId: changeSet.changeSetId,
          revision: changeSet.revision,
          checksum: changeSet.checksum,
          approvalToken: changeSet.approvalToken
        }
      }
    });
  });
});

function startCommand(): StartAgentRunCommand {
  return {
    projectId: "project-01",
    commandId: "start-policy",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    userRequest: "Update the outline.",
    providerCapabilitySnapshot: {
      profileId: "profile-stage3",
      provider: "demo",
      modelName: "demo-stage3",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 32_000,
      requiredContextTokens: 1_000
    }
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
