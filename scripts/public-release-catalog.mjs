/**
 * Derive the public descriptor projection from an evidence manifest.
 * Runtime qualification is intentionally supplied by the caller; this helper
 * only applies the evidence/catalog intersection and fails closed.
 */
export function projectPublicReleaseDescriptors({ descriptors, contextProfileId, manifest }) {
  if (!Array.isArray(descriptors) || typeof contextProfileId !== "string" || !isRecord(manifest)) {
    return { descriptors: [], errors: ["public release projection input is invalid"] };
  }
  const errors = [];
  const phases = indexPhases(manifest, errors);
  const claims = Array.isArray(manifest.catalogClaims) ? manifest.catalogClaims : [];
  const result = [];
  for (const descriptor of descriptors) {
    const toolId = descriptor?.id ?? descriptor?.name;
    const operation = descriptor?.writeOperation;
    const matches = claims.filter(
      (claim) =>
        isRecord(claim) &&
        claim.toolId === toolId &&
        claim.contextProfileId === contextProfileId &&
        (claim.writeOperation ?? undefined) === operation
    );
    if (matches.length !== 1) {
      errors.push(`${String(toolId)} has ${matches.length} matching catalog claims`);
      continue;
    }
    const claim = matches[0];
    const phaseIds = claim.phaseIds;
    const eligible =
      typeof claim.descriptorDigest === "string" &&
      claim.descriptorDigest === descriptor?.descriptorDigest &&
      Array.isArray(phaseIds) &&
      phaseIds.length > 0 &&
      phaseIds.every((phaseId) => {
        const phase = phases.get(phaseId);
        return phase?.status === "Complete" && phase?.releaseEligible === true;
      });
    if (!eligible) {
      errors.push(`${String(toolId)} catalog claim is missing, stale, or ineligible`);
      continue;
    }
    result.push(descriptor);
  }
  return { descriptors: errors.length === 0 ? result : [], errors };
}

/**
 * Validate and project the descriptor entries that a public build would ship.
 * Each entry carries its context profile because one descriptor identity can be
 * qualified differently across profiles.
 */
export function projectPublicReleaseCatalog({ entries, manifest }) {
  if (!Array.isArray(entries) || !isRecord(manifest)) {
    return { entries: [], errors: ["public release catalog input is invalid"] };
  }
  const projected = [];
  const errors = [];
  const entryKeys = new Set();
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.contextProfileId !== "string" ||
      entry.contextProfileId.length === 0 ||
      !isRecord(entry.descriptor)
    ) {
      errors.push("Stage 5 public release catalog entry is incomplete.");
      continue;
    }
    const toolId = entry.descriptor.id ?? entry.descriptor.name;
    const entryKey = `${entry.contextProfileId}\u0000${String(toolId)}\u0000${entry.descriptor.writeOperation ?? ""}`;
    if (entryKeys.has(entryKey)) {
      errors.push(`Stage 5 public release catalog entry is duplicated: ${String(toolId)}.`);
      continue;
    }
    entryKeys.add(entryKey);
    const projection = projectPublicReleaseDescriptors({
      descriptors: [entry.descriptor],
      contextProfileId: entry.contextProfileId,
      manifest
    });
    errors.push(...projection.errors);
    if (projection.errors.length === 0 && projection.descriptors.length === 1) {
      projected.push(entry);
    }
  }
  return { entries: errors.length === 0 ? projected : [], errors };
}

export function validatePublicReleaseCatalog(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest.publicReleaseCatalog)) {
    return [
      "Stage 5 evidence manifest must declare publicReleaseCatalog for public release projection."
    ];
  }
  return projectPublicReleaseCatalog({
    entries: manifest.publicReleaseCatalog,
    manifest
  }).errors;
}

export function validateCatalogClaims(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest.catalogClaims)) {
    return ["Stage 5 evidence manifest must declare catalogClaims for public release projection."];
  }
  const errors = [];
  const phases = indexPhases(manifest, errors);
  const claimKeys = new Set();
  for (const claim of manifest.catalogClaims) {
    if (
      !isRecord(claim) ||
      typeof claim.toolId !== "string" ||
      claim.toolId.length === 0 ||
      typeof claim.contextProfileId !== "string" ||
      claim.contextProfileId.length === 0 ||
      typeof claim.descriptorDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(claim.descriptorDigest) ||
      !Array.isArray(claim.phaseIds) ||
      claim.phaseIds.length === 0 ||
      claim.phaseIds.some((id) => {
        const phase = typeof id === "string" ? phases.get(id) : undefined;
        return phase?.status !== "Complete" || phase.releaseEligible !== true;
      }) ||
      (claim.writeOperation !== undefined && typeof claim.writeOperation !== "string")
    ) {
      errors.push("Stage 5 catalog claim is incomplete.");
      continue;
    }
    const key = `${claim.toolId}\u0000${claim.contextProfileId}\u0000${claim.writeOperation ?? ""}`;
    if (claimKeys.has(key)) {
      errors.push(`Stage 5 catalog claim is duplicated: ${claim.toolId}.`);
    } else {
      claimKeys.add(key);
    }
  }
  return errors;
}

function indexPhases(manifest, errors) {
  const phases = new Map();
  if (!Array.isArray(manifest.phases)) return phases;
  for (const phase of manifest.phases) {
    if (!isRecord(phase) || typeof phase.id !== "string") continue;
    if (phases.has(phase.id)) {
      errors.push(`Stage 5 phase id is duplicated: ${phase.id}.`);
      continue;
    }
    phases.set(phase.id, phase);
  }
  return phases;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
