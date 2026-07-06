# M61/M62 CodeMirror Flag and Workflow Graph View Plan

**Goal:** Add a flagged CodeMirror runtime adapter contract and a read-only Workflow Studio graph view.

**Architecture:** Renderer resolves editor adapters by feature flag. Application attaches workflow graph DTOs to workflow config assets. UI renders graph DTOs only.

## Task 1: Document Boundary

- [x] Record M61/M62 scope and non-goals.
- [x] Define adapter and workflow graph data flow.

## Task 2: CodeMirror Adapter Flag

- [x] Add red tests for adapter selection defaulting to textarea.
- [x] Add red tests for CodeMirror adapter selection only when enabled.
- [x] Add red tests proving CodeMirror adapter emits the same event/snapshot contract.
- [x] Implement adapter resolver and flagged CodeMirror adapter contract.

## Task 3: Workflow Studio Read-only Graph

- [x] Add red Application tests for workflow graph attached to workflow config snapshots.
- [x] Add red Studio bridge tests mapping workflow graph DTOs to UI props.
- [x] Add red UI tests rendering nodes, edges, and validation issues.
- [x] Implement Application graph attachment for workflow assets.
- [x] Implement UI read-only graph rendering.

## Task 4: Documentation and Tracking

- [x] Add productization summary for M61/M62.
- [x] Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md`.

## Task 5: Verification and Commit

- [x] Run focused tests during implementation.
- [ ] Run full typecheck, lint, format, test, and diff checks.
- [ ] Commit the completed milestone.
