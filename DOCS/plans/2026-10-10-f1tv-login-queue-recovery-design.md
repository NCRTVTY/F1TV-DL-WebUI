# F1TV Login and Queue Recovery Design

## Goal

Repair the pinned `f1tv-dl` authentication flow so it works with F1TV's current consent UI, and prevent any stalled downloader process from blocking the durable queue indefinitely. Existing Docker bind mounts and download paths remain unchanged.

## Authentication compatibility

Extend the existing install-time compatibility patch for the pinned downloader. Consent dismissal must support the current cross-origin consent iframe, the legacy main-document button, and sessions where no consent prompt appears. The browser must always close through a `try`/`finally` lifecycle, and authentication must return a clear failure when the entitlement cookie is absent.

The patch remains deterministic, idempotent, and fail-closed: installation stops if the pinned dependency no longer has the expected source structure.

## Worker supervision

Add a configurable inactivity timeout with a five-minute default. Any stdout or stderr activity resets the timer. When the timeout expires, record a sanitized timeout reason, terminate the downloader's complete process group with `SIGTERM`, escalate to `SIGKILL` after five seconds if necessary, and wait for process closure.

The timed-out job becomes failed. The worker's existing queue loop then immediately claims the next queued job. Container restart recovery continues to requeue an interrupted running job, so deployment retries the currently stuck item with the corrected authentication flow.

## Verification

Add deterministic tests covering the compatibility patch, including idempotency and expected-source rejection. Add worker tests proving that output refreshes the inactivity watchdog, a silent child is terminated and failed, and the next queued job is processed. Run type checks, the complete test suite, and production builds before deployment.

No live credentials are used or recorded. A credential-free browser inspection of F1TV's public login page established that the current consent action is rendered in a cross-origin iframe while the existing login input names remain present.
