# M89-M91 Trust Workflow Editor Gates Design

## Goal

Ship the next productization slice for plugin security persistence, workflow graph editing, and editor runtime migration while keeping all irreversible actions gated.

## Architecture

- Plugin trust/audit lives in Application as deterministic DTO builders. Repository persistence can write the DTOs to `settings.json` or `history/plugin-audit/*.jsonl` later, but M89 keeps the API storage-agnostic.
- Workflow product editing builds on `applyConfigWorkflowSemanticEdit` and adds UI-level structured actions for node type insertion, edge retargeting, branch editing, and delete confirmation.
- Editor migration gate extends readiness evaluation with explicit opt-in, parity evidence, large-document benchmark, rollback readiness, and default switch labels.

## Risks

- Plugin trust persistence can imply safety before real sandbox execution exists. Mitigation: reports keep marketplace and arbitrary execution blocked.
- Workflow designer can create invalid graphs. Mitigation: draft edits refresh validation and invalid save remains blocked.
- CodeMirror migration can regress long-document writing. Mitigation: default remains textarea unless all gate evidence passes.

## Acceptance Criteria

- M89 tests prove trust store snapshots and local JSONL audit records are structured, redacted, and cache-clear protected.
- M90 tests prove semantic editing supports product UI add type, edge retarget, branch edit, and delete confirmation.
- M91 tests prove CodeMirror default migration is blocked without explicit opt-in and rollback evidence, and ready only when all gates pass.
