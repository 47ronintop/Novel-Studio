import { describe, expect, test, vi } from "vitest";

import type {
  DesktopApplication,
  PreparedWorkspaceActivation,
  WorkspaceActivationDto
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import type {
  DesktopAgentRuntimeManager,
  DesktopAgentWorkspacePreparation
} from "../src/main/agent-runtime-manager.js";
import {
  createWorkspaceActivationCoordinator,
  toDesktopAgentWorkspaceBinding
} from "../src/main/workspace-activation.js";

describe("workspace activation coordinator", () => {
  test("commits application and runtime only after both candidates prepare", async () => {
    const order: string[] = [];
    const candidate = creativeCandidate();
    const committed = creativeDto();
    const application = fakeApplication({ candidate, committed, order });
    const preparedRuntime = { binding: toDesktopAgentWorkspaceBinding(candidate), runtime: {} };
    const runtimeManager = fakeRuntimeManager({ preparedRuntime, order });
    const coordinator = createWorkspaceActivationCoordinator({ application, runtimeManager });

    const result = await coordinator.openCreativeProject("D:/Novel/New");

    expect(result).toEqual(ok(committed));
    expect(order).toEqual([
      "application:prepare",
      "runtime:prepare",
      "application:commit",
      "runtime:commit",
      "application:finalize"
    ]);
  });

  test("discards the application candidate when runtime preparation fails", async () => {
    const order: string[] = [];
    const candidate = creativeCandidate();
    const failure = createUnifiedError({
      code: "AGENT_RUNTIME_PREPARE_FAILED",
      category: "AgentError",
      message: "prepare failed",
      recoverability: "retryable",
      suggestedAction: "retry",
      traceId: "workspace-activation-test"
    });
    const application = fakeApplication({ candidate, committed: creativeDto(), order });
    const runtimeManager = fakeRuntimeManager({
      preparedRuntime: { binding: toDesktopAgentWorkspaceBinding(candidate), runtime: {} },
      order,
      prepareResult: err(failure)
    });
    const coordinator = createWorkspaceActivationCoordinator({ application, runtimeManager });

    const result = await coordinator.openCreativeProject("D:/Novel/New");

    expect(result).toEqual(err(failure));
    expect(order).toEqual([
      "application:prepare",
      "runtime:prepare",
      "application:discard"
    ]);
  });

  test("keeps the committed activation successful when post-commit cleanup fails", async () => {
    const order: string[] = [];
    const candidate = creativeCandidate();
    const committed = creativeDto();
    const cleanupFailure = createUnifiedError({
      code: "PROJECT_LOCK_RELEASE_FAILED",
      category: "StorageError",
      message: "Old project lock release failed.",
      recoverability: "retryable",
      suggestedAction: "Retry during shutdown.",
      traceId: "workspace-activation-finalize"
    });
    const application = fakeApplication({
      candidate,
      committed,
      order,
      finalizeResult: err(cleanupFailure)
    });
    const preparedRuntime = { binding: toDesktopAgentWorkspaceBinding(candidate), runtime: {} };
    const runtimeManager = fakeRuntimeManager({ preparedRuntime, order });
    const reportCleanupFailure = vi.fn();
    const coordinator = createWorkspaceActivationCoordinator({
      application,
      runtimeManager,
      reportCleanupFailure
    });

    const result = await coordinator.openCreativeProject("D:/Novel/New");

    expect(result).toEqual(ok(committed));
    expect(reportCleanupFailure).toHaveBeenCalledWith(cleanupFailure);
    expect(order).toEqual([
      "application:prepare",
      "runtime:prepare",
      "application:commit",
      "runtime:commit",
      "application:finalize"
    ]);
  });

  test("maps only internal activation roots into runtime bindings", () => {
    expect(toDesktopAgentWorkspaceBinding(creativeCandidate())).toEqual({
      kind: "creativeProject",
      workspaceId: "prj_new",
      contentRoot: "D:/Novel/New",
      stateRoot: "D:/Novel/New",
      activeChapterId: "chapter_1"
    });
    expect(
      toDesktopAgentWorkspaceBinding({
        activationId: "activation_engineering",
        context: {
          kind: "engineeringWorkspace",
          workspaceId: "ws_engineering",
          displayName: "Source",
          contentRoot: "D:/Source",
          stateRoot: "D:/State",
          capabilities: ["engineeringWorkbench", "generalFileContext"]
        },
        engineeringWorkspace: {
          workspaceId: "ws_engineering",
          displayName: "Source",
          tree: { nodes: [], truncated: false }
        }
      })
    ).toEqual({
      kind: "engineeringWorkspace",
      workspaceId: "ws_engineering",
      contentRoot: "D:/Source",
      stateRoot: "D:/State"
    });
  });
});

function creativeCandidate(): PreparedWorkspaceActivation {
  return {
    activationId: "activation_creative",
    context: {
      kind: "creativeProject",
      workspaceId: "prj_new",
      projectId: "prj_new",
      displayName: "New",
      contentRoot: "D:/Novel/New",
      stateRoot: "D:/Novel/New",
      activeChapterId: "chapter_1",
      capabilities: ["creativeWorkbench", "writingContext"]
    },
    creativeProject: {
      projectRoot: "D:/Novel/New",
      project: {
        schemaVersion: "1.0",
        projectId: "prj_new",
        title: "New",
        projectType: "novel",
        language: "en",
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      settings: { schemaVersion: "1.0", autosave: {}, history: {}, models: {} },
      chapters: [],
      recovery: { availableItems: [] },
      health: {
        status: "healthy",
        checkedAt: "2026-07-19T00:00:00.000Z",
        summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
        issues: []
      },
      activeChapterId: "chapter_1"
    }
  };
}

function creativeDto(): WorkspaceActivationDto {
  return {
    context: {
      kind: "creativeProject",
      workspaceId: "prj_new",
      projectId: "prj_new",
      displayName: "New",
      capabilities: ["creativeWorkbench", "writingContext"]
    },
    creativeProject: {
      project: creativeCandidate().creativeProject.project,
      settings: creativeCandidate().creativeProject.settings,
      chapters: [],
      recovery: { availableItems: [] },
      health: creativeCandidate().creativeProject.health,
      activeChapterId: "chapter_1"
    }
  };
}

function fakeApplication(input: {
  readonly candidate: PreparedWorkspaceActivation;
  readonly committed: WorkspaceActivationDto;
  readonly order: string[];
  readonly finalizeResult?: ReturnType<typeof err>;
}): DesktopApplication {
  return {
    prepareOpenCreativeProject: vi.fn(async () => {
      input.order.push("application:prepare");
      return ok(input.candidate);
    }),
    commitWorkspaceActivation: vi.fn(() => {
      input.order.push("application:commit");
      return input.committed;
    }),
    discardWorkspaceActivation: vi.fn(async () => {
      input.order.push("application:discard");
      return ok(undefined);
    }),
    finalizeWorkspaceActivation: vi.fn(async () => {
      input.order.push("application:finalize");
      return input.finalizeResult ?? ok(undefined);
    })
  } as unknown as DesktopApplication;
}

function fakeRuntimeManager(input: {
  readonly preparedRuntime: DesktopAgentWorkspacePreparation;
  readonly order: string[];
  readonly prepareResult?: ReturnType<typeof err>;
}): DesktopAgentRuntimeManager {
  return {
    prepareWorkspace: vi.fn(async () => {
      input.order.push("runtime:prepare");
      return input.prepareResult ?? ok(input.preparedRuntime);
    }),
    commitPreparedWorkspace: vi.fn(() => input.order.push("runtime:commit"))
  } as unknown as DesktopAgentRuntimeManager;
}
