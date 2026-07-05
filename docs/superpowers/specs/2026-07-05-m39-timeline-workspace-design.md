# M39 Timeline Workspace Design

## Decision

Use the existing `timeline.events` Story Bible asset as the source of truth and parse structured events from `details.events`. The UI should display event-level structure while edits continue through the existing Story Bible timeline asset editor.

## Event Shape

M39 accepts the current flexible details object and recognizes event fields:

- `id`: stable event id.
- `sequence`: numeric ordering key.
- `title`: event display title, with id fallback.
- `status`: active/draft/archived/deleted, with active fallback.
- `summary`: short event body, with empty fallback.
- `chapterIds`: linked chapter ids.

Unknown fields remain preserved by Repository because M39 does not rewrite timeline event details.

## UI

Timeline activity becomes a dense workspace:

- Header metrics: events, linked chapters, active/draft counts.
- Ordered event rail with sequence numbers.
- Each event row shows title, status, summary, chapter ids, and an edit action.
- Empty state remains clear when no timeline asset or no events exist.

## Risks

- Details are flexible, so malformed event rows may be skipped or normalized by renderer mapping.
- Full event editing still happens through the parent asset summary/body editor until a future event-specific editor exists.
