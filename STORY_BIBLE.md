# STORY_BIBLE - Novel Studio

Version: 1.0 | Status: Accepted for M16 | Phase: 7 Formal Development

## 1. Purpose

Story Bible Modules turn project story assets into editable, validated, local-first data that can be used by writers and by AI workflows. M16 covers characters, world assets, outline, timeline events, and memories.

Story Bible is not a chat transcript, hidden model state, or derived cache. It is user-owned project data stored as JSON in the project folder and validated before crossing repository, application, and context boundaries.

## 2. Scope

M16 implements the minimum closed loop:

- Read, list, and save character assets under `characters/`.
- Read, list, and save world assets under `world/`.
- Read and save the main outline under `outline/outline.json`.
- Read and save timeline events under `timeline/events.json`.
- Read, list, and save memories under `memories/`.
- Convert selected Story Bible assets into explicit Context Engine candidates.
- Expose a minimal Application and Desktop IPC surface for Story Bible access.
- Display Story Bible summaries in the workspace without direct filesystem access from UI.

M16 does not include relationship graph visualization, semantic vector retrieval, bulk AI extraction from full chapters, plugin access, or automatic mutation of Story Bible assets from model output.

## 3. Data Model

Persistent files use existing schema contracts:

- `story-asset.schema.json` for character, world, outline, and timeline asset payloads.
- `memory.schema.json` for long-term, style, and summary memories.

Story Bible assets use stable IDs. Chapters and workflow results may reference these IDs, but natural-language text does not become a cross-agent contract. Unknown user fields remain preserved after validation, matching the existing schema strategy.

Memories are non-cache data. They must never be deleted by cache cleanup, and AI-generated memories must be either user-confirmed or marked as not eligible for high-confidence context by default.

## 4. Repository Boundary

`StoryBibleRepository` is the only M16 component that reads or writes Story Bible project files.

Rules:

- All reads validate JSON through the schema package before returning data.
- All writes validate before atomic persistence.
- Missing optional collections return empty lists where that is safe; malformed files return stable Unified Errors.
- Outline and timeline are singleton files.
- Characters, world assets, and memories are collection files discovered from their allowed directories.
- Repository code does not build prompts, call models, or decide workflow state.

## 5. Application Boundary

`StoryBibleSession` exposes user-facing use cases:

- Load a Story Bible snapshot.
- Save one story asset or memory.
- Build Context Engine candidates from the current snapshot.

The session depends on a Story Bible repository port and returns structured results. It does not access Node filesystem APIs directly.

## 6. Context Candidate Policy

Context Engine remains a pure selector. It does not scan a project directory.

M16 adds an Application-side adapter that maps Story Bible assets into explicit candidates:

- `character` candidates from active character summaries.
- `world` candidates from active world asset summaries.
- `timeline` candidates from timeline event summaries.
- `memory` candidates from active memories, carrying memory confidence.
- `goal` and chapter candidates remain supplied by workflow-specific callers.

Candidates must include source references. Unconfirmed memories are passed with low confidence metadata so existing Context Engine filtering can exclude them unless a policy allows them.

## 7. UI and IPC

Desktop exposes Story Bible through whitelisted Application IPC channels. Renderer code calls preload APIs only and never reads project files.

The M16 UI is intentionally minimal:

- Navigator counts reflect Story Bible assets.
- Inspector or a small panel can show asset titles, types, statuses, and context eligibility.
- Save operations are structured and schema-backed.
- AI-generated changes, when added in later milestones, must remain suggestion-state until user confirmation.

## 8. Testing

M16 test coverage must include:

- Repository list/read/save for each Story Bible asset family.
- Schema rejection for invalid Story Bible and memory payloads.
- Application snapshot and Context candidate creation.
- Desktop IPC whitelist and handler wiring.
- UI rendering of Story Bible summaries without plaintext secrets or filesystem access.

CI must not call real models. Tests should use temporary project directories or in-memory ports, consistent with existing repository and application tests.

## 9. Acceptance Criteria

M16 is complete when:

- Story Bible design is documented.
- Story Bible assets can be persisted and loaded through Repository and Application boundaries.
- Context Engine candidate input can be produced from Story Bible data without blind full-project stuffing.
- Desktop exposes the minimal Story Bible surface through IPC and preload APIs.
- `npm run format`, `npm run typecheck`, `npm run lint`, targeted tests, and the standard test suite pass locally.
- Roadmap, index, and changelog reflect M16 completion before commit.
