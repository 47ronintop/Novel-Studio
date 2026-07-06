# M43 Provider Matrix

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M43 aligns model provider configuration with `PROJECT_CONSTITUTION.md` section 3. Users can create and validate model profiles for the required provider matrix without binding the product to a single vendor.

## Scope

- Define a provider catalog for all constitution-required channels: OpenAI Compatible API, OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Zhipu, Tongyi Qianwen, Ollama, LM Studio, and vLLM.
- Expand `settings.json` schema validation to accept every provider in the catalog while continuing to reject plaintext API keys.
- Keep provider profile fields consistent: Base URL, API Key reference, Model Name, Temperature, Max Tokens, Top P, Timeout, Frequency Penalty, and Presence Penalty.
- Surface the provider catalog in Settings UI instead of the previous three-option provider select.
- Resolve default runtime profiles through Application without provider-specific UI code.
- Add fixture-first tests; no CI path calls a real provider endpoint or requires a real API key.

## Design Reason

P4 requires model agnosticism, and section 3 requires the named provider matrix. The current implementation only accepts `openai-compatible`, `openai`, and `ollama`, which makes the UI and schema narrower than the constitution. M43 closes that configuration gap while preserving P8: model calls still go through LLM Adapter and provider-specific behavior stays outside UI and Repository.

## Provider Strategy

Providers are represented as stable provider IDs and display labels. OpenAI-compatible providers such as OpenRouter, DeepSeek, Zhipu, Tongyi Qianwen, LM Studio, and vLLM are configured as first-class providers but can still be routed through the OpenAI-compatible adapter implementation in later runtime work. M43 does not add provider SDKs.

## Data Flow

Settings UI provider select
-> renderer SettingsBridge draft
-> `NovelStudioApi.settings.saveModelProfile`
-> Application `ModelSettingsSession`
-> `settings.json` schema validation
-> runtime profile resolver
-> LLM Adapter request profile

## Acceptance

- `settings` schema valid fixture includes every required provider and passes contract tests.
- Unsupported provider and plaintext key fixtures still fail contract tests.
- `ModelSettingsSession.saveModelProfile()` accepts all catalog providers and rejects providers outside the catalog.
- `resolveDefaultModelRuntimeProfile()` returns catalog provider IDs without losing Base URL or generation parameters.
- Settings UI renders all catalog providers in the select control.
- No secrets appear in UI markup, errors, or test output.

## Non-Goals

- Real network calls to Anthropic, Gemini, OpenRouter, DeepSeek, Zhipu, Tongyi Qianwen, LM Studio, or vLLM.
- Provider-specific request/response translators beyond existing OpenAI-compatible fixture behavior.
- Secret storage UI beyond existing `secret://` reference handling.
- Streaming UX; that remains a later milestone.

## Risks

- Users may expect a provider label to imply fully tested live connectivity. M43 must frame this as profile support and validation, not verified production connectivity for every vendor.
- Some providers have divergent request formats. M43 keeps the catalog explicit and leaves runtime translators as LLM Adapter work rather than embedding provider behavior in UI.

## Changelog

- v1.0 - Completed Provider Matrix configuration, validation, and UI support for M43.
