# Remove downloads design

## Goal

Let users permanently remove any download job. Removal deletes the main job and its conversion record from SQLite, stops matching downloader or FFmpeg work, removes the server-owned job directory, and updates every connected browser.

## User experience

Every queue and download card exposes **Remove**. Active jobs retain **Cancel** as the non-destructive option. Cancelled records remain available in the queue as history so they can also be removed.

Remove always opens an accessible confirmation dialog. Its copy identifies the job and explains whether an active process will be stopped and that all local HQ, LQ, partial, and conversion files will be permanently deleted. While the request is pending, the selected card's actions are disabled. A successful request removes the card immediately; a failed request keeps the dialog open with a retryable error.

## Server lifecycle

The API uses `DELETE /api/jobs/:id`. Removal is coordinated across the database, download worker, conversion worker, and filesystem:

1. validate the server-owned UUID and locate the job;
2. delete the job row, cascading to its conversion row so queued work cannot be claimed;
3. terminate a matching downloader and/or FFmpeg process with `SIGTERM`, retaining delayed `SIGKILL` escalation;
4. wait for the matching worker lifecycle to become quiescent;
5. recursively remove `<downloadDir>/<job-id>` using a path-containment check.

Workers treat a missing database row as intentional removal and do not complete, fail, or recreate it after their child process exits.

Deletion is idempotent. A missing job returns success. Filesystem cleanup failure does not restore the deleted database record or make the job visible again. Failed cleanup is retained in memory for retry, and startup cleanup removes orphaned UUID-named job directories that have no database record. Non-UUID and unrelated folders are never swept.

## Live updates

The database publishes a removal notification after the hard delete. SSE sends a dedicated job-removal event containing only the job ID. Other connected browsers remove the job from local state without treating the expected missing-job response as a server outage.

## Safety and errors

No client path is accepted. Job identifiers must be UUIDs, and cleanup resolves the directory beneath the configured download root. Errors are sanitized before logging. A malformed ID receives `400`; removal of a missing valid ID remains a successful no-op.

The repository security rules remain unchanged: `/SECRETS/` stays ignored, and no credentials or sensitive files are staged or committed.

## Verification

Automated coverage verifies queued, running, failed, cancelled, completed, and actively converting jobs; cascading database deletion; downloader and FFmpeg termination; path containment; filesystem cleanup failure semantics; startup orphan cleanup; idempotency; SSE removal; and confirmation-dialog state where the client test setup permits it.

Type checks, the full test suite, and the production build are completion gates.
