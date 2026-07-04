import { err, ok } from "@novel-studio/shared";

import {
  createLlmFailure,
  LlmProviderFailure,
  missingUsage,
  normalizeProviderFailure,
  retryExhaustedFailure,
  type NormalizedLlmFailure
} from "./errors.js";
import type {
  LlmAdapter,
  LlmAdapterOptions,
  LlmRetryPolicy,
  LlmRequest,
  LlmResponse,
  LlmProviderCompletion,
  LlmStreamResult,
  LlmTokenPricing,
  LlmUsage
} from "./types.js";

const DEFAULT_RETRY_POLICY: LlmRetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  backoffMultiplier: 2,
  retryableCodes: ["LLM_TIMEOUT", "LLM_RATE_LIMITED", "LLM_PROVIDER_ERROR"]
};

export function createLlmAdapter(options: LlmAdapterOptions): LlmAdapter {
  const now = options.clock ?? (() => new Date().toISOString());
  const retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const scheduler = options.scheduler ?? defaultScheduler;

  return {
    async complete(request: LlmRequest) {
      if (request.mode !== "non-streaming") {
        return err(
          createLlmFailure({
            code: "LLM_UNSUPPORTED_MODE",
            message: "The request mode is not supported by this adapter method.",
            retryable: false,
            traceId: request.traceId,
            createdAt: now(),
            suggestedAction: "Call the streaming adapter method for streaming requests."
          }).error
        );
      }

      if (request.modelProfile.timeoutMs !== undefined && request.modelProfile.timeoutMs <= 0) {
        return err(
          createLlmFailure({
            code: "LLM_TIMEOUT",
            message: "The model request timed out before the provider returned a response.",
            retryable: true,
            traceId: request.traceId,
            createdAt: now(),
            suggestedAction: "Increase the timeout or retry with a smaller request."
          }).error
        );
      }

      let lastFailure: NormalizedLlmFailure | undefined;

      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
        try {
          const completion = await completeWithTimeout(
            options.provider.complete(request),
            request.modelProfile.timeoutMs
          );
          const response: LlmResponse = {
            schemaVersion: "1.0",
            requestId: request.requestId,
            provider: options.provider.id,
            modelName: request.modelProfile.modelName,
            status: "success",
            content: completion.content,
            usage: withCostEstimate(
              completion.usage ?? missingUsage(),
              request.modelProfile.tokenPricing
            ),
            createdAt: now()
          };

          return ok(response);
        } catch (error) {
          const failure = normalizeProviderFailure({
            error,
            traceId: request.traceId,
            createdAt: now()
          });
          lastFailure = failure;

          if (!shouldRetry(failure, retryPolicy) || attempt >= retryPolicy.maxAttempts) {
            if (attempt > 1 && shouldRetry(failure, retryPolicy)) {
              return err(
                retryExhaustedFailure({
                  attempts: attempt,
                  lastCode: failure.code,
                  traceId: request.traceId,
                  createdAt: now()
                }).error
              );
            }

            return err(failure.error);
          }

          await scheduler(delayForAttempt(attempt, retryPolicy));
        }
      }

      return err(
        retryExhaustedFailure({
          attempts: retryPolicy.maxAttempts,
          lastCode: lastFailure?.code ?? "LLM_PROVIDER_ERROR",
          traceId: request.traceId,
          createdAt: now()
        }).error
      );
    },
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamResult> {
      if (request.mode !== "streaming") {
        yield err(
          createLlmFailure({
            code: "LLM_UNSUPPORTED_MODE",
            message: "The request mode is not supported by this adapter method.",
            retryable: false,
            traceId: request.traceId,
            createdAt: now(),
            suggestedAction: "Call the non-streaming adapter method for non-streaming requests."
          }).error
        );
        return;
      }

      yield ok({
        type: "start",
        requestId: request.requestId,
        provider: options.provider.id,
        modelName: request.modelProfile.modelName,
        createdAt: now()
      });

      try {
        for await (const event of options.provider.stream(request)) {
          yield ok(event);
        }
      } catch (error) {
        yield err(
          normalizeProviderFailure({
            error,
            traceId: request.traceId,
            createdAt: now()
          }).error
        );
        return;
      }

      yield ok({
        type: "done",
        requestId: request.requestId,
        provider: options.provider.id,
        modelName: request.modelProfile.modelName,
        createdAt: now()
      });
    }
  };
}

function shouldRetry(failure: NormalizedLlmFailure, retryPolicy: LlmRetryPolicy): boolean {
  return failure.retryable && retryPolicy.retryableCodes.includes(failure.code);
}

function delayForAttempt(attempt: number, retryPolicy: LlmRetryPolicy): number {
  const rawDelay = retryPolicy.baseDelayMs * retryPolicy.backoffMultiplier ** (attempt - 1);
  return Math.min(rawDelay, retryPolicy.maxDelayMs);
}

async function completeWithTimeout(
  operation: Promise<LlmProviderCompletion>,
  timeoutMs: number | undefined
): Promise<LlmProviderCompletion> {
  if (timeoutMs === undefined) {
    return operation;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutOperation = new Promise<LlmProviderCompletion>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new LlmProviderFailure({
          code: "LLM_TIMEOUT",
          message: "The model request timed out before the provider returned a response.",
          retryable: true
        })
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutOperation]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function defaultScheduler(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function withCostEstimate(usage: LlmUsage, pricing: LlmTokenPricing | undefined): LlmUsage {
  if (pricing === undefined || usage.usageStatus === "missing" || usage.cost.status !== "unknown") {
    return usage;
  }

  const amount =
    (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) /
    1_000_000;

  return {
    ...usage,
    cost: {
      amount,
      currency: pricing.currency,
      status: "estimated"
    }
  };
}
