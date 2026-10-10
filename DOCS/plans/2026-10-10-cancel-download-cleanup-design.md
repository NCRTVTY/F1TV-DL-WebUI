# Cancel download cleanup design

## Goal

Make cancellation immediate and unambiguous. A user must confirm cancellation in a custom HTML dialog. After the server accepts the request, the job disappears from the queue, the same session becomes downloadable again, and partial download files are removed without making the UI wait for filesystem cleanup.

## User experience

Selecting **Cancel** opens an accessible React dialog that identifies the session and explains that partial download data will be removed. Confirming disables the dialog actions while the request is pending. A failed request leaves the dialog open and shows a useful error. A successful request closes the dialog and removes the job from the visible queue immediately.

Cancelled jobs never appear in the queue after an SSE update or page refresh. They also do not count as existing downloads when rendering session actions, so the user can queue the session again.

## Server lifecycle

The server retains a cancelled job as a historical database record. Cancellation first moves an eligible queued or running job to the terminal `cancelled` state. For a running job, the worker terminates the complete downloader process group with `SIGTERM` and retains the existing delayed `SIGKILL` escalation.

Every job downloads into its own directory beneath the configured download root. After cancellation is accepted, the worker removes that directory asynchronously. A cleanup failure does not make the job visible again and does not change it to failed. Cleanup failures are sanitized and retried later, including during application startup, so temporary data is eventually removed without blocking the cancellation response.

The worker must check the persisted cancellation state after the downloader exits and must never complete or fail a cancelled job.

## API and live updates

The cancel endpoint remains `POST /api/jobs/:id/cancel`. The accepted response contains the terminal cancelled job. Repeated cancellation is idempotent from the user's perspective: an already-cancelled job returns its current terminal state rather than presenting an actionable error.

The browser keeps historical job data only as needed for other terminal states. Its queue projection includes queued, running, and failed jobs, but excludes completed and cancelled jobs. When a cancellation response or SSE refresh supplies a cancelled job, client state may retain the record, but the queue removes it immediately.

## Safety and error handling

Cleanup resolves the job directory from the server-owned job ID and verifies that it remains beneath the configured download root before recursive removal. No client-provided path is accepted. Errors are sanitized before storage or logging, and credentials or provider URLs are never included.

If the cancellation request fails before the server accepts it, the job remains visible and the dialog exposes the error for retry. Once accepted, cleanup failure is intentionally non-blocking and invisible in the normal queue workflow.

## Verification

Automated coverage will verify:

- queued-job cancellation and directory cleanup;
- running-process termination and partial-file cleanup;
- cleanup failure without queue restoration;
- idempotent cancellation;
- re-queueing a cancelled catalog session;
- API and SSE terminal-state behavior;
- custom dialog confirmation, pending, error, dismissal, and successful removal behavior where the current client test setup permits it.

Type checks, the full test suite, and a production build remain the completion gates.
