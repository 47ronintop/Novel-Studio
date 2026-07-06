# M43 Provider Matrix Design Spec

## Decision

M43 implements provider matrix support as a configuration and contract slice. It adds a stable provider catalog and propagates it through schema validation, Application runtime profile resolution, and Settings UI. It does not add real provider SDKs or live endpoint tests.

## Provider Catalog

The catalog contains:

- `openai-compatible`
- `openai`
- `anthropic`
- `google-gemini`
- `openrouter`
- `deepseek`
- `zhipu`
- `tongyi-qianwen`
- `ollama`
- `lm-studio`
- `vllm`

Each entry has a display label, whether Base URL is usually required, and an optional default Base URL hint. The catalog is the Application/UI source for provider options; the JSON Schema keeps the same enum for file validation.

## Schema Contract

`settings.schema.json` expands `models.profiles[].provider` to the full catalog. The valid `settings.json` fixture includes at least one profile for each provider. The invalid fixture and explicit schema contract test continue to prove unsupported providers and plaintext `apiKey` are rejected.

## Application Contract

`ModelSettingsSession` validates provider IDs through the catalog. `resolveDefaultModelRuntimeProfile()` returns the selected provider ID as the LLM Adapter profile provider, preserving Base URL, API key ref, timeout, temperature, max tokens, and Top P.

Connection tests remain dependency-injected and offline. The default desktop tester continues to be mock-based.

## UI Contract

`ModelSettingsPanel` receives provider options and renders them in the Provider select. The renderer SettingsBridge supplies the default catalog options. Tests assert Anthropic, Gemini, OpenRouter, DeepSeek, Zhipu, Tongyi Qianwen, Ollama, LM Studio, and vLLM are visible without exposing secrets.

## LLM Adapter Contract

`LlmProviderId` expands to the full catalog. Existing OpenAI-compatible fixture behavior remains deterministic. M43 does not introduce provider-specific translators; later runtime work can map catalog IDs to adapter implementations behind the LLM Adapter boundary.

## Testing

- Schema contract tests cover valid full matrix and invalid unsupported/plaintext profile.
- Application tests cover saving each provider, rejecting unsupported providers, and resolving runtime profiles.
- UI tests cover provider option rendering and no secret leakage.
- Existing LLM Adapter tests continue to prove fixture-first behavior.

## Changelog

- v1.0 - Initial M43 Provider Matrix design.
