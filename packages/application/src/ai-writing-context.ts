import type { ContextCandidate } from "@novel-studio/context-engine";
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AiWritingContextCandidateProvider,
  AiWritingContextCandidateProviderInput
} from "./ai-writing-workflow-types.js";

export async function collectAiWritingContextCandidates(input: {
  readonly provider: AiWritingContextCandidateProvider | undefined;
  readonly request: AiWritingContextCandidateProviderInput;
  readonly primary: ContextCandidate;
}): Promise<Result<readonly ContextCandidate[], UnifiedError>> {
  if (input.provider === undefined) {
    return ok([input.primary]);
  }

  const provided = await input.provider(input.request);
  if (!provided.ok) {
    return provided;
  }

  const seen = new Set([`${input.primary.refType}:${input.primary.refId}`]);
  const additional = provided.value.filter((candidate) => {
    const key = `${candidate.refType}:${candidate.refId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return ok([input.primary, ...additional]);
}
