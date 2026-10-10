# Cancel download cleanup implementation plan

1. Add worker-owned, path-contained cleanup for cancelled job directories, with startup and poll-based retries.
2. Make the cancel endpoint idempotent for already-cancelled jobs while retaining conflicts for completed or failed jobs.
3. Add a custom accessible confirmation dialog to the queue and exclude cancelled jobs from its visible projection.
4. Ensure cancellation responses remove jobs immediately and later SSE updates cannot make them visible again.
5. Cover queued and running cleanup, idempotency, and re-queue behavior in automated tests.
6. Run type checks, the full test suite, and the production build.
