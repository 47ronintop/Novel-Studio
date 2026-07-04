import type { JsonObject } from "@novel-studio/shared";

import type {
  LlmContent,
  LlmErrorCode,
  LlmProvider,
  LlmProviderCompletion,
  LlmProviderStreamEvent,
  LlmUsage
} from "./types.js";
import { LlmProviderFailure } from "./errors.js";

export interface MockCompletionSuccess {
  readonly type: "success";
  readonly content: LlmContent;
  readonly usage?: LlmUsage;
}

export interface MockCompletionError {
  readonly type: "error";
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly redactedDetail?: JsonObject;
}

export type MockCompletionStep = MockCompletionSuccess | MockCompletionError;

export interface MockProviderOptions {
  readonly completions?: readonly MockCompletionStep[];
  readonly streams?: readonly (readonly LlmProviderStreamEvent[])[];
}

export function createMockProvider(options: MockProviderOptions): LlmProvider {
  let completionIndex = 0;
  let streamIndex = 0;

  return {
    id: "mock",
    async complete() {
      const completion = options.completions?.[completionIndex];
      completionIndex += 1;

      if (completion === undefined) {
        return defaultCompletion();
      }

      if (completion.type === "error") {
        const failureInput = {
          code: completion.code,
          message: completion.message,
          retryable: completion.retryable
        };

        throw new LlmProviderFailure(
          completion.redactedDetail === undefined
            ? failureInput
            : {
                ...failureInput,
                redactedDetail: completion.redactedDetail
              }
        );
      }

      const providerCompletion: LlmProviderCompletion = {
        content: completion.content
      };

      if (completion.usage === undefined) {
        return providerCompletion;
      }

      return {
        ...providerCompletion,
        usage: completion.usage
      };
    },
    async *stream() {
      const stream = options.streams?.[streamIndex] ?? [];
      streamIndex += 1;

      for (const event of stream) {
        yield event;
      }
    }
  };
}

function defaultCompletion(): LlmProviderCompletion {
  return {
    content: {
      type: "text",
      value: ""
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageStatus: "missing",
      cost: {
        amount: 0,
        currency: "USD",
        status: "unknown"
      }
    }
  };
}
