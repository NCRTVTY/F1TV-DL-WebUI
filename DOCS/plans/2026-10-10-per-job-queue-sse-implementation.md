# Per-job queue SSE implementation plan

1. Add job-change subscriptions to `AppDatabase` and notify only after successful mutations.
2. Add a single-job JSON endpoint and a 500-millisecond coalescing SSE endpoint.
3. Replace recurring client list polling with one application-lifetime `EventSource` and per-job fetch/merge behavior.
4. Memoize queue job cards so unaffected job cards retain their render output.
5. Add database and HTTP coverage for change notifications, endpoint behavior, coalescing, and terminal updates.
6. Run the full verification suite, review the diff for sensitive data, commit, and push.
