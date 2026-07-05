# M35 Constitution Gap Audit Design

Date: 2026-07-05

Status: Accepted for M35

## Problem

After M34, Novel Studio has a working beta spine, but the roadmap uses `Complete` for milestone slices in a way that can be mistaken for product-complete capability. This conflicts with the user-visible experience: several high-level promises from `PROJECT_CONSTITUTION.md` and `UI_GUIDELINES.md` are only partially implemented.

M35 corrects the planning layer before more UI is added. It does not implement new product UI. It creates a constitution-aligned gap audit and resets the next roadmap so each future milestone closes a visible, traceable gap.

## Approach

M35 uses a documentation-first audit:

- Compare current implementation and milestone claims against `PROJECT_CONSTITUTION.md`, `UI_GUIDELINES.md`, `ROADMAP.md`, and the known code-level unfinished markers.
- Separate `slice complete` from `product complete`.
- Add a ranked gap table with concrete next milestones.
- Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md` so later work starts from the corrected source of truth.

## Alternatives Considered

### Direct Split View Implementation

This would improve one visible area, but it would leave the misleading completion model intact. It also risks optimizing the editor layout before project health, autosave/recovery, timeline, workflow, and provider gaps are ranked.

### Full UI Rewrite

This would address many symptoms but is too broad for one milestone. It would also violate the current productization rhythm by mixing audit, design-system work, editor work, and repository hardening.

### Recommended: Audit First

The audit-first approach costs one documentation milestone, but it reduces downstream churn. It gives every later milestone a clear source requirement, impact, and acceptance boundary.

## Scope

M35 includes:

- A new productization audit document.
- A capability status taxonomy.
- A constitution and UI guideline gap table.
- A ranked M36+ roadmap proposal.
- Documentation updates.

M35 does not include:

- New React UI.
- New Repository/Application APIs.
- New Electron or packaging behavior.
- New tests beyond documentation formatting checks.

## Acceptance Criteria

- `docs/productization/m35-constitution-gap-audit.md` exists and names the current product status without implying full product completion.
- `ROADMAP.md` marks M35 complete and points next work to the top ranked implementation milestone.
- `INDEX.md` includes the M35 document and updates the current progress row.
- `TECH_DEBT.md` records the roadmap/status taxonomy risk if needed.
- `CHANGELOG.md` records M35.
- `npm run format` passes.

## Self Review

- No placeholders remain.
- Scope is intentionally documentation-only.
- The design does not contradict M29; it supersedes M29's initial audit with a constitution-level audit.
- Later implementation still needs separate design and implementation plans per milestone.
