import type { EngineeringFileQualificationCapability } from "@novel-studio/agent-engine";

/** Main-only capability authority shared by signed production and the explicit unsigned beta. */
export interface EngineeringFileCapabilityAuthority {
  hasCapability(capability: EngineeringFileQualificationCapability): Promise<boolean>;
  subscribeRevocation(listener: () => void): () => void;
}
