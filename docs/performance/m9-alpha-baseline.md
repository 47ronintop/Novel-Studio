# M9 Alpha Performance Baseline

Date: 2026-07-04

## Scope

M9 records a first alpha baseline for large local projects without committing a large generated
manuscript to the repository.

The synthetic fixture is generated on demand with:

```bash
node scripts/create-performance-fixture.mjs <target-root> --target-character-count 1000000 --chapter-count 20
```

## Baseline

Command:

```bash
npx vitest run apps/desktop/test/performance-fixture.test.ts
```

Result on 2026-07-04:

- Test files: 1 passed
- Tests: 2 passed
- Duration: 1.06s
- Generated project size: 1,000,000 synthetic chapter characters across 20 chapters
- Repository baseline path: `ProjectFileRepository.openProject()` reads and validates
  `project.json` and `settings.json` without scanning or blocking on `cache/`

## Boundary

This is a smoke baseline, not a release-grade benchmark suite. It proves that the alpha open path
does not require cache rebuild before project metadata and settings can load. Search index rebuild,
semantic retrieval, and editor rendering of all chapters remain future benchmark targets.
