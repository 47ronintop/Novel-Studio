import type { EngineeringFileQualificationCapability } from "@novel-studio/agent-engine";

import type { EngineeringFileAccessAddonLoader } from "./engineering-file-access-adapter.js";
import type { EngineeringFileCapabilityAuthority } from "./engineering-file-capability-authority.js";
import {
  hasCurrentUnsignedBetaAuthorization,
  type UnsignedBetaAuthorizationService,
  type UnsignedBetaAuthorizationV1
} from "./unsigned-beta-qualification.js";

export interface UnsignedBetaEngineeringCapabilityAuthority extends EngineeringFileCapabilityAuthority {
  readonly channel: "unsigned-beta";
  currentRevision(): string;
}

/**
 * Main-owned local-beta authority. Authorization alone is insufficient: every capability is also
 * intersected with the exact native add-on metadata loaded by the normal Engineering runtime.
 */
export function createUnsignedBetaEngineeringCapabilityAuthority(options: {
  readonly authorizationService: Pick<UnsignedBetaAuthorizationService, "subscribeRevocation">;
  readonly getCurrentAuthorization: () => UnsignedBetaAuthorizationV1 | undefined;
  readonly packageIdentityChecksum: string;
  readonly addonLoader: EngineeringFileAccessAddonLoader;
  readonly now?: () => string;
}): UnsignedBetaEngineeringCapabilityAuthority {
  const now = options.now ?? (() => new Date().toISOString());

  const currentAuthorization = (): UnsignedBetaAuthorizationV1 | undefined => {
    let authorization: UnsignedBetaAuthorizationV1 | undefined;
    try {
      authorization = options.getCurrentAuthorization();
    } catch {
      return undefined;
    }
    return hasCurrentUnsignedBetaAuthorization(
      authorization,
      options.packageIdentityChecksum,
      now()
    )
      ? authorization
      : undefined;
  };

  return Object.freeze({
    channel: "unsigned-beta" as const,
    async hasCapability(capability: EngineeringFileQualificationCapability) {
      if (currentAuthorization() === undefined) return false;
      const loaded = options.addonLoader.load();
      if (loaded.status !== "loaded" || loaded.metadata.accessEligible !== "available")
        return false;
      if (capability === "root" || capability === "access") {
        return true;
      }
      return (
        loaded.metadata.batch === "8" &&
        loaded.metadata.mutation === "available" &&
        loaded.metadata.recovery === "available"
      );
    },
    subscribeRevocation(listener: () => void) {
      return options.authorizationService.subscribeRevocation(listener);
    },
    currentRevision() {
      const authorization = currentAuthorization();
      if (authorization === undefined) return "unavailable";
      const loaded = options.addonLoader.load();
      if (
        loaded.status !== "loaded" ||
        loaded.metadata.accessEligible !== "available" ||
        loaded.metadata.batch !== "8" ||
        loaded.metadata.mutation !== "available" ||
        loaded.metadata.recovery !== "available"
      ) {
        return "unavailable";
      }
      return `${authorization.authorizationChecksum}:native-batch-${loaded.metadata.batch}`;
    }
  });
}
