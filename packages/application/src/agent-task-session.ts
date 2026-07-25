import { createHash } from "node:crypto";
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import type { AuthorizedTask } from "@novel-studio/repository";

/** Describes one file in the workspace projection. */
export interface ProjectionFile {
  readonly relativePath: string;
  readonly sourceChecksum: string;
  readonly projectedPath: string;
}

/** Manifest of all files copied into the disposable workspace projection. */
export interface ProjectionManifest {
  readonly manifestId: string;
  readonly taskId: string;
  readonly snapshotId: string;
  readonly files: readonly ProjectionFile[];
  readonly manifestDigest: string;
}

/** Immutable execution snapshot for a task launch. */
export interface TaskExecutionSnapshot {
  readonly snapshotId: string;
  readonly taskId: string;
  readonly canonicalExecutable: string;
  readonly normalizedArgv: readonly string[];
  readonly parametersDigest: string;
  readonly workspaceIdentity: string;
  readonly catalogRevision: string;
  readonly attestationRef: string;
  readonly fileProfile: "workspace_read_only" | "scratch_output";
  readonly resourceQuota: Readonly<{
    maxCpuMs: number;
    maxMemoryBytes: number;
    maxWallClockMs: number;
    maxProcesses: number;
    maxScratchBytes: number;
  }>;
  readonly projectionManifest: ProjectionManifest | null;
  readonly createdAt: string;
}

/** Snapshot of workspace identity at the time of task preparation. */
export interface WorkspaceIdentitySnapshot {
  readonly workspaceRoot: string;
  readonly identityDigest: string;
}

export interface PrepareTaskExecutionInput {
  readonly runId: string;
  readonly taskId: string;
  readonly parameters: JsonObject;
  readonly workspaceIdentity: WorkspaceIdentitySnapshot;
  readonly attestationRef: string;
  readonly catalogRevision: string;
}

/** Minimal attestation lookup interface. */
export interface AttestationLookup {
  getAttestation(): { attestationId: string; capabilities: Record<string, string> } | undefined;
  getAttestationById(
    id: string
  ): { attestationId: string; capabilities: Record<string, string> } | undefined;
}

export interface AgentTaskSessionOptions {
  readonly projectId: string;
  readonly getAuthorizedTask: (taskId: string) => Promise<AuthorizedTask | undefined>;
  readonly attestationLookup?: AttestationLookup;
  readonly createSnapshotId?: () => string;
}

export interface AgentTaskSession {
  prepareTaskExecution(
    input: PrepareTaskExecutionInput
  ): Promise<Result<TaskExecutionSnapshot, UnifiedError>>;
}

export function createAgentTaskSession(options: AgentTaskSessionOptions): AgentTaskSession {
  const createSnapshotId =
    options.createSnapshotId ??
    (() =>
      `snap_${createHash("sha256")
        .update(`${Date.now()}${Math.random()}`)
        .digest("hex")
        .slice(0, 16)}`);

  return {
    async prepareTaskExecution(input) {
      const task = await options.getAuthorizedTask(input.taskId);
      if (task === undefined) {
        return err(
          taskError(
            "AGENT_TASK_NOT_AUTHORIZED",
            `Task ${input.taskId} is not in the authorized catalog.`
          )
        );
      }

      if (task.catalogRevision !== input.catalogRevision) {
        return err(
          taskError(
            "AGENT_TASK_CATALOG_REVISION_MISMATCH",
            "Task catalog revision has changed since authorization."
          )
        );
      }

      if (options.attestationLookup !== undefined) {
        const attest = options.attestationLookup.getAttestationById(input.attestationRef);
        if (attest === undefined) {
          return err(
            taskError(
              "AGENT_TASK_ATTESTATION_INVALID",
              "Sandbox attestation is missing or expired."
            )
          );
        }
        const caps = attest.capabilities;
        if (
          caps["fileIsolation"] !== "verified" ||
          caps["networkIsolation"] !== "verified" ||
          caps["jobObjectKillOnClose"] !== "verified" ||
          caps["appContainerOrLowBox"] !== "verified"
        ) {
          return err(
            taskError(
              "AGENT_TASK_ATTESTATION_CAPABILITIES_INCOMPLETE",
              "Sandbox attestation does not have all required capabilities verified."
            )
          );
        }
      }

      if (typeof input.parameters !== "object" || Array.isArray(input.parameters)) {
        return err(
          taskError("AGENT_TASK_PARAMETERS_INVALID", "Task parameters must be an object.")
        );
      }

      const normalizedArgv = resolveArgvTemplate(task.argvTemplate, input.parameters);
      const parametersDigest = createHash("sha256")
        .update(JSON.stringify(input.parameters))
        .digest("hex");

      const snapshotId = createSnapshotId();
      const snapshot: TaskExecutionSnapshot = Object.freeze({
        snapshotId,
        taskId: input.taskId,
        canonicalExecutable: createHash("sha256").update(task.launcherTemplate).digest("hex"),
        normalizedArgv: Object.freeze([...normalizedArgv]),
        parametersDigest,
        workspaceIdentity: input.workspaceIdentity.identityDigest,
        catalogRevision: input.catalogRevision,
        attestationRef: input.attestationRef,
        fileProfile: task.fileProfile,
        resourceQuota: Object.freeze({ ...task.resourceQuota }),
        projectionManifest: null,
        createdAt: new Date().toISOString()
      });

      return ok(snapshot);
    }
  };
}

function resolveArgvTemplate(template: readonly string[], parameters: JsonObject): string[] {
  return template.map((arg) =>
    arg.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
      const val = parameters[key];
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return arg;
    })
  );
}

function taskError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the task catalog and sandbox attestation before running.",
    traceId: "agent-task-session"
  });
}
