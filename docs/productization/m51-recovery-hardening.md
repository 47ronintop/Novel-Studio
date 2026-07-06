# M51 Recovery Hardening

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M51 hardens recovery behavior after M49 by making processed records and unsupported recovery content explicit.

## Scope

- Clean recovery records remain protected on disk and hidden from dirty recovery summary.
- `file-ref` recovery records return `RECOVERY_DRAFT_CONTENT_UNAVAILABLE` for preview/apply rather than reading arbitrary paths.
- The recovery UI continues to show only dirty chapter recovery records.
- No pruning, deletion, archive browser, stale-lock override, or file-ref dereference policy.

## Reason

`history/recovery/` is protected data, not cache. M51 keeps recovery handling conservative: processed records are retained, while unsupported content strategies fail with typed errors that can be handled by future UI.

## Acceptance

- Application tests prove clean records are hidden from dirty recovery items.
- Application tests prove `file-ref` preview/apply returns a typed unavailable-content error.
- Product docs state remaining Recovery Hardening work explicitly.

## Changelog

- v1.0 - Initial recovery hardening follow-up after M49.
