# Per-job queue SSE design

## Goal

Replace the browser's app-wide 1.5-second full job-list polling with one app-wide Server-Sent Events connection. Queue changes should arrive at most once per job per 500-millisecond window. Each event identifies only the changed job; the browser then fetches and merges that one job.

## Architecture

`AppDatabase` will publish a job-change notification after every successful job mutation: creation, recovery, claim, progress, completion, failure, and cancellation. The notification contains only the job ID and carries no credentials, provider URLs, or job details.

The Fastify application will expose:

- `GET /api/jobs/:id`, returning one current job or `404`.
- `GET /api/jobs/events`, an SSE stream shared by the whole client application.

Each SSE connection keeps a set of changed job IDs. Database notifications add IDs to that set. Every 500 milliseconds the connection emits one `job-update` event per pending ID, with a JSON payload shaped as `{ "jobId": "…" }`, then clears the set. This coalesces noisy progress writes while preserving independent updates for each job. The connection unsubscribes and clears its timer when the browser disconnects.

## Client data flow

The application still fetches `GET /api/jobs` once for its initial state. It then opens one `EventSource` for the application's lifetime. On each `job-update`, it validates the event payload, fetches `GET /api/jobs/:id`, and replaces only that job in state. If a newly observed job is absent from the initial snapshot, it is inserted.

The old recurring full-list poll is removed. Queue job cards are split into memoized components so a state change for one job does not rerender every unchanged card. SSE connection state contributes to the existing online/offline indicator, while the browser's native EventSource reconnection behavior handles transient disconnections.

## Error handling

Malformed SSE payloads are ignored. A failed per-job refresh marks the app offline without discarding the last known job state. The initial list request remains the recovery snapshot after a full page reload. Completed, failed, and cancelled mutations use the same change notification path, ensuring the final job state is delivered.

SSE responses use `text/event-stream`, disable caching and proxy buffering, and send an initial comment so headers are delivered promptly.

## Verification

Server tests will verify the single-job endpoint, missing-job behavior, SSE response headers and payload shape, 500-millisecond coalescing, independent job events, and terminal-state delivery. Existing type checks, tests, and production builds must continue to pass.
