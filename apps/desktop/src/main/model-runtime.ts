import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ChapterEditorSession,
  ModelDiscoveryPort,
  ModelConnectionTester,
  ModelProfile
} from "@novel-studio/application";
import {
  createModelDiscoveryFallback,
  createModelDiscoverySnapshot
} from "@novel-studio/application";
import {
  createOpenAiCompatibleProvider,
  createProviderRouter,
  LlmProviderFailure,
  OpenAiCompatibleHttpError,
  type LlmProvider,
  type LlmProviderStreamEvent,
  type LlmRequest,
  type LlmUsage,
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
      return ok(entry?.verificationFingerprint === profileFingerprint(profile));
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

  const transport: OpenAiCompatibleTransport = (request) =>
    postOpenAiCompatibleJson(fetchImpl, request);
  const streamTransport = (request: OpenAiCompatibleTransportRequest) =>
    streamOpenAiCompatibleJson(fetchImpl, request);

  return {
    modelConnectionTester: {
      async testConnection(profile) {
        const secret = await readProfileSecret(secretStore, profile);
        if (!secret.ok) {
          return ok(failedConnection(profile, secret.error.message));
        }
        if (secret.value === undefined) {
          return ok(failedConnection(profile, "No API key is stored for this model profile."));
        }

        try {
          await postOpenAiCompatibleJson(fetchImpl, {
            url: `${requiredBaseUrl(profile).replace(/\/+$/, "")}/chat/completions`,
            headers: {
              authorization: `Bearer ${secret.value}`
            },
            body: {
              model: profile.modelName,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              temperature: 0,
              stream: false
            },
            timeoutMs: profile.timeoutMs
          });
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
      async discoverModels(profile) {
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

        try {
          const payload = await getOpenAiCompatibleJson(fetchImpl, {
            url: `${requiredBaseUrl(profile).replace(/\/+$/, "")}/models`,
            headers: {
              authorization: `Bearer ${secret.value}`
            },
            timeoutMs: profile.timeoutMs
          });
          return ok(
            createModelDiscoverySnapshot({
              profile,
              models: normalizeOpenAiCompatibleModels(payload)
            })
          );
        } catch (error) {
          return ok(createModelDiscoveryFallback(profile, connectionFailureMessage(error)));
        }
      }
    },
    createAiProvider(input) {
      const realProvider = createProviderRouter({
        providers: {
          "openai-compatible": createOpenAiCompatibleProvider({
            transport,
            streamTransport,
            resolveApiKey: async (secretRef) => {
              const secret = await secretStore.readSecret(secretRef);
              if (!secret.ok) {
                throw new LlmProviderFailure({
                  code: "LLM_PROVIDER_ERROR",
                  message: secret.error.message,
                  retryable: false
                });
              }
              if (secret.value === undefined) {
                return undefined;
              }
              return secret.value;
            }
          })
        }
      });
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

          const verifiedProvider = createProviderRouter({
            providers: {
              "openai-compatible": createOpenAiCompatibleProvider({
                transport,
                resolveApiKey: async () => secret.value
              })
            }
          });

          return verifiedProvider.complete(request);
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

          yield* streamVerifiedOpenAiCompatibleRequest(fetchImpl, request, secret.value);
        }
      };
    }
  };
}

async function* streamVerifiedOpenAiCompatibleRequest(
  fetchImpl: typeof fetch,
  request: LlmRequest,
  apiKey: string
): AsyncIterable<LlmProviderStreamEvent> {
  const baseUrl = request.modelProfile.baseUrl;
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    throw new OpenAiCompatibleHttpError({
      status: 400,
      message: "OpenAI-compatible model profiles require a Base URL."
    });
  }

  const body: JsonObject = {
    model: request.modelProfile.modelName,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    stream: true
  };
  if (request.parameters.temperature !== undefined) {
    body.temperature = request.parameters.temperature;
  }
  if (request.parameters.maxTokens !== undefined) {
    body.max_tokens = request.parameters.maxTokens;
  }
  if (request.parameters.topP !== undefined) {
    body.top_p = request.parameters.topP;
  }

  for await (const chunk of streamOpenAiCompatibleJson(fetchImpl, {
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body,
    ...(request.modelProfile.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.modelProfile.timeoutMs }),
    ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
  })) {
    for (const event of parseOpenAiCompatibleStreamEvent(chunk)) {
      yield event;
    }
  }
}

async function* streamOpenAiCompatibleJson(
  fetchImpl: typeof fetch,
  request: OpenAiCompatibleTransportRequest
): AsyncIterable<unknown> {
  const timeoutController = new AbortController();
  const signal = combineAbortSignals(request.abortSignal, timeoutController.signal);
  const timeout =
    request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => timeoutController.abort(), request.timeoutMs);

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
      return;
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
      buffer += decoder.decode(read.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const parsed = parseServerSentEventPart(part);
        if (parsed !== undefined) {
          yield parsed;
        }
      }
    }
    buffer += decoder.decode();
    const parsed = parseServerSentEventPart(buffer);
    if (parsed !== undefined) {
      yield parsed;
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function combineAbortSignals(
  requestSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal
): AbortSignal {
  if (requestSignal === undefined) {
    return timeoutSignal;
  }
  return AbortSignal.any([requestSignal, timeoutSignal]);
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
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
  return JSON.parse(payload) as unknown;
}

function parseOpenAiCompatibleStreamEvent(chunk: unknown): readonly LlmProviderStreamEvent[] {
  if (!isJsonRecord(chunk)) {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Provider returned a malformed streaming chunk.",
      body: chunk
    });
  }
  const choices = chunk["choices"];
  if (!Array.isArray(choices)) {
    throw new OpenAiCompatibleHttpError({
      status: 502,
      message: "Provider returned a streaming chunk without choices.",
      body: chunk
    });
  }

  const events: LlmProviderStreamEvent[] = [];
  for (const choice of choices) {
    if (!isJsonRecord(choice)) {
      continue;
    }
    const delta = choice["delta"];
    if (!isJsonRecord(delta)) {
      continue;
    }
    const content = delta["content"];
    if (typeof content === "string" && content.length > 0) {
      events.push({
        type: "delta",
        value: content
      });
    }
  }

  const usage = parseOpenAiCompatibleUsage(chunk["usage"]);
  if (usage !== undefined) {
    events.push({
      type: "usage",
      usage
    });
  }
  return events;
}

function parseOpenAiCompatibleUsage(value: unknown): LlmUsage | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  const inputTokens = numberValue(value["prompt_tokens"]);
  const outputTokens = numberValue(value["completion_tokens"]);
  const totalTokens = numberValue(value["total_tokens"]) ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageStatus: "actual",
    cost: {
      amount: 0,
      currency: "USD",
      status: "unknown"
    }
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postOpenAiCompatibleJson(
  fetchImpl: typeof fetch,
  request: OpenAiCompatibleTransportRequest
): Promise<unknown> {
  const controller = new AbortController();
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
  payload: unknown
): readonly { readonly id: string; readonly displayName: string; readonly contextWindow?: number }[] {
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
      return {
        id,
        displayName: id,
        ...(contextWindow === undefined ? {} : { contextWindow })
      };
    })
    .filter((entry): entry is { id: string; displayName: string; contextWindow?: number } =>
      entry !== undefined
    );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  if (profile.baseUrl === undefined || profile.baseUrl.trim().length === 0) {
    throw new OpenAiCompatibleHttpError({
      status: 400,
      message: "OpenAI-compatible model profiles require a Base URL."
    });
  }
  return profile.baseUrl;
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
  return {
    id: "mock",
    async complete() {
      const currentBody = chapterEditorSession.getState()?.chapter.body ?? "";
      const separator = currentBody.endsWith("\n") || currentBody.length === 0 ? "" : "\n";
      return {
        content: {
          type: "json",
          value: {
            proposedBody: `${currentBody}${separator}AI continuation draft.\n`,
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
      yield { type: "delta", value: "当前是演示模式，未配置真实Key。" };
    }
  };
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
    baseUrl: profile.baseUrl ?? "",
    modelName: profile.modelName
  });
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
