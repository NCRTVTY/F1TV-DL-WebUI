# F1TV-DL-WebUI — implementation specification and agent handoff

> Historical handoff, superseded for setup by [README](../README.md),
> [llms.txt](../llms.txt) and [current operations](operations.md). Do not apply
> old hosts, frameworks, feed defaults or storage instructions from this document.

## Status and purpose

Repository: NCRTVTY/F1TV-DL-WebUI (private).
Owner: Ronny / noCreativity.
Target host: Manhattan, Ronny's Mac mini; containerized deployment.
Primary client: an Android tablet, remotely and before flights.
This document is an implementation handoff, not evidence that an application or live F1 TV integration currently works.

Build a self-hosted web interface that signs in to the owner's F1 TV account, displays sessions available to that account, queues supported replay downloads using thedave42/f1tv-dl, and serves finished MP4 files to the tablet for offline playback in VLC. The tablet browser must control the workflow without opening Manhattan's desktop or terminal. The MP4 must be saved locally on the tablet before boarding.

The owner authorized repository changes and provided this documentation fallback when implementation cannot be completed here. GitHub access does not provide execution or deployment access to Manhattan. This session inspected upstream code but did not authenticate with F1 TV, verify current catalogue endpoints, run a real download, or deploy anything.

## Confirmed owner requirements

1. Use this existing repository; retain the name F1TV-DL-WebUI and uppercase root DOCS directory.
2. Provide a login page accepting F1 TV email and password.
3. Allow changing those credentials later through Settings.
4. Browse sessions available based on the signed-in account's access; do not require a URL paste as the only workflow.
5. Use f1tv-dl as the download engine.
6. Provide browser-based operation from a tablet, including retrieving finished files.
7. Run on the owner's own machine, initially Manhattan.
8. Supply sufficient implementation and operational instructions for another agent to continue without routine product questions.

## Defaults chosen for implementation

These are design defaults, not additional preferences expressed by the owner. Proceed with them unless existing repository instructions or deployment facts require adjustment.

- Single household/operator, one configured F1 TV account; no billing, public signup, or multi-tenant hosting.
- Node.js 24 LTS, TypeScript, Express backend, React/Vite frontend.
- SQLite for jobs and non-secret settings; one API process and one serial background worker initially.
- Docker Compose, one application service including Chromium, ffmpeg, ffprobe and the pinned upstream download engine.
- English interface; responsive dark theme; large tablet-friendly controls.
- Replay downloads only. Exclude live and upcoming streams from the download queue.
- Default MP4, best verified available resolution, English audio, main race broadcast.
- Offer only quality/audio/feed options actually present in the selected session.
- One active download at a time; persist queue across service restarts.
- No automatic file deletion. Expose explicit per-file deletion and disk usage.
- Bind the host port to loopback by default; authenticated HTTPS reverse proxy or existing VPN is required for remote access.
- Keep UI authentication separate from the F1 TV account credentials.
- No cloud storage dependency: serve completed files directly from the application.

## Upstream findings and integration risks

Inspected source: https://github.com/thedave42/f1tv-dl
Inspected upstream HEAD: 14f1cfffbe9c77e66bf1ec3cd3da35269d141d16.
package.json at that revision reports 0.25.18-alpha.0 and ISC licensing metadata. Verify license files and attribution obligations before vendoring/distributing code.

Relevant source:
- index.js: executable CLI with immediate side effects; do not import it as a library into the API process.
- lib/f1tv-token.js: Puppeteer-based automated browser sign-in; types supplied credentials into F1 TV's page and reads an entitlement cookie.
- lib/f1tv-api.js: content metadata, playback URL, stream/feed selection and token persistence.
- lib/config.js: headless browser configuration; hard-coded home-country USA and Pro Annual entitlement assumptions.
- lib/secure-local-data.js and lib/secure.js: local token file with encryption derived from a source-code constant. This is not adequate secret protection for a new server application.
- CLI uses ffmpeg to produce MP4 or TS files and accepts a video-page URL, quality, audio, optional additional feed and output directory.
- Credentials can be supplied through environment variables; do not use password command-line arguments.
- --channel-list lists feeds for one session, not seasons, events or available sessions.
- No catalogue-browsing API is exposed by this tool.
- Login selectors and old Chromium/Puppeteer dependencies may no longer match the service.
- A CLI failure may not reliably yield a nonzero process status; validate outputs independently.
- Debug output and errors may include signed media URLs or other sensitive data.

Do not assume that the existence of an F1 TV subscription, or successful streaming, guarantees that a session is downloadable. Treat subscription entitlement, regional availability, replay delay and stream download support as separate checks.

The earlier conversation described this tool without inspecting its internals. The verified behavior is automated browser login using user-supplied credentials, not a manual browser login provided by the UI and not simply an email/password API request.

## First engineering gate: verify before constructing the full integration

1. Read AGENTS.md and all applicable repository instructions.
2. Pin upstream to a tested commit/version. Inspect dependencies, runtime compatibility and licensing.
3. Provide a local integration diagnostic that an operator can run without disclosing credentials to an agent or committing them.
4. Test current login on the actual deployment host using credentials entered privately by the operator.
5. Discover the current authenticated catalogue and entitlement behavior from actual service responses. Record endpoint shapes and sanitized fixtures.
6. Test one entitled replay through f1tv-dl and verify both audio and video with ffprobe and real playback.
7. Document exact upstream patches needed, keeping an identifiable relationship to upstream.
8. If login or download is blocked by a service change, stop claiming the live integration works. Return an actionable compatibility report and retain the UI architecture behind an adapter.
9. If content requires unsupported DRM, mark it unsupported. Do not add decryption/key extraction or a DRM-removal service.
10. A mock backend is acceptable for development but must be explicitly labeled. Never present sample sessions or simulated downloads as live results.

Resolve routine implementation decisions autonomously. External account access, CAPTCHA/manual authentication and deployment connectivity remain execution prerequisites, not unspecified product choices.

## User flows

### Application access and F1 TV connection

Protect the entire application, including file endpoints. For this single-user deployment, implement a separate app password configured at startup, with a session cookie after verification. Do not reuse the F1 TV password as the app password. Generate/configure actual secrets privately at deployment, never in this document or commits.

After application access, show the F1 TV login form when the account is not configured or its session needs renewal:
- Email and password fields; password hidden with optional reveal.
- Clearly state that credentials are processed on the owner's server to sign into F1 TV.
- Prevent duplicate submissions; show authenticating status and a sanitized result.
- Keep form input out of URLs, analytics, console logs and localStorage.
- Authenticate server-side, validate the resulting account/session, then load its access information.
- On failure show an actionable message without exposing underlying cookies, request headers or signed URLs.
- Return only a masked email and connection state to the client.
- Do not require the operator to manually copy tokens.

### Browse sessions

Provide season, event and session browsing with search and filters:
- Start with recent events and current season.
- Group by season, Grand Prix/event and session.
- Include practice, qualifying, sprint qualifying, sprint and race where the account and catalogue support them.
- F2/F3/other series and documentaries are optional later scope; main F1 sessions are required.
- Display title, session type, event, date, duration when supplied, and thumbnail when available.
- Dates must use explicit timezone-aware values and render in the browser's local timezone.
- Paginate and cache catalogue metadata with an explicit Refresh action.
- Show access state independently from download state.
- Distinguish checking, allowed, subscription restricted, region restricted, replay not yet available, unsupported protection and unknown/temporary failure.
- Only enable Download after entitlement and supported-stream checks.
- Do not mark every listed item available simply because metadata is public.
- Do not guess an unlock date when the API provides none.
- Handle empty results, expired authentication and service failure honestly.
- A paste-replay-URL action is a secondary fallback and must use the same entitlement and stream checks.

### Select and queue

Open a session detail/download panel:
- Main feed selected by default, with other available feeds optional.
- Select quality and audio language from verified stream information.
- Show MP4 output format, estimated size only if defensibly calculated, and storage availability.
- Queue the job after server-side checks; prevent accidental duplicate active jobs.
- Closing the browser must not cancel the server job.
- An existing complete download may be retrieved again without downloading from F1 TV again.
- Feed/language/quality selections form part of the job identity.

### Queue and downloads

Show queued, checking, downloading, validating, completed, failed, canceled and interrupted jobs:
- Display title, selections, queue position, truthful progress, bytes written, speed/ETA where available.
- If reliable percentage is unavailable, show indeterminate progress and bytes rather than an invented number.
- Support cancellation of queued/active jobs and explicit retry.
- Show sanitized failure details and actionable next steps.
- Persist job metadata; on restart mark unfinished running jobs interrupted.
- Retry interrupted work from the beginning unless upstream resume is verified. Never imply byte-level resume exists without testing it.
- Deleting a finished file must be explicit and confirmed in the UI; distinguish deleting a file from removing a job record.
- Disconnecting F1 TV must not silently remove finished files.

### Download to tablet

On completed jobs show a clearly labeled Download to tablet button:
- Serve the file through an authenticated GET endpoint using attachment Content-Disposition and video/mp4.
- Provide Content-Length and support HTTP Range/206 correctly for resumed transfers and media clients.
- Use stable, server-generated filenames and opaque job IDs; do not accept filesystem paths from clients.
- Ensure the file is available independently of the F1 TV session after completion.
- Explain briefly: save the file to the tablet, open it in VLC, and test airplane mode before flying.
- Do not claim a browser preview or server-side completion means the tablet has a local offline copy.
- Explain that tablet storage and a completed transfer are required.
- Handle authentication expiry during resumed downloads; support reauthentication and retry.
- Do not expose signed F1 TV stream URLs to the tablet.
- No desktop login or remote-control app is required once the service is deployed and reachable.

### Settings

- Display masked configured email and connection status.
- Replace email/password through a dedicated form; retain previous valid account if replacement fails.
- Check new credentials before activation.
- Block account changes while a job is running; give a clear explanation and allow cancellation first.
- After successful replacement, remove old token/browser session, increment an account version, invalidate cached entitlement checks, and cancel queued jobs associated with the previous account. Ask the user to requeue under the new account.
- Allow disconnect/forget account; stop/cancel pending access-dependent work and remove saved F1 credentials/session data.
- Offer default quality/audio, catalogue refresh and storage usage.
- Never return a saved password or token through settings endpoints.
- Revalidate per-job access immediately before starting download.

## Architecture and implementation boundaries

Suggested layout:
- apps/web: React views and API client.
- apps/server: Express routes, auth, configuration and catalogue/download adapters.
- apps/server/worker: queue execution and media validation.
- packages/shared: TypeScript DTOs and validated schemas.
- tests: adapter, authorization, queue and transfer tests.
- DOCS: setup, specification, integration findings and operator guide.
- Dockerfile and compose.yaml.
- .env.example with variable names/empty values only; never real credentials.
- Root .gitignore must retain /SECRETS/ and ignore dependency, build, database, runtime credential and download files.

Keep provider-specific behavior behind adapters:
- authenticate(email, password)
- disconnect()
- getAccountAccess()
- listSeasons()
- listEvents(season, cursor)
- listSessions(event, cursor)
- getSessionDetails(contentId)
- checkAccess(contentId)
- getDownloadOptions(contentId)
- download(job, progressCallback, cancellationSignal)

f1tv-dl remains the actual download engine. Add catalogue discovery and entitlement handling separately. If upstream requires patches for correct account/region behavior, document and pin them. Do not silently replace the engine with unrelated software.

Spawn the engine with an argument array and shell disabled. Pass credentials through restricted child environment or a reviewed private IPC integration, never argv. Prevent interactive CLI prompts from hanging a worker. Give authentication and playback resolution timeouts; enforce a configurable overall download timeout. Terminate the full subprocess tree on cancellation and ensure ffmpeg/Chromium do not remain orphaned.

Use a dedicated isolated home/state directory for the engine. Do not share the host user's general home directory with it. Upstream token storage must be replaced, disabled or isolated in ephemeral encrypted-state handling; its constant-derived encryption is not a sufficient application secret store.

Download to a job-specific staging directory. Sanitize names, prevent symlink/path traversal, check free disk space and never overwrite another job. Only atomically publish a completed file after validation. Remove partial files on cancellation/failure using a bounded cleanup policy. Preserve completed files across restarts.

Validate with ffprobe: readable container, a video stream, an audio stream for selections requiring audio, sane duration and expected completion. A file's existence or CLI exit alone is insufficient. Avoid overstrict duration checks when catalogue duration includes pre/post content. Include real offline playback in final acceptance.

## Storage, authentication and security

Follow AGENTS.md exactly:
- Never request, echo, commit or push real credentials/tokens/private keys/passwords.
- If repository-local secret files are explicitly requested, use uppercase SECRETS only.
- Keep /SECRETS/ ignored.
- Before every commit/push verify no sensitive information or SECRETS files are tracked/staged.

Prefer runtime volumes outside the source checkout:
- /data/app.sqlite: jobs, non-secret settings, cache metadata.
- /data/downloads: completed files.
- /data/staging: partial files.
- /data/private: restricted encrypted provider credentials/session state.
- Separately mounted deployment encryption key; generate privately, never commit it.

Store provider secrets with authenticated encryption and a randomly generated deployment key. Enforce restrictive file permissions. Store the separate app password as a strong password hash, not reversible encryption. Define a consistent key backup/rotation procedure and describe loss-of-key recovery.

Protect APIs and files with app sessions, HttpOnly/SameSite cookies, Secure cookies on HTTPS, CSRF protection for mutations, login rate limits and strict request validation. Keep CORS same-origin. Reject unexpected origins. Do not put tokens in browser storage.

Validate upstream URL inputs against exact approved HTTPS hosts and video paths; prevent SSRF and unsafe redirect destinations. Sanitize any ffmpeg/provider error before showing it or writing logs. Redact credentials, cookies, authorization headers, signed URLs and sensitive query parameters. Disable upstream debug logging in normal operation.

No anonymous file server, arbitrary command input, arbitrary output path, or public unauthenticated exposure. Disable browser profile/screenshot dumps containing credentials. Review upstream browser flags rather than copying security-disabling flags blindly.

## API contract proposal

All routes except app login and minimal health readiness require app authentication. Validate request schemas and never expose provider secrets.

- POST /api/auth/login: app session.
- POST /api/auth/logout: clear app session.
- GET /api/account: masked provider account and connection state.
- POST /api/account/connect: transient email/password submission; returns sanitized connection/access state.
- DELETE /api/account: forget provider account and remove provider session.
- GET /api/catalog/seasons
- GET /api/catalog/events?season=...&cursor=...
- GET /api/catalog/sessions?eventId=...&cursor=...
- GET /api/sessions/:id: metadata, access state and supported options.
- POST /api/catalog/refresh
- POST /api/jobs: validated content ID or approved replay URL, feed, audio and quality.
- GET /api/jobs
- GET /api/jobs/:id
- POST /api/jobs/:id/cancel
- POST /api/jobs/:id/retry
- GET /api/jobs/:id/file: authorized completed-file transfer, including Range support.
- DELETE /api/jobs/:id/file: explicit file deletion.
- GET/PATCH /api/settings: non-secret preferences.
- GET /api/events: authenticated server-sent job updates; polling fallback.
- GET /health: minimal process readiness, no account or sensitive host details.

Use typed errors: AUTH_REQUIRED, INVALID_CREDENTIALS, SUBSCRIPTION_RESTRICTED, REGION_RESTRICTED, REPLAY_PENDING, DRM_UNSUPPORTED, OPTIONS_UNAVAILABLE, PROVIDER_UNAVAILABLE, DISK_FULL, DOWNLOAD_FAILED, VALIDATION_FAILED and CANCELED. UNKNOWN availability must not silently become allowed. Return appropriate HTTP status, user-readable explanation and retryability without raw upstream errors.

## Deployment on Manhattan

- Build/test Linux ARM64 for the Apple Silicon Docker host; support AMD64 where feasible.
- Use an explicit tested Chromium executable compatible with the container architecture and upstream Puppeteer; do not assume its old downloaded browser works.
- Include ffmpeg and ffprobe in the runtime image.
- Persist state and completed downloads via volumes; configure a bounded staging area.
- Health check, restart policy and graceful shutdown.
- Avoid mounting Docker socket, host home directories or unrelated NAS shares.
- Reverse proxy must support long downloads, Range requests and SSE without harmful buffering.
- Document local Docker Compose startup, updates, backups, restore, disk cleanup and troubleshooting.
- Document authenticated HTTPS/VPN access from outside home. A local .nc hostname alone is not remote access.
- Do not invent the owner's domain, proxy configuration or remote machine access. Provide configurable settings and a concrete setup guide.
- Existing CI/CD may be used once verified; do not assume an automatic Drone deployment already exists.
- Do not deploy or claim reachability from this cloud workspace without a verified deployment path.

## Tests and acceptance criteria

Run meaningful automated checks without real credentials:
1. Secret encryption round trip, tamper rejection and no secret serialization to client responses/logs.
2. App auth required for catalogue, settings, jobs and every full/range file transfer.
3. CSRF/origin checks, invalid URL rejection, command injection and path traversal prevention.
4. Queue serialization, restart recovery, cancellation, retries and duplicate prevention.
5. Account replacement failure preserves old account; successful replacement invalidates access cache and old queued jobs.
6. Unsupported/restricted sessions cannot start jobs; unknown states remain visible.
7. CLI success with missing/truncated media fails validation.
8. Full file and Range transfers have correct body, status and headers.
9. Settings and completed files persist through restart.
10. Mobile views fit an Android tablet; status updates survive temporary disconnection.

Operator-only live acceptance on Manhattan:
- Enter actual credentials privately in the UI.
- Confirm login and session refresh.
- Browse real seasons/events/sessions and verify access on allowed/restricted examples where available.
- Download one permitted replay; validate sound and video.
- Cancel a running job and verify process cleanup.
- Restart the service and verify queue recovery and finished-file availability.
- Open the UI remotely from the tablet.
- Download a complete MP4 to tablet storage.
- Enable airplane mode and play/seek it in VLC.
- Record host architecture, engine/browser versions and sanitized outcomes.
- If a live step cannot run, mark it unverified. Never substitute mocks for those acceptance results.

## Delivery checklist for the implementing agent

- Working frontend/backend with real adapter integration, no silent demo mode.
- Pinned upstream version with documented compatibility patches and attribution.
- Login/settings, account-aware catalogue, job queue and tablet file transfer.
- Dockerfile/Compose with persistent storage and secure deployment defaults.
- Automated checks passing plus clearly stated live verification status.
- README with quick start and links to DOCS.
- DOCS/INTEGRATION.md recording verified API behavior, fixtures and known restrictions.
- DOCS/DEPLOYMENT.md and DOCS/OPERATOR-GUIDE.md.
- No secrets, runtime databases, cookies, generated media or browser profiles in Git.
- Report what was implemented, tests run, remaining blockers and exact operator steps.

Product scope is fully specified here. Remaining uncertainties are technical compatibility and execution access: current F1 TV authentication/catalogue behavior, downloadable streams, architecture-specific Chromium and remote deployment connectivity. Investigate those directly rather than inventing endpoints or promising unsupported downloads.
