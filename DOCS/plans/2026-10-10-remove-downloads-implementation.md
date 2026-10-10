# Remove downloads implementation plan

1. Add hard-delete database operations and distinct removal notifications while preserving conversion foreign-key cascading.
2. Add per-job quiescence/removal hooks to the download and conversion workers, including safe process-tree escalation and missing-row handling.
3. Add a coordinator that orders DB deletion, worker shutdown, contained directory cleanup, retries, and startup orphan cleanup.
4. Expose idempotent `DELETE /api/jobs/:id` and broadcast removal over SSE.
5. Add Remove actions and an accessible confirmation flow to queue and download cards, including cancelled history.
6. Cover database, worker, API, SSE, cleanup, and UI-state behavior with automated tests.
7. Run secret/staging checks, type checks, the full test suite, and a production build before committing and pushing.
