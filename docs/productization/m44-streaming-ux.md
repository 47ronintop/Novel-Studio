# M44 Streaming UX

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M44 closes the first visible streaming gap from `PROJECT_CONSTITUTION.md` section 3: streaming and non-streaming model responses now share the LLM Adapter abstraction, and the UI has explicit streaming, cancellation, and partial-output states.

## Scope

- Add OpenAI-compatible streaming transport support behind the LLM Adapter boundary.
- Parse fixture-backed OpenAI-compatible stream chunks into provider-neutral `delta` and `usage` events.
- Normalize malformed streaming chunks through existing `UnifiedError` handling.
- Add AI writing workflow UI props for `streaming`, `cancelled`, stream preview text, and cancel command.
- Keep CI deterministic; tests use mock/fixture chunks and do not call real provider endpoints.

## Non-Goals

- Real live streaming over Electron IPC.
- Provider-specific streaming translators beyond OpenAI-compatible chunk format.
- Automatic application of streamed text to chapter body.

## Acceptance

- OpenAI-compatible streaming requests map to `/chat/completions` with `stream: true`.
- Streaming delta and usage chunks are emitted as `LlmStreamEvent` values.
- Malformed stream chunks become normalized adapter errors.
- The AI writing panel can render a stream preview and cancellation command.
- Cancelled streaming state stays visible and does not mutate chapter text.

## Changelog

- v1.0 - Completed deterministic streaming adapter contract and visible streaming UX state.
