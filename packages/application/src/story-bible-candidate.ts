import {
  validateStoryBibleWriteCandidate,
  type StoryBibleSemanticValidationOptions,
  type ValidationResult
} from "@novel-studio/schemas";

/**
 * The sole Application boundary for Renderer forms, Agent patches, and chapter-analysis deltas.
 * Repository repeats this validation before persistence because callers are never trusted.
 */
export function validateStoryBibleCandidate(
  candidate: unknown,
  options: StoryBibleSemanticValidationOptions = {}
): ValidationResult {
  return validateStoryBibleWriteCandidate(candidate, options);
}
