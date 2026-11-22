# F1TV-DL Web UI design

## Goal

Build a self-hosted, tablet-friendly interface around `@thedave42/f1tv-dl` for configuring an F1 TV account, submitting session URLs, monitoring a durable download queue, and retrieving completed MP4 files.

The first release is a complete vertical slice that works with direct F1 TV session URLs. Full season, event, and session catalog browsing will be added through the same adapter boundary after the download workflow is proven against the deployed runtime.

## Architecture

The application is one Node.js 22 and TypeScript service with a React client built by Vite and served by Fastify. SQLite stores application settings and durable job state. One in-process worker claims one queued download at a time and invokes the pinned `f1tv-dl` executable without a shell.

The Docker image contains FFmpeg, FFprobe, Chromium, and the application. Runtime state is split between `/app/data` for SQLite and the upstream session-token store, and `/app/downloads` for completed or partial media files.

## Product surfaces

- **Sessions:** accept and validate an F1 TV session URL, then add it to the queue with quality and audio options.
- **Queue:** show queued, active, completed, failed, and cancelled downloads with progress, timestamps, recoverable error summaries, and cancellation controls.
- **Downloads:** list completed MP4 files and expose streaming and attachment responses with HTTP range support for tablets.
- **Settings:** save F1 TV credentials, show only whether credentials are configured, and allow replacement or removal without ever returning their values.

## Data and security

Credentials are encrypted with AES-256-GCM using an application key supplied by a Drone secret. Plaintext credentials exist only while processing a settings request and in the child-process environment. They are never placed in command arguments, responses, logs, database columns, images, or repository files.

The worker builds a fixed argument array for `f1tv-dl`, validates all options against allowlists, and spawns the executable with `shell: false`. Output is redacted before it is retained or sent to the browser. Download filenames are resolved beneath the configured download root to prevent path traversal.

Jobs interrupted by a container restart return to the queue. Cancellation sends a graceful termination signal and escalates only if the child process does not exit. The first release intentionally runs a single worker to avoid duplicate sessions and excessive bandwidth use.

## Deployment

The initial deployment used Drone to verify the repository, build and push a
commit-tagged image, and apply Docker Compose. Current installations can build
locally or use CI; see the root README and current deployment guide.

The service listens on port `43729`, with persistent storage at `/app/data` and
`/app/downloads`. Deployment verifies the expected commit and writable runtime
directories. Hostname routing remains outside this repository.

## Verification

Automated tests cover URL and option validation, encryption and redaction, queue recovery and transitions, command construction, cancellation, file-path containment, byte-range responses, and API behavior. The production client build, TypeScript checks, linting, and the Docker image health check are deployment gates. Responsive behavior is visually checked at phone, tablet portrait, and tablet landscape sizes.

## Deferred work

Full F1 TV catalog browsing will use a dedicated adapter so upstream API changes do not affect queue and file-management logic. The direct URL workflow remains available as a fallback.
