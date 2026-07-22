import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  createChapterEditorSession,
  type AiWritingSuggestion,
  type ChapterEditorSession
} from "@novel-studio/application";
import type { LlmProviderStreamEvent, LlmRequest } from "@novel-studio/llm-adapter";
import type { Result, UnifiedError } from "@novel-studio/shared";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import {
  createDesktopModelRuntime,
  createEncryptedFileModelSecretStore,
  type DesktopSecretCipher
} from "../src/main/model-runtime.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const tempRoots: string[] = [];
const apiKeyRef = "secret://model_deepseek/api_key";

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M95 real provider runtime", () => {
  test("stores model API keys as encrypted secret material instead of settings plaintext", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-secrets-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });

    const saved = await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    expect(saved).toEqual({ ok: true, value: undefined });

    const secretFile = await readFile(join(userDataRoot, "secrets", "model-secrets.json"), "utf8");
    expect(secretFile).toContain(apiKeyRef);
    expect(secretFile).not.toContain("sk-real-deepseek-key");

    const restored = await secretStore.readSecret(apiKeyRef);
    expect(restored).toEqual({ ok: true, value: "sk-real-deepseek-key" });
  });

  test("keeps a verified API key valid when switching models on the same endpoint", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-secrets-switch-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      modelName: "first-model"
    });

    await expect(
      secretStore.isVerified(apiKeyRef, {
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1/",
        modelName: "second-model"
      })
    ).resolves.toEqual({ ok: true, value: true });
    await expect(
      secretStore.isVerified(apiKeyRef, {
        provider: "openai-compatible",
        baseUrl: "https://other.example.com/v1",
        modelName: "second-model"
      })
    ).resolves.toEqual({ ok: true, value: false });
  });

  test("tests model connections by sending a real OpenAI-compatible request with the stored key", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-test-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createJsonFetch(calls, {
        id: "chatcmpl_test",
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    });

    const tested = await runtime.modelConnectionTester.testConnection(createDeepSeekProfile());

    expect(tested).toMatchObject({
      ok: true,
      value: {
        ok: true,
        provider: "deepseek",
        modelName: "deepseek-chat"
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer sk-real-deepseek-key"
    });
    expect(calls[0]?.body).toMatchObject({
      model: "deepseek-chat",
      stream: false
    });
    const verified = await secretStore.isVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    expect(verified).toEqual({ ok: true, value: true });
  });

  test("reports non-JSON provider responses as actionable Base URL errors", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-html-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: (async () =>
        new Response("<!doctype html><html><body>Wrong endpoint</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch
    });

    const tested = await runtime.modelConnectionTester.testConnection(createDeepSeekProfile());

    expect(tested).toMatchObject({
      ok: true,
      value: {
        ok: false,
        provider: "deepseek",
        modelName: "deepseek-chat",
        detail: expect.stringContaining("non-JSON response")
      }
    });
    expect(JSON.stringify(tested)).not.toContain("Unexpected token");
  });

  test("discovers OpenAI-compatible models through the stored key and /models endpoint", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-models-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createModelsFetch(calls, {
        data: [
          {
            id: "deepseek-chat",
            object: "model",
            context_window: 64000,
            capabilities: {
              streaming: true,
              tool_calling: true,
              structured_arguments: true
            }
          },
          {
            id: "deepseek-reasoner",
            object: "model",
            supported_reasoning_efforts: ["low", "high", "max"],
            default_reasoning_effort: "max"
          }
        ]
      })
    });

    const discovered = await runtime.modelDiscoveryPort.discoverModels(createDeepSeekProfile());

    expect(discovered).toMatchObject({
      ok: true,
      value: {
        profileId: "model_deepseek",
        provider: "deepseek",
        status: "loaded",
        models: [
          {
            id: "deepseek-chat",
            displayName: "deepseek-chat",
            provider: "deepseek",
            contextWindow: 64000,
            streaming: true,
            toolCalling: true,
            structuredArguments: true
          },
          {
            id: "deepseek-reasoner",
            displayName: "deepseek-reasoner",
            provider: "deepseek",
            reasoningStrength: {
              status: "available",
              providerParamName: "reasoning_effort",
              allowedValues: ["low", "high", "max"],
              defaultValue: "max"
            }
          }
        ],
        reasoningStrength: {
          status: "hidden"
        }
      }
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.deepseek.com/v1/models",
      method: "GET",
      headers: {
        authorization: "Bearer sk-real-deepseek-key"
      }
    });
    expect(JSON.stringify(discovered)).not.toContain("secret://model_deepseek/api_key");
  });

  test("falls back to manual model entry when provider model discovery fails", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-models-fallback-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: (async () =>
        new Response("<!doctype html><html><body>Wrong endpoint</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch
    });

    const discovered = await runtime.modelDiscoveryPort.discoverModels(createDeepSeekProfile());

    expect(discovered).toMatchObject({
      ok: true,
      value: {
        profileId: "model_deepseek",
        provider: "deepseek",
        status: "fallback",
        models: [],
        reasoningStrength: {
          status: "hidden"
        }
      }
    });
    expect(discovered.ok && discovered.value.fallbackReason).toContain("non-JSON response");
    expect(JSON.stringify(discovered)).not.toContain("sk-real-deepseek-key");
  });

  test("routes default AI suggestions through the real provider after the profile key is verified", async () => {
    const projectRoot = await copyDeepSeekProject();
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-real-provider-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createJsonFetch(calls, {
        id: "chatcmpl_real",
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposedBody: "Real provider continuation.\n",
                summary: "Returned by the configured DeepSeek provider."
              })
            }
          }
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
      })
    });
    const application = createProjectDesktopApplication({
      projectRoot,
      userDataRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => "2026-07-07T00:00:00.000Z",
      modelConnectionTester: runtime.modelConnectionTester,
      createAiProvider: runtime.createAiProvider
    });
    const loaded = await application.loadActiveChapter();
    assertOk(loaded);

    const generated = await application.generateActiveChapterSuggestion({
      instruction: "Continue through real provider."
    });

    assertOk<AiWritingSuggestion>(generated);
    expect(generated.value.summary).toBe("Returned by the configured DeepSeek provider.");
    expect(generated.value.observability.model.provider).toBe("deepseek");
    expect(generated.value.proposedBody).not.toContain("AI continuation draft.");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer sk-real-deepseek-key"
    });
  });

  test("streams through demo mode when the profile key has not been stored", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-stream-demo-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore: createEncryptedFileModelSecretStore({
        userDataRoot,
        cipher: testCipher
      }),
      fetch: createJsonFetch(calls, {})
    });
    const chapterEditorSession = await createLoadedChapterEditorSession();
    const provider = runtime.createAiProvider({
      chapterEditorSession
    });

    const events = await collectProviderStream(provider.stream(streamingRequest()));

    expect(events).toEqual([
      {
        type: "delta",
        value: JSON.stringify({
          proposedBody: "Opening line.\nAI continuation draft.\n",
          summary: "Generated a local mock continuation for review."
        })
      }
    ]);
    expect(calls).toEqual([]);
  });

  test("keeps demo Agent streaming safe when no editor session is available", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-demo-safe-"));
    tempRoots.push(userDataRoot);
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore: createEncryptedFileModelSecretStore({
        userDataRoot,
        cipher: testCipher
      })
    });
    const provider = runtime.createAiProvider({
      chapterEditorSession: {} as ChapterEditorSession
    });

    await expect(collectProviderStream(provider.stream(streamingRequest()))).resolves.toEqual([
      {
        type: "delta",
        value: JSON.stringify({
          proposedBody: "AI continuation draft.\n",
          summary: "Generated a local mock continuation for review."
        })
      }
    ]);
  });

  test("returns the selection response schema through demo mode", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-selection-demo-"));
    tempRoots.push(userDataRoot);
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore: createEncryptedFileModelSecretStore({
        userDataRoot,
        cipher: testCipher
      })
    });
    const chapterEditorSession = await createLoadedChapterEditorSession();
    const provider = runtime.createAiProvider({ chapterEditorSession });

    const completed = await provider.complete(selectionRequest());

    expect(completed.content).toEqual({
      type: "json",
      value: {
        proposedText: "Opening line. AI rewrite.",
        summary: "当前是演示模式，未配置真实Key。"
      }
    });
  });

  test("streams through a verified OpenAI-compatible profile and aborts the fetch when cancelled", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-stream-real-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    const controller = new AbortController();
    const calls: FetchCall[] = [];
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createStreamingFetch(calls)
    });
    const chapterEditorSession = await createLoadedChapterEditorSession();
    const provider = runtime.createAiProvider({
      chapterEditorSession
    });
    const stream = provider.stream({
      ...streamingRequest(),
      abortSignal: controller.signal
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "delta",
        value: "The city"
      }
    });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await iterator.return?.();

    expect(calls[0]).toMatchObject({
      url: "https://api.deepseek.com/v1/chat/completions",
      headers: {
        authorization: "Bearer sk-real-deepseek-key"
      },
      body: {
        model: "deepseek-chat",
        stream: true
      }
    });
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  test("parses CRLF-delimited SSE chunks from verified OpenAI-compatible streams", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-stream-crlf-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    const calls: FetchCall[] = [];
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createStreamingFetch(calls, "\r\n\r\n")
    });
    const chapterEditorSession = await createLoadedChapterEditorSession();
    const provider = runtime.createAiProvider({
      chapterEditorSession
    });

    const iterator = provider.stream(streamingRequest())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "delta",
        value: "The city"
      }
    });
    await iterator.return?.();
  });

  test("fails a verified stream when no SSE chunk arrives before the first-chunk timeout", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-stream-timeout-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createNeverStreamingFetch()
    });
    const chapterEditorSession = await createLoadedChapterEditorSession();
    const provider = runtime.createAiProvider({
      chapterEditorSession
    });

    await expect(
      collectProviderStream(
        provider.stream({
          ...streamingRequest(),
          modelProfile: {
            ...streamingRequest().modelProfile,
            timeoutMs: 1
          }
        })
      )
    ).rejects.toThrow("Provider streaming response timed out before returning an SSE chunk.");
  });
});

const testCipher: DesktopSecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    return Buffer.from(`encrypted:${value}`, "utf8");
  },
  decryptString(value) {
    return value.toString("utf8").replace(/^encrypted:/, "");
  }
};

interface FetchCall {
  readonly url: string;
  readonly method?: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  aborted?: boolean;
}

async function createLoadedChapterEditorSession() {
  const session = createChapterEditorSession({
    chapterId,
    repository: {
      async readChapter() {
        return {
          ok: true,
          value: {
            frontmatter: {
              schemaVersion: "1.0",
              id: chapterId,
              type: "chapter",
              title: "第一章",
              order: 1,
              status: "draft",
              createdAt: "2026-07-04T00:00:00.000Z",
              updatedAt: "2026-07-04T00:00:00.000Z"
            },
            body: "Opening line.\n"
          }
        };
      },
      async writeChapter(chapter) {
        return { ok: true, value: chapter };
      }
    },
    now: () => "2026-07-07T00:00:00.000Z"
  });
  const loaded = await session.load();
  assertOk(loaded);
  return session;
}

function createJsonFetch(calls: FetchCall[], payload: unknown): typeof fetch {
  return (async (url, init) => {
    const headers = normalizeHeaders(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method,
      headers,
      body: JSON.parse(String(init?.body ?? "{}")) as unknown
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function createModelsFetch(calls: FetchCall[], payload: unknown): typeof fetch {
  return (async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: normalizeHeaders(init?.headers)
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function createStreamingFetch(calls: FetchCall[], delimiter = "\n\n"): typeof fetch {
  return (async (url, init) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method,
      headers: normalizeHeaders(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as unknown,
      ...(init?.signal === null || init?.signal === undefined ? {} : { signal: init.signal }),
      aborted: false
    };
    calls.push(call);
    init?.signal?.addEventListener("abort", () => {
      call.aborted = true;
    });
    return new Response(
      streamUntilAbort(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "The city" } }] })}${delimiter}`,
        init?.signal
      ),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  }) as typeof fetch;
}

function createNeverStreamingFetch(): typeof fetch {
  return (async (_url, init) =>
    new Response(streamNeverUntilAbort(init?.signal), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    })) as typeof fetch;
}

function streamNeverUntilAbort(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          controller.error(error);
        },
        { once: true }
      );
    }
  });
}

function streamUntilAbort(
  firstChunk: string,
  signal: AbortSignal | null | undefined
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          controller.close();
        },
        { once: true }
      );
    },
    pull(controller) {
      if (sent) {
        return;
      }
      sent = true;
      controller.enqueue(encoder.encode(firstChunk));
    }
  });
}

async function collectProviderStream(
  stream: AsyncIterable<LlmProviderStreamEvent>
): Promise<readonly LlmProviderStreamEvent[]> {
  const events: LlmProviderStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function streamingRequest(): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: "llmreq_stream_real",
    traceId: "desktop-model-runtime-stream",
    mode: "streaming",
    modelProfile: createDeepSeekProfile(),
    messages: [{ role: "user", content: "Continue." }],
    parameters: {
      temperature: 0.7,
      maxTokens: 64
    }
  };
}

function selectionRequest(): LlmRequest {
  return {
    ...streamingRequest(),
    requestId: "llmreq_selection_demo",
    traceId: "ai-selection-preview",
    mode: "non-streaming",
    messages: [
      { role: "system", content: "Return JSON with proposedText and summary." },
      {
        role: "user",
        content: "Selection offsets: 0-13\nSelected text: Opening line."
      }
    ],
    responseFormat: { type: "json_object" }
  };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries([...headers.entries()]);
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function createDeepSeekProfile() {
  return {
    id: "model_deepseek",
    provider: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyRef,
    modelName: "deepseek-chat",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
    timeoutMs: 60000
  };
}

async function copyDeepSeekProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-m95-real-provider-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        autosave: { enabled: true, intervalMs: 30000, createHistorySnapshot: false },
        history: {
          snapshotPolicy: "manual-and-interval",
          intervalMinutes: 10,
          maxSnapshotsPerChapter: 20
        },
        models: {
          defaultProfileId: "model_deepseek",
          profiles: [createDeepSeekProfile()]
        }
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  return target;
}

function assertOk<T>(
  result: unknown
): asserts result is Result<T, UnifiedError> & { readonly ok: true } {
  expect(result).toMatchObject({ ok: true });
}
