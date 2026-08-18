import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AgentRunModelDriver,
  ChapterEditorSession,
  CreateLlmAgentRunModelDriverOptions,
  ModelDiscoveryModelInput,
  ModelDiscoveryPort,
  ModelDiscoverySnapshot,
  ModelConnectionTester,
  ModelReasoningStrengthAvailable,
  ModelReasoningStrengthControl,
  ModelProfile
} from "@novel-studio/application";
import {
  createLlmAgentRunModelDriver,
  createModelDiscoveryFallback,
  createModelDiscoverySnapshot,
  MODEL_PROVIDER_CATALOG,
  isModelProvider
} from "@novel-studio/application";
import {
  AnthropicHttpError,
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAiCompatibleProvider,
  createLlmAdapter,
  createProviderRouter,
  GeminiHttpError,
  LlmProviderFailure,
  OpenAiCompatibleHttpError,
  type AnthropicTransport,
  type AnthropicTransportRequest,
  type GeminiTransport,
  type GeminiTransportRequest,
  type LlmProvider,
  type LlmProviderId,
  type LlmPromptCacheRequest,
  type LlmRequest,
  type LlmModelProfile,
  type LlmParameters,
  type OpenAiCompatibleTransport,
  type OpenAiCompatibleTransportRequest
} from "@novel-studio/llm-adapter";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import { createGeminiPromptCacheResourceManager } from "./gemini-prompt-cache-resource-manager.js";

export interface DesktopSecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface ModelProfileVerificationInput {
  readonly provider: string;
  readonly baseUrl?: string;
  readonly modelName: string;
}

export interface ModelSecretStore {
  saveSecret(secretRef: string, secret: string): Promise<Result<void, UnifiedError>>;
  readSecret(secretRef: string): Promise<Result<string | undefined, UnifiedError>>;
  markVerified(
    secretRef: string,
    profile: ModelProfileVerificationInput
  ): Promise<Result<void, UnifiedError>>;
  isVerified(
    secretRef: string,
    profile: ModelProfileVerificationInput
  ): Promise<Result<boolean, UnifiedError>>;
}

export interface DesktopModelRuntime {
  readonly modelConnectionTester: ModelConnectionTester;
  readonly modelDiscoveryPort: ModelDiscoveryPort;
  readonly createAiProvider: (input: {
    readonly chapterEditorSession: ChapterEditorSession;
  }) => LlmProvider;
  readonly createAgentModelDriver: (input: {
    readonly modelProfile: LlmModelProfile;
    readonly parameters?: LlmParameters;
    readonly promptCacheScopeKey?: string;
  }) => AgentRunModelDriver;
  readonly releasePromptCacheScope: (scopeKey: string) => void;
  readonly dispose: () => Promise<void>;
}

export interface DesktopModelRuntimeOptions {
  readonly userDataRoot: string;
  readonly secretStore?: ModelSecretStore;
  readonly fetch?: typeof fetch;
}

interface SecretFile {
  readonly schemaVersion: "1.0";
  readonly secrets: Record<string, SecretEntry>;
}

interface SecretEntry {
  readonly ciphertext: string;
  readonly verifiedAt?: string;
  readonly verificationFingerprint?: string;
}

export function createEncryptedFileModelSecretStore(input: {
  readonly userDataRoot: string;
  readonly cipher: DesktopSecretCipher;
  readonly now?: () => string;
}): ModelSecretStore {
  const secretsFile = join(input.userDataRoot, "secrets", "model-secrets.json");
  const now = input.now ?? (() => new Date().toISOString());

  return {
    async saveSecret(secretRef, secret) {
      if (!isValidSecretRef(secretRef) || secret.trim().length === 0) {
        return err(secretStoreError("MODEL_SECRET_INVALID", "Model secret input is invalid."));
      }
      if (!input.cipher.isEncryptionAvailable()) {
        return err(
          secretStoreError(
            "MODEL_SECRET_ENCRYPTION_UNAVAILABLE",
            "Electron safeStorage encryption is not available on this system."
          )
        );
      }

      const file = await readSecretFile(secretsFile);
      if (!file.ok) {
        return file;
      }
      const encrypted = input.cipher.encryptString(secret);
      const existing = file.value.secrets[secretRef];
      return writeSecretFile(secretsFile, {
        schemaVersion: "1.0",
        secrets: {
          ...file.value.secrets,
          [secretRef]: {
            ciphertext: encrypted.toString("base64"),
            ...(existing?.verifiedAt === undefined ? {} : { verifiedAt: existing.verifiedAt }),
            ...(existing?.verificationFingerprint === undefined
              ? {}
              : { verificationFingerprint: existing.verificationFingerprint })
          }
        }
      });
    },
    async readSecret(secretRef) {
      if (!isValidSecretRef(secretRef)) {
        return err(secretStoreError("MODEL_SECRET_INVALID", "Model secret reference is invalid."));
      }
      const file = await readSecretFile(secretsFile);
      if (!file.ok) {
        return file;
      }
      const entry = file.value.secrets[secretRef];
      if (entry === undefined) {
        return ok(undefined);
      }

      try {
        return ok(input.cipher.decryptString(Buffer.from(entry.ciphertext, "base64")));
      } catch {
        return err(
          secretStoreError("MODEL_SECRET_DECRYPT_FAILED", "Stored model secret could not be read.")
        );
      }
    },
    async markVerified(secretRef, profile) {
      if (!isValidSecretRef(secretRef)) {
        return err(secretStoreError("MODEL_SECRET_INVALID", "Model secret reference is invalid."));
      }
      const file = await readSecretFile(secretsFile);
      if (!file.ok) {
        return file;
      }
      const existing = file.value.secrets[secretRef];
      if (existing === undefined) {
        return err(
          secretStoreError("MODEL_SECRET_NOT_FOUND", "No stored API key exists for this profile.")
        );
      }

      return writeSecretFile(secretsFile, {
        schemaVersion: "1.0",
        secrets: {
          ...file.value.secrets,
          [secretRef]: {
            ...existing,
            verifiedAt: now(),
            verificationFingerprint: profileFingerprint(profile)
          }
        }
      });
    },
    async isVerified(secretRef, profile) {
      if (!isValidSecretRef(secretRef)) {
        return err(secretStoreError("MODEL_SECRET_INVALID", "Model secret reference is invalid."));
      }
      const file = await readSecretFile(secretsFile);
      if (!file.ok) {
        return file;
      }
      const entry = file.value.secrets[secretRef];
      return ok(verificationMatchesProfile(entry?.verificationFingerprint, profile));
    }
  };
}

export function createDesktopModelRuntime(
  options: DesktopModelRuntimeOptions
): DesktopModelRuntime {
  const secretStore =
    options.secretStore ??
    createEncryptedFileModelSecretStore({
      userDataRoot: options.userDataRoot,
      cipher: fallbackUnavailableCipher
    });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const promptCacheResources = createGeminiPromptCacheResourceManager({
    userDataRoot: options.userDataRoot,
    fetch: fetchImpl
  });
  const pendingPromptCacheCleanup = new Set<Promise<void>>();
  const modelDiscoveryCache = new Map<string, ModelDiscoverySnapshot>();
  const schedulePromptCacheCleanup = (operation: Promise<void>): void => {
    const tracked = operation.catch(() => undefined);
    pendingPromptCacheCleanup.add(tracked);
    void tracked.finally(() => pendingPromptCacheCleanup.delete(tracked));
  };

  const transport: OpenAiCompatibleTransport = (request) =>
    postOpenAiCompatibleJson(fetchImpl, request);
  const streamTransport = (request: OpenAiCompatibleTransportRequest) =>
    streamOpenAiCompatibleJson(fetchImpl, request);
  const anthropicTransport: AnthropicTransport = (request) => postAnthropicJson(fetchImpl, request);
  const anthropicStreamTransport = (request: AnthropicTransportRequest) =>
    streamAnthropicJson(fetchImpl, request);
  const geminiTransport: GeminiTransport = (request) => postGeminiJson(fetchImpl, request);
  const geminiStreamTransport = (request: GeminiTransportRequest) =>
    streamGeminiJson(fetchImpl, request);

  const providerForSecret = (secret: string): LlmProvider =>
    createProviderRouter({
      providers: {
        "openai-compatible": createOpenAiCompatibleProvider({
          transport,
          streamTransport,
          resolveApiKey: async () => secret
        }),
        anthropic: createAnthropicProvider({
          transport: anthropicTransport,
          streamTransport: anthropicStreamTransport,
          resolveApiKey: async () => secret
        }),
        "google-gemini": createGeminiProvider({
          transport: geminiTransport,
          streamTransport: geminiStreamTransport,
          resolveApiKey: async () => secret
        })
      }
    });

  const runtime: DesktopModelRuntime = {
    modelConnectionTester: {
      async testConnection(profile) {
        const secret = await readProfileSecret(secretStore, profile);
        if (!secret.ok) {
          return ok(failedConnection(profile, secret.error.message));
        }
        if (secret.value === undefined) {
          return ok(failedConnection(profile, "No API key is stored for this model profile."));
        }

        if (!isModelProvider(profile.provider)) {
          return ok(failedConnection(profile, "The selected provider has no runtime adapter."));
        }

        try {
          await providerForSecret(secret.value).complete(connectionProbeRequest(profile));
          const marked = await secretStore.markVerified(profile.apiKeyRef, profile);
          if (!marked.ok) {
            return marked;
          }

          return ok({
            ok: true,
            provider: profile.provider,
            modelName: profile.modelName,
            detail: `Connected to ${profile.provider}/${profile.modelName}.`
          });
        } catch (error) {
          return ok(failedConnection(profile, connectionFailureMessage(error)));
        }
      }
    },
    modelDiscoveryPort: {
      async discoverModels(profile, discoveryOptions) {
        const secret = await readProfileSecret(secretStore, profile);
        if (!secret.ok) {
          return ok(createModelDiscoveryFallback(profile, secret.error.message));
        }
        if (secret.value === undefined) {
          return ok(
            createModelDiscoveryFallback(
              profile,
              "No API key is stored for this model profile. Enter the model name manually."
            )
          );
        }

        const cacheKey = modelDiscoveryCacheKey(profile, secret.value);
        const cached = modelDiscoveryCache.get(cacheKey);
        if (discoveryOptions?.forceRefresh !== true && cached !== undefined) return ok(cached);

        try {
          const models = await discoverProviderModels(fetchImpl, profile, secret.value);
          const snapshot = createModelDiscoverySnapshot({ profile, models });
          if (modelDiscoveryCache.size >= 64) {
            const oldestKey = modelDiscoveryCache.keys().next().value as string | undefined;
            if (oldestKey !== undefined) modelDiscoveryCache.delete(oldestKey);
          }
          modelDiscoveryCache.set(cacheKey, snapshot);
          return ok(snapshot);
        } catch (error) {
          return ok(createModelDiscoveryFallback(profile, connectionFailureMessage(error)));
        }
      }
    },
    createAiProvider(input) {
      const demoProvider = createDemoModeProvider(input.chapterEditorSession);

      return {
        id: "openai-compatible",
        async complete(request) {
          const secretRef = request.modelProfile.apiKeyRef;
          if (secretRef === undefined) {
            return demoProvider.complete(request);
          }
          const secret = await secretStore.readSecret(secretRef);
          if (!secret.ok) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: secret.error.message,
              retryable: false
            });
          }
          if (secret.value === undefined) {
            return demoProvider.complete(request);
          }
          const verified = await secretStore.isVerified(secretRef, request.modelProfile);
          if (!verified.ok) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: verified.error.message,
              retryable: false
            });
          }
          if (!verified.value) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: "Model profile API key has not passed a real connection test.",
              retryable: false
            });
          }

          return providerForSecret(secret.value).complete(withRuntimeBaseUrl(request));
        },
        async *stream(request) {
          const secretRef = request.modelProfile.apiKeyRef;
          if (secretRef === undefined) {
            yield* demoProvider.stream(request);
            return;
          }
          const secret = await secretStore.readSecret(secretRef);
          if (!secret.ok) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: secret.error.message,
              retryable: false
            });
          }
          if (secret.value === undefined) {
            yield* demoProvider.stream(request);
            return;
          }
          const verified = await secretStore.isVerified(secretRef, request.modelProfile);
          if (!verified.ok) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: verified.error.message,
              retryable: false
            });
          }
          if (!verified.value) {
            throw new LlmProviderFailure({
              code: "LLM_PROVIDER_ERROR",
              message: "Model profile API key has not passed a real connection test.",
              retryable: false
            });
          }

          yield* providerForSecret(secret.value).stream(withRuntimeBaseUrl(request));
        }
      };
    },
    createAgentModelDriver(input) {
      const provider = runtime.createAiProvider({
        chapterEditorSession: {} as ChapterEditorSession
      });
      return createLlmAgentRunModelDriver({
        adapter: createLlmAdapter({ provider }),
        modelProfile: input.modelProfile,
        resolvePromptCache: async (request) => {
          const config = request.promptCache;
          if (config === undefined || config.mode !== "explicit_resource") return config;
          if (
            request.modelProfile.provider !== "google-gemini" ||
            input.promptCacheScopeKey === undefined
          ) {
            return promptCacheBypass(config, "resource_unavailable");
          }
          const secretRef = request.modelProfile.apiKeyRef;
          if (secretRef === undefined) {
            return promptCacheBypass(config, "resource_unavailable");
          }
          const secret = await secretStore.readSecret(secretRef);
          if (!secret.ok || secret.value === undefined) {
            return promptCacheBypass(config, "resource_unavailable");
          }
          const verified = await secretStore.isVerified(secretRef, request.modelProfile);
          if (!verified.ok || !verified.value) {
            return promptCacheBypass(config, "resource_unavailable");
          }
          if (!matchesPromptCacheIdentity(config, request.modelProfile, secret.value)) {
            return promptCacheBypass(config, "identity_unverified");
          }
          return promptCacheResources.resolve({
            scopeKey: input.promptCacheScopeKey,
            request: withRuntimeBaseUrl(request),
            apiKey: secret.value
          });
        },
        ...(input.parameters === undefined ? {} : { parameters: input.parameters })
      } satisfies CreateLlmAgentRunModelDriverOptions);
    },
    releasePromptCacheScope(scopeKey) {
      schedulePromptCacheCleanup(promptCacheResources.releaseScope(scopeKey));
    },
    async dispose() {
      modelDiscoveryCache.clear();
      await promptCacheResources.dispose().catch(() => undefined);
      await Promise.all(pendingPromptCacheCleanup);
    }
  };

  return runtime;
}

function modelDiscoveryCacheKey(profile: ModelProfile, secret: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: profile.id,
        provider: profile.provider,
        modelName: profile.modelName,
        baseUrl: profile.baseUrl ?? null,
        reasoningEffortEnabled: profile.reasoningEffortEnabled === true,
        secret
      }),
      "utf8"
    )
    .digest("hex");
}

function promptCacheBypass(
  config: LlmPromptCacheRequest,
  bypassReason: NonNullable<LlmPromptCacheRequest["bypassReason"]>
): LlmPromptCacheRequest {
  const { resourceRef, physicalPrefixChecksum, resourceWriteTokens, ...base } = config;
  void resourceRef;
  void physicalPrefixChecksum;
  void resourceWriteTokens;
  return { ...base, bypassReason };
}

function matchesPromptCacheIdentity(
  config: LlmPromptCacheRequest,
  profile: LlmModelProfile,
  secret: string
): boolean {
  if (
    !isChecksum(config.connectionIdentityChecksum) ||
    !isChecksum(config.accountIsolationChecksum)
  ) {
    return false;
  }
  const connectionIdentityChecksum = createHash("sha256")
    .update(
      JSON.stringify({
        profileId: profile.id,
        provider: profile.provider.trim().toLowerCase(),
        modelName: profile.modelName,
        baseUrl: (profile.baseUrl ?? "").trim().replace(/\/+$/u, ""),
        apiKeyRef: profile.apiKeyRef ?? ""
      }),
      "utf8"
    )
    .digest("hex");
  const accountIsolationChecksum = createHash("sha256")
    .update(`provider-account\u0000${profile.provider}\u0000${secret}`, "utf8")
    .digest("hex");
  return (
    config.connectionIdentityChecksum === connectionIdentityChecksum &&
    config.accountIsolationChecksum === accountIsolationChecksum
  );
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function connectionProbeRequest(profile: ModelProfile): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: `connection_${profile.id}`,
    traceId: `connection_${profile.id}`,
    mode: "non-streaming",
    modelProfile: {
      id: profile.id,
      provider: profile.provider as LlmProviderId,
      displayName: profile.displayName,
      modelName: profile.modelName,
      baseUrl: requiredBaseUrl(profile),
      apiKeyRef: profile.apiKeyRef,
      timeoutMs: profile.timeoutMs
    },
    messages: [{ role: "user", content: "ping" }],
    parameters: { temperature: 0, maxTokens: 1 }
  };
}

function withRuntimeBaseUrl(request: LlmRequest): LlmRequest {
  if (request.modelProfile.baseUrl?.trim()) return request;
  const baseUrl = MODEL_PROVIDER_CATALOG.find(
    (entry) => entry.id === request.modelProfile.provider
  )?.defaultBaseUrl;
  return baseUrl === undefined
    ? request
    : { ...request, modelProfile: { ...request.modelProfile, baseUrl } };
}

async function discoverProviderModels(
  fetchImpl: typeof fetch,
  profile: ModelProfile,
  secret: string
): Promise<readonly ModelDiscoveryModelInput[]> {
  const baseUrl = requiredBaseUrl(profile).replace(/\/+$/, "");
  if (profile.provider === "anthropic") {
    const payload = await getOpenAiCompatibleJson(fetchImpl, {
      url: baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`,
      headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" },
      timeoutMs: profile.timeoutMs
    });
    return normalizeAnthropicModels(payload);
  }
  if (profile.provider === "google-gemini") {
    const payload = await getOpenAiCompatibleJson(fetchImpl, {
      url: `${baseUrl}/models`,
      headers: { "x-goog-api-key": secret },
      timeoutMs: profile.timeoutMs
    });
    return normalizeGeminiModels(payload);
  }
  const payload = await getOpenAiCompatibleJson(fetchImpl, {
    url: `${baseUrl}/models`,
    headers: { authorization: `Bearer ${secret}` },
    timeoutMs: profile.timeoutMs
  });
  return normalizeOpenAiCompatibleModels(payload, profile.provider);
}

async function postAnthropicJson(
  fetchImpl: typeof fetch,
  request: AnthropicTransportRequest
): Promise<unknown> {
  try {
    return await postOpenAiCompatibleJson(fetchImpl, request);
  } catch (error) {
    throw asAnthropicError(error);
  }
}

async function* streamAnthropicJson(
  fetchImpl: typeof fetch,
  request: AnthropicTransportRequest
): AsyncIterable<unknown> {
  try {
    yield* streamOpenAiCompatibleJson(fetchImpl, request);
  } catch (error) {
    throw asAnthropicError(error);
  }
}

function asAnthropicError(error: unknown): unknown {
  return error instanceof OpenAiCompatibleHttpError
    ? new AnthropicHttpError({
        status: error.status,
        message: error.message,
        ...(error.body === undefined ? {} : { body: error.body }),
        ...(error.headers === undefined ? {} : { headers: error.headers })
      })
    : error;
}

async function postGeminiJson(
  fetchImpl: typeof fetch,
  request: GeminiTransportRequest
): Promise<unknown> {
  try {
    return await postOpenAiCompatibleJson(fetchImpl, request);
  } catch (error) {
    throw asGeminiError(error);
  }
}

async function* streamGeminiJson(
  fetchImpl: typeof fetch,
  request: GeminiTransportRequest
): AsyncIterable<unknown> {
  try {
    yield* streamOpenAiCompatibleJson(fetchImpl, request);
  } catch (error) {
    throw asGeminiError(error);
  }
}

function asGeminiError(error: unknown): unknown {
  return error instanceof OpenAiCompatibleHttpError
    ? new GeminiHttpError({
        status: error.status,
        message: error.message,
        ...(error.body === undefined ? {} : { body: error.body }),
        ...(error.headers === undefined ? {} : { headers: error.headers })
      })
    : error;
}

async function* streamOpenAiCompatibleJson(
  fetchImpl: typeof fetch,
  request: OpenAiCompatibleTransportRequest
): AsyncIterable<unknown> {
  const timeoutController = new AbortController();
  const firstChunkController = new AbortController();
  const signal = combineAbortSignals(
    [request.abortSignal, timeoutController.signal, firstChunkController.signal].filter(
      (entry): entry is AbortSignal => entry !== undefined
    )
  );
  const timeout =
    request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => timeoutController.abort(), request.timeoutMs);
  const firstChunkTimeoutMs = Math.min(
    request.timeoutMs ?? DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
    DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS
  );
  const firstChunkTimeout = setTimeout(() => {
    firstChunkController.abort();
  }, firstChunkTimeoutMs);
  let firstSseChunkReceived = false;
  let receivedAnyBytes = false;
  let sawSseDataLine = false;

  const markFirstSseChunkReceived = () => {
    if (!firstSseChunkReceived) {
      firstSseChunkReceived = true;
      clearTimeout(firstChunkTimeout);
    }
  };

  try {
    if (request.abortSignal?.aborted === true) {
      return;
    }
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...stringHeaders(request.headers)
      },
      body: JSON.stringify(request.body),
      signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new OpenAiCompatibleHttpError({
        status: response.status,
        message: `Provider returned HTTP ${response.status}.`,
        body: parseProviderJsonPayload(response, text)
      });
    }
    if (response.body === null) {
      throw new OpenAiCompatibleHttpError({
        status: 502,
        message: "Provider returned an empty streaming response."
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      if (isAbortSignalAborted(request.abortSignal)) {
        void reader.cancel();
        return;
      }
      const read = await reader.read();
      if (read.done) {
        break;
      }
      receivedAnyBytes = read.value.byteLength > 0 || receivedAnyBytes;
      buffer += decoder.decode(read.value, { stream: true });
      const { parts, rest } = splitSseParts(buffer);
      buffer = rest;
      for (const part of parts) {
        sawSseDataLine = hasSseDataLine(part) || sawSseDataLine;
        const parsed = parseServerSentEventPart(part);
        if (parsed !== undefined) {
          markFirstSseChunkReceived();
          yield parsed;
        }
      }
    }
    buffer += decoder.decode();
    sawSseDataLine = hasSseDataLine(buffer) || sawSseDataLine;
    const parsed = parseServerSentEventPart(buffer);
    if (parsed !== undefined) {
      markFirstSseChunkReceived();
      yield parsed;
    }
    if (receivedAnyBytes && !sawSseDataLine) {
      throw new OpenAiCompatibleHttpError({
        status: 502,
        message: "Provider returned a non-SSE streaming response.",
        body: {
          bodyPreview: buffer.slice(0, 120)
        }
      });
    }
  } catch (error) {
    if (isAbortError(error)) {
      if (request.abortSignal?.aborted === true) {
        return;
      }
      if (
        !firstSseChunkReceived &&
        (firstChunkController.signal.aborted || timeoutController.signal.aborted)
      ) {
        throw new OpenAiCompatibleHttpError({
          status: 408,
          message: "Provider streaming response timed out before returning an SSE chunk."
        });
      }
      if (timeoutController.signal.aborted) {
        throw new OpenAiCompatibleHttpError({
          status: 408,
          message: "Provider streaming response timed out."
        });
      }
      return;
    }
    throw error;
  } finally {
    clearTimeout(firstChunkTimeout);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const [firstSignal, ...restSignals] = signals;
  if (firstSignal === undefined) {
    throw new Error("At least one abort signal is required.");
  }
  return restSignals.length === 0 ? firstSignal : AbortSignal.any([firstSignal, ...restSignals]);
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function splitSseParts(value: string): { readonly parts: string[]; readonly rest: string } {
  const parts: string[] = [];
  let start = 0;
  const delimiterPattern = /\r?\n\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = delimiterPattern.exec(value)) !== null) {
    parts.push(value.slice(start, match.index));
    start = match.index + match[0].length;
  }

  return {
    parts,
    rest: value.slice(start)
  };
}

function parseServerSentEventPart(part: string): unknown | undefined {
  const payload = part
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n")
    .trim();
  if (payload.length === 0 || payload === "[DONE]") {
    return undefined;
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Provider returned a malformed SSE data chunk.",
      body: {
        bodyPreview: payload.slice(0, 120)
      }
    });
  }
}

function hasSseDataLine(part: string): boolean {
  return part.split(/\r?\n/).some((line) => line.startsWith("data:"));
}

function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postOpenAiCompatibleJson(
  fetchImpl: typeof fetch,
  request: OpenAiCompatibleTransportRequest
): Promise<unknown> {
  const controller = new AbortController();
  const signal =
    request.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([request.abortSignal, controller.signal]);
  const timeout =
    request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...stringHeaders(request.headers)
      },
      body: JSON.stringify(request.body),
      signal
    });
    const text = await response.text();
    const payload = parseProviderJsonPayload(response, text);
    if (!response.ok) {
      throw new OpenAiCompatibleHttpError({
        status: response.status,
        message: `Provider returned HTTP ${response.status}.`,
        body: payload
      });
    }
    return payload;
  } catch (error) {
    if (isAbortError(error) && controller.signal.aborted && request.abortSignal?.aborted !== true) {
      throw new OpenAiCompatibleHttpError({
        status: 408,
        message: "Provider request timed out."
      });
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function getOpenAiCompatibleJson(
  fetchImpl: typeof fetch,
  request: Pick<OpenAiCompatibleTransportRequest, "url" | "headers" | "timeoutMs">
): Promise<unknown> {
  const controller = new AbortController();
  const timeout =
    request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: stringHeaders(request.headers),
      signal: controller.signal
    });
    const text = await response.text();
    const payload = parseProviderJsonPayload(response, text);
    if (!response.ok) {
      throw new OpenAiCompatibleHttpError({
        status: response.status,
        message: `Provider returned HTTP ${response.status}.`,
        body: payload
      });
    }
    return payload;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function normalizeOpenAiCompatibleModels(
  payload: unknown,
  provider: string
): readonly {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow?: number;
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly reasoningStrength?: ModelReasoningStrengthControl;
}[] {
  if (!isJsonRecord(payload) || !Array.isArray(payload["data"])) {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Provider returned a malformed model list.",
      body: payload
    });
  }

  return payload["data"]
    .filter(isJsonRecord)
    .map((entry) => {
      const id = stringValue(entry["id"]);
      if (id === undefined) {
        return undefined;
      }
      const contextWindow = optionalNumber(entry["context_window"] ?? entry["contextWindow"]);
      const streaming = capabilityBooleanFromModelMetadata(entry, [
        "streaming",
        "supports_streaming",
        "supportsStreaming"
      ]);
      const toolCalling = capabilityBooleanFromModelMetadata(entry, [
        "tool_calling",
        "toolCalling",
        "supports_tools",
        "supportsTools"
      ]);
      const structuredArguments = capabilityBooleanFromModelMetadata(entry, [
        "structured_arguments",
        "structuredArguments",
        "supports_structured_arguments",
        "supportsStructuredArguments"
      ]);
      const reasoningStrength = reasoningStrengthFromModelMetadata(entry, provider);
      return {
        id,
        displayName: id,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(typeof streaming === "boolean" ? { streaming } : {}),
        ...(typeof toolCalling === "boolean" ? { toolCalling } : {}),
        ...(typeof structuredArguments === "boolean" ? { structuredArguments } : {}),
        ...(reasoningStrength === undefined ? {} : { reasoningStrength })
      };
    })
    .filter((entry): entry is ModelDiscoveryModelInput => entry !== undefined);
}

function normalizeAnthropicModels(payload: unknown): readonly ModelDiscoveryModelInput[] {
  if (!isJsonRecord(payload) || !Array.isArray(payload["data"])) {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Anthropic returned a malformed model list.",
      body: payload
    });
  }
  return payload["data"].filter(isJsonRecord).flatMap((entry): ModelDiscoveryModelInput[] => {
    const id = stringValue(entry["id"]);
    if (id === undefined) return [];
    const displayName = stringValue(entry["display_name"]) ?? id;
    return [
      {
        id,
        displayName,
        streaming: true,
        toolCalling: true,
        structuredArguments: true
      }
    ];
  });
}

function normalizeGeminiModels(payload: unknown): readonly ModelDiscoveryModelInput[] {
  if (!isJsonRecord(payload) || !Array.isArray(payload["models"])) {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Gemini returned a malformed model list.",
      body: payload
    });
  }
  return payload["models"].filter(isJsonRecord).flatMap((entry): ModelDiscoveryModelInput[] => {
    const resourceName = stringValue(entry["name"]);
    if (resourceName === undefined) return [];
    const id = resourceName.startsWith("models/")
      ? resourceName.slice("models/".length)
      : resourceName;
    if (id.length === 0) return [];
    const methods = Array.isArray(entry["supportedGenerationMethods"])
      ? entry["supportedGenerationMethods"].filter(
          (method): method is string => typeof method === "string"
        )
      : [];
    const supportsGeneration = methods.length === 0 || methods.includes("generateContent");
    const contextWindow = optionalNumber(entry["inputTokenLimit"]);
    return [
      {
        id,
        displayName: stringValue(entry["displayName"]) ?? id,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        streaming: supportsGeneration,
        toolCalling: supportsGeneration,
        structuredArguments: supportsGeneration
      }
    ];
  });
}

function capabilityBooleanFromModelMetadata(
  entry: JsonObject,
  keys: readonly string[]
): boolean | "conflicting" | undefined {
  const declarations: boolean[] = [];
  for (const key of keys) {
    if (typeof entry[key] === "boolean") declarations.push(entry[key]);
  }
  for (const nestedKey of ["capabilities", "metadata"]) {
    const nested = entry[nestedKey];
    if (!isJsonRecord(nested)) continue;
    for (const key of keys) {
      if (typeof nested[key] === "boolean") declarations.push(nested[key]);
    }
  }
  const uniqueDeclarations = [...new Set(declarations)];
  if (uniqueDeclarations.length > 1) return "conflicting";
  return uniqueDeclarations[0];
}

/** Normalize common provider metadata spellings into one model capability shape. */
function reasoningStrengthFromModelMetadata(
  entry: JsonObject,
  provider: string
): ModelReasoningStrengthControl | undefined {
  const normalizedProvider = provider.trim().toLowerCase();

  const reasoningValueKeys = [
    "reasoning_efforts",
    "supported_reasoning_efforts",
    "reasoningEfforts",
    "supportedReasoningEfforts",
    "reasoning_effort_values",
    "reasoningEffortValues",
    "reasoning_effort_options",
    "reasoningEffortOptions",
    "reasoning_options",
    "reasoningOptions"
  ] as const;
  const candidates: unknown[] = [
    entry["reasoning_efforts"],
    entry["supported_reasoning_efforts"],
    entry["reasoningEfforts"],
    entry["supportedReasoningEfforts"],
    entry["reasoning_effort_values"],
    entry["reasoningEffortValues"],
    entry["reasoning_effort_options"],
    entry["reasoningEffortOptions"],
    entry["reasoning_options"],
    entry["reasoningOptions"],
    entry["reasoning_effort"],
    entry["reasoning"]
  ];
  const supportedParameters = consistentStringArrayMetadata(entry, [
    "supported_parameters",
    "supportedParameters"
  ]);
  if (supportedParameters.conflicting) return hiddenProviderReasoningMetadata();
  const declaresReasoningParameter = supportedParameters.values.some((value) =>
    /^(?:reasoning|reasoning_effort)$/i.test(value)
  );
  if (
    normalizedProvider === "openrouter" &&
    supportedParameters.declared &&
    !declaresReasoningParameter
  ) {
    return hiddenProviderReasoningMetadata("Provider metadata marks reasoning as unsupported.");
  }
  const reasoningSupported = capabilityBooleanFromModelMetadata(entry, [
    "supports_reasoning",
    "supportsReasoning",
    "reasoning_supported",
    "reasoningSupported",
    "supports_thinking",
    "supportsThinking"
  ]);
  if (reasoningSupported === "conflicting") {
    return hiddenProviderReasoningMetadata();
  }
  if (reasoningSupported === false) {
    return hiddenProviderReasoningMetadata("Provider metadata marks reasoning as unsupported.");
  }
  let sawReasoningMetadata = hasReasoningMetadataKeys(entry, reasoningValueKeys);
  const nestedDefaults: string[] = [];
  for (const nestedKey of [
    "reasoning",
    "reasoning_effort",
    "reasoningEffort",
    "capabilities",
    "metadata",
    "reasoning_capabilities",
    "reasoningCapabilities",
    "thinking"
  ]) {
    const nested = entry[nestedKey];
    if (!isJsonRecord(nested)) continue;
    const semanticContainer = nestedKey !== "capabilities" && nestedKey !== "metadata";
    if (semanticContainer || hasReasoningMetadataKeys(nested, reasoningValueKeys)) {
      sawReasoningMetadata = true;
    }
    candidates.push(
      ...(semanticContainer
        ? [
            nested["allowedValues"],
            nested["allowed_values"],
            nested["values"],
            nested["options"],
            nested["levels"],
            nested["efforts"],
            nested["supported_values"],
            nested["supportedValues"]
          ]
        : []),
      ...reasoningValueKeys.map((key) => nested[key])
    );
    nestedDefaults.push(
      ...(semanticContainer
        ? stringDeclarations(nested, ["defaultValue", "default_value", "default"])
        : []),
      ...stringDeclarations(nested, ["defaultReasoningEffort", "default_reasoning_effort"]),
      ...defaultParameterDeclarations(nested)
    );

    for (const childKey of ["reasoning", "thinking", "reasoning_effort", "reasoningEffort"]) {
      const child = nested[childKey];
      if (!isJsonRecord(child)) continue;
      sawReasoningMetadata = true;
      candidates.push(
        child["allowedValues"],
        child["allowed_values"],
        child["values"],
        child["options"],
        child["levels"],
        child["efforts"],
        child["supported_values"],
        child["supportedValues"],
        ...reasoningValueKeys.map((key) => child[key])
      );
      nestedDefaults.push(
        ...stringDeclarations(child, [
          "defaultValue",
          "default_value",
          "default",
          "defaultReasoningEffort",
          "default_reasoning_effort"
        ]),
        ...defaultParameterDeclarations(child)
      );
    }
  }

  const allowedValueCandidates = candidates
    .map(readReasoningValues)
    .filter((values) => values.length > 0);
  const uniqueAllowedValueSets = [
    ...new Set(allowedValueCandidates.map((values) => JSON.stringify(values)))
  ];
  if (uniqueAllowedValueSets.length === 0) {
    return sawReasoningMetadata ? hiddenProviderReasoningMetadata() : undefined;
  }
  if (uniqueAllowedValueSets.length > 1) return hiddenProviderReasoningMetadata();
  const allowedValues = allowedValueCandidates[0];
  if (allowedValues === undefined) return hiddenProviderReasoningMetadata();
  const itemDefaults = candidates
    .map(readReasoningDefault)
    .filter((value): value is string => value !== undefined);
  const defaultCandidates = [
    ...stringDeclarations(entry, [
      "default_reasoning_effort",
      "defaultReasoningEffort",
      "reasoning_effort_default",
      "reasoningEffortDefault"
    ]),
    ...defaultParameterDeclarations(entry),
    ...nestedDefaults,
    ...itemDefaults
  ];
  const uniqueDefaults = [...new Set(defaultCandidates)];
  if (uniqueDefaults.length !== 1) return hiddenProviderReasoningMetadata();
  const defaultCandidate = uniqueDefaults[0];
  if (defaultCandidate === undefined || !allowedValues.includes(defaultCandidate)) {
    return hiddenProviderReasoningMetadata();
  }
  const providerParamName = reasoningProviderParamName(entry, normalizedProvider);
  if (providerParamName === undefined) {
    return hiddenProviderReasoningMetadata(
      "Provider reasoning metadata does not match the configured adapter protocol."
    );
  }
  return {
    status: "available",
    providerParamName,
    allowedValues,
    defaultValue: defaultCandidate
  };
}

function hasReasoningMetadataKeys(
  value: JsonObject,
  reasoningValueKeys: readonly string[]
): boolean {
  return [
    ...reasoningValueKeys,
    "reasoning",
    "reasoning_effort",
    "reasoningEffort",
    "thinking",
    "reasoning_capabilities",
    "reasoningCapabilities",
    "default_reasoning_effort",
    "defaultReasoningEffort",
    "reasoning_effort_default",
    "reasoningEffortDefault",
    "providerParamName",
    "provider_param_name",
    "reasoningProviderParamName",
    "reasoning_provider_param_name"
  ].some((key) => Object.hasOwn(value, key));
}

function hiddenProviderReasoningMetadata(
  reason = "Provider reasoning metadata is incomplete or conflicting."
): ModelReasoningStrengthControl {
  return { status: "hidden", reason };
}

function reasoningProviderParamName(
  entry: JsonObject,
  provider: string
): ModelReasoningStrengthAvailable["providerParamName"] | undefined {
  const explicit = [
    stringValue(entry["providerParamName"]),
    stringValue(entry["provider_param_name"]),
    stringValue(entry["reasoningProviderParamName"]),
    stringValue(entry["reasoning_provider_param_name"])
  ].filter((value): value is string => value !== undefined);
  const uniqueExplicitValues = [...new Set(explicit)];
  if (uniqueExplicitValues.length > 1) return undefined;
  const explicitValue = uniqueExplicitValues[0];
  if (explicitValue !== undefined) {
    if (explicitValue === "reasoning_effort" || explicitValue === "reasoning") {
      return reasoningProviderParamMatchesAdapter(provider, explicitValue)
        ? explicitValue
        : undefined;
    }
    return undefined;
  }
  if (provider === "openrouter") return "reasoning";
  return "reasoning_effort";
}

function reasoningProviderParamMatchesAdapter(
  provider: string,
  providerParamName: ModelReasoningStrengthAvailable["providerParamName"]
): boolean {
  if (provider === "openrouter") return providerParamName === "reasoning";
  return providerParamName === "reasoning_effort";
}

function readReasoningValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isJsonRecord(item)) return undefined;
      return (
        stringValue(item["value"]) ??
        stringValue(item["id"]) ??
        stringValue(item["reasoning_effort"]) ??
        stringValue(item["effort"]) ??
        stringValue(item["level"])
      );
    })
    .filter((item): item is string => item !== undefined && item.length > 0);
  return [...new Set(values)];
}

function readReasoningDefault(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (!isJsonRecord(item)) continue;
    if (item["default"] !== true && item["is_default"] !== true && item["isDefault"] !== true) {
      continue;
    }
    return (
      stringValue(item["value"]) ??
      stringValue(item["id"]) ??
      stringValue(item["reasoning_effort"]) ??
      stringValue(item["effort"]) ??
      stringValue(item["level"])
    );
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : [];
}

function consistentStringArrayMetadata(
  value: JsonObject,
  keys: readonly string[]
): { readonly declared: boolean; readonly conflicting: boolean; readonly values: string[] } {
  const declarations = keys.flatMap((key) => (Object.hasOwn(value, key) ? [value[key]] : []));
  if (declarations.length === 0) {
    return { declared: false, conflicting: false, values: [] };
  }
  if (
    declarations.some(
      (declaration) =>
        !Array.isArray(declaration) || declaration.some((item) => typeof item !== "string")
    )
  ) {
    return { declared: true, conflicting: true, values: [] };
  }
  const normalized = declarations.map((declaration) =>
    [...new Set(readStringArray(declaration).map((item) => item.toLowerCase()))].sort()
  );
  const signatures = new Set(normalized.map((declaration) => JSON.stringify(declaration)));
  return {
    declared: true,
    conflicting: signatures.size > 1,
    values: normalized[0] ?? []
  };
}

function stringDeclarations(value: JsonObject, keys: readonly string[]): string[] {
  return keys
    .map((key) => stringValue(value[key]))
    .filter((item): item is string => item !== undefined);
}

function defaultParameterDeclarations(value: JsonObject): string[] {
  return ["default_parameters", "defaultParameters"].flatMap((key) => {
    const parameters = value[key];
    return isJsonRecord(parameters)
      ? stringDeclarations(parameters, ["reasoning_effort", "reasoningEffort", "reasoning"])
      : [];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseProviderJsonPayload(response: Response, text: string): unknown {
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    const statusLabel = response.ok ? "" : `HTTP ${response.status} `;
    throw new OpenAiCompatibleHttpError({
      status: response.status,
      message: `Provider returned ${statusLabel}with a non-JSON response. Check the Base URL; it should be the provider API endpoint, not a web page or console URL.`,
      body: {
        contentType,
        bodyPreview: text.slice(0, 120)
      }
    });
  }
}

async function readProfileSecret(
  secretStore: ModelSecretStore,
  profile: ModelProfile
): Promise<Result<string | undefined, UnifiedError>> {
  if (!isValidSecretRef(profile.apiKeyRef)) {
    return err(secretStoreError("MODEL_SECRET_INVALID", "Model secret reference is invalid."));
  }
  return secretStore.readSecret(profile.apiKeyRef);
}

function requiredBaseUrl(profile: ModelProfile): string {
  const configured = profile.baseUrl?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  const defaultBaseUrl = MODEL_PROVIDER_CATALOG.find(
    (entry) => entry.id === profile.provider
  )?.defaultBaseUrl;
  if (defaultBaseUrl === undefined) {
    throw new OpenAiCompatibleHttpError({
      status: 400,
      message: "The selected model provider requires a Base URL."
    });
  }
  return defaultBaseUrl;
}

function failedConnection(profile: ModelProfile, detail: string) {
  return {
    ok: false,
    provider: profile.provider,
    modelName: profile.modelName,
    detail
  };
}

function connectionFailureMessage(error: unknown): string {
  if (error instanceof OpenAiCompatibleHttpError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.name === "AbortError" ? "Connection timed out." : error.message;
  }
  return "Connection failed.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readSecretFile(path: string): Promise<Result<SecretFile, UnifiedError>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as SecretFile;
    return ok({
      schemaVersion: "1.0",
      secrets: parsed.secrets ?? {}
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok({ schemaVersion: "1.0", secrets: {} });
    }
    return err(
      secretStoreError("MODEL_SECRET_READ_FAILED", "Stored model secrets could not be read.")
    );
  }
}

async function writeSecretFile(
  path: string,
  file: SecretFile
): Promise<Result<void, UnifiedError>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
    return ok(undefined);
  } catch {
    return err(
      secretStoreError("MODEL_SECRET_WRITE_FAILED", "Stored model secrets could not be written.")
    );
  }
}

function createDemoModeProvider(chapterEditorSession: ChapterEditorSession): LlmProvider {
  const currentBody = (): string => chapterEditorSession.getState?.()?.chapter.body ?? "";

  return {
    id: "mock",
    async complete(request) {
      const body = currentBody();
      const separator = body.endsWith("\n") || body.length === 0 ? "" : "\n";
      const selectedText = demoSelectionText(request);
      const isForeshadowAnalysis = request.traceId === "foreshadow-analysis";
      return {
        content: {
          type: "json",
          value: isForeshadowAnalysis
            ? { candidates: [] }
            : selectedText === undefined
              ? {
                  proposedBody: `${body}${separator}AI continuation draft.\n`,
                  summary: "当前是演示模式，未配置真实Key。"
                }
              : {
                  proposedText: `${selectedText} AI rewrite.`,
                  summary: "当前是演示模式，未配置真实Key。"
                }
        },
        usage: {
          inputTokens: 16,
          outputTokens: 8,
          totalTokens: 24,
          usageStatus: "estimated",
          cost: { amount: 0, currency: "USD", status: "estimated" }
        }
      };
    },
    async *stream() {
      const body = currentBody();
      const separator = body.endsWith("\n") || body.length === 0 ? "" : "\n";
      yield {
        type: "delta",
        value: JSON.stringify({
          proposedBody: `${body}${separator}AI continuation draft.\n`,
          summary: "Generated a local mock continuation for review."
        })
      };
    }
  };
}

function demoSelectionText(request: LlmRequest): string | undefined {
  if (request.traceId !== "ai-selection-preview") return undefined;
  const marker = "Selected text: ";
  for (const message of [...request.messages].reverse()) {
    if (message.role !== "user") continue;
    const markerIndex = message.content.lastIndexOf(marker);
    if (markerIndex !== -1) return message.content.slice(markerIndex + marker.length);
  }
  return undefined;
}

function stringHeaders(headers: JsonObject | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function profileFingerprint(profile: ModelProfileVerificationInput): string {
  return JSON.stringify({
    provider: profile.provider,
    baseUrl: verificationBaseUrl(profile.baseUrl)
  });
}

function verificationMatchesProfile(
  fingerprint: string | undefined,
  profile: ModelProfileVerificationInput
): boolean {
  if (fingerprint === undefined) return false;
  if (fingerprint === profileFingerprint(profile)) return true;

  // Pre-1.0 entries also recorded modelName. Retain their verified endpoint state when users switch
  // to another model served by the same provider and Base URL.
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    return (
      isJsonRecord(parsed) &&
      parsed["provider"] === profile.provider &&
      typeof parsed["baseUrl"] === "string" &&
      verificationBaseUrl(parsed["baseUrl"]) === verificationBaseUrl(profile.baseUrl)
    );
  } catch {
    return false;
  }
}

function verificationBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

function isValidSecretRef(value: string): boolean {
  return value.startsWith("secret://") && value.length > "secret://".length;
}

function secretStoreError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message,
    recoverability: "user-action",
    suggestedAction: "Save the API key again from Settings and retry.",
    traceId: "desktop-model-runtime"
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const fallbackUnavailableCipher: DesktopSecretCipher = {
  isEncryptionAvailable: () => false,
  encryptString() {
    throw new Error("Encryption unavailable.");
  },
  decryptString() {
    throw new Error("Encryption unavailable.");
  }
};

const DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000;
