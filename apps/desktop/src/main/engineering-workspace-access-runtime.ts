import type { EngineeringFileAccessQualificationService } from "./engineering-file-access-qualification.js";
import { hasMainOwnedEngineeringFileQualification } from "./engineering-file-access-qualification.js";
import {
  createEngineeringFileAccessAddonLoader,
  createEngineeringWorkspaceAccessPort,
  isEngineeringWorkspaceAccessOperation,
  type EngineeringFileAccessAddonLoader,
  type EngineeringWorkspaceAccessOperation
} from "./engineering-file-access-adapter.js";

export type EngineeringWorkspaceAccessUnavailableReason =
  | "operation_not_available_in_batch_6"
  | "qualification_unavailable"
  | "native_addon_unavailable"
  | "production_wiring_not_enabled";

export interface EngineeringWorkspaceAccessRuntime {
  readonly operations: readonly EngineeringWorkspaceAccessOperation[];
  /**
   * B6 intentionally remains an unavailable seam until the access port, qualification, and
   * production composition are wired together. It never invokes an unpublished native operation.
   */
  request(operation: string): Promise<EngineeringWorkspaceAccessRuntimeResult>;
}

export interface EngineeringWorkspaceAccessRuntimeResult {
  readonly status: "unavailable";
  readonly operation: string;
  readonly reason: EngineeringWorkspaceAccessUnavailableReason;
}

export function createEngineeringWorkspaceAccessRuntime(options: {
  readonly qualificationService: EngineeringFileAccessQualificationService;
  readonly addonLoader?: EngineeringFileAccessAddonLoader;
}): EngineeringWorkspaceAccessRuntime {
  const addonLoader = options.addonLoader ?? createEngineeringFileAccessAddonLoader();
  const port = createEngineeringWorkspaceAccessPort({ addonLoader });

  return Object.freeze({
    operations: port.operations,
    async request(operation: string): Promise<EngineeringWorkspaceAccessRuntimeResult> {
      if (!isEngineeringWorkspaceAccessOperation(operation)) {
        return unavailable(operation, "operation_not_available_in_batch_6");
      }

      const attestation = await options.qualificationService.readAttestation();
      if (
        !hasMainOwnedEngineeringFileQualification(attestation, "root") ||
        !hasMainOwnedEngineeringFileQualification(attestation, "access")
      ) {
        return unavailable(operation, "qualification_unavailable");
      }

      return port.request(operation);
    }
  });
}

function unavailable(
  operation: string,
  reason: EngineeringWorkspaceAccessUnavailableReason
): EngineeringWorkspaceAccessRuntimeResult {
  return Object.freeze({ status: "unavailable" as const, operation, reason });
}
