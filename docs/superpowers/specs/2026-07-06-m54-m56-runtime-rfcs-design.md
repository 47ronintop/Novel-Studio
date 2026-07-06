# M54-M56 Runtime RFCs Design

Version: 1.0 | Status: Accepted by direct user instruction | Date: 2026-07-06

## Goal

Complete M54-M56 as RFC milestones:

- M54 Plugin Runtime RFC.
- M55 Editor Runtime Engine RFC.
- M56 Workflow Designer RFC.

These milestones define architecture and rollout plans before implementation. They do not add runtime code.

## Recommended Approach

Use three focused RFCs instead of one broad architecture document. This keeps plugin execution, editor runtime, and workflow designer decisions independently reviewable and traceable.

Rejected approach: implement all three runtime systems immediately. That would cross too many security, UI, and data-flow boundaries at once and would conflict with the constitution's quality-first rule.

## Architecture Decisions

- Plugin Runtime is Application-orchestrated and adapter-backed. v1 starts with host-mediated commands and mockable workflow steps; sandboxed third-party code is deferred.
- Editor Runtime is adapter-first. Textarea remains fallback; CodeMirror 6 is the recommended production adapter after parity and performance tests.
- Workflow Designer is schema-first. JSON workflow definitions remain source of truth; graph view models are UI projections only.

## Acceptance Criteria

- Three accepted RFC files exist under `docs/rfcs/`.
- Productization summary exists for M54-M56.
- Roadmap, index, changelog, tech debt, and M35 audit reflect M54-M56 completion.
- No runtime code or data schema is changed.
- Formatting and diff checks pass before commit.

## Changelog

- v1.0: Initial M54-M56 RFC design.
