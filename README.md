# F1TV-DL-WebUI

Self-hosted, tablet-friendly web UI for `f1tv-dl` with encrypted F1 TV credential settings, an account-ready Formula 1 catalog browser, a durable download queue, and MP4 playback or download.

## Implementation handoff

See [DOCS/IMPLEMENTATION-SPEC.md](DOCS/IMPLEMENTATION-SPEC.md) for the complete requirements, architecture, upstream integration findings, security requirements, deployment instructions, and acceptance criteria.

Current status: the application is deployed on Harlem. Its server discovers the current season and archive directly from F1TV, while the download worker uses the configured account only when resolving an entitled replay.

## Current feature slice

- Configure or remove F1 TV credentials without returning stored values to the browser.
- Encrypt credentials at rest with AES-256-GCM using a deployment-provided key.
- Browse every season exposed by F1TV, with the dynamically discovered current season selected by default.
- See the complete current-season Formula 1 calendar in a wrapping grid, with completed replays, the active weekend, and disabled future rounds clearly distinguished.
- Browse each available Grand Prix's practice, qualifying, sprint, sprint qualifying, and race replays.
- Queue a replay with one click; the server derives the session URL and defaults to best quality, English audio, and the `F1 LIVE` feed.
- Switch the default feed between `F1 LIVE` and `INTERNATIONAL` in Settings; queued jobs follow the selected default immediately.
- Process one durable download at a time and recover an interrupted job after restart.
- View progress, failures, completed downloads, and cancel queued or active work.
- Keep the original HQ MP4 and independently create or reuse an Android-compatible 720p H.264/AAC MP4 below 3 GB.
- Download either HQ or LQ with the exact file size shown; both variants support HTTP range requests.
- Use a responsive phone and tablet interface.

The browser intentionally excludes F2/F3, highlights, shows, press conferences, documentaries, and F1 Kids. The UI never asks for a pasted session URL.

## Local development

Node.js 22 and FFmpeg are required. The project pins Node in `.nvmrc`.

```sh
npm install
APP_ENCRYPTION_KEY='use-a-private-value-of-at-least-24-characters' npm run dev
```

Run the Vite client in a second terminal:

```sh
npm run dev:client
```

Open `http://localhost:43730`. Vite proxies API requests to the server on the deliberately non-standard port `43729`.

Do not commit real configuration or credentials. Repository-local secret files, when explicitly required, belong only under the ignored uppercase `SECRETS/` directory.

## Verification

```sh
npm run verify
```

This runs TypeScript checks, unit and API tests, and production builds for the client and server.

## Container

The runtime image includes Chromium, FFmpeg, FFprobe, and the pinned `@thedave42/f1tv-dl` CLI. The legacy upstream package references an unpublished scoped FFmpeg wrapper and stale transitive packages. `package.json` reproducibly redirects the wrapper to its compatible public `fluent-ffmpeg` release and pins security-supported transitive versions. The post-install compatibility patch replaces one removed Puppeteer delay helper; it fails closed if the expected upstream source changes. A production dependency audit currently reports zero known vulnerabilities.

Runtime state uses two paths:

- `/app/data` for SQLite and the upstream F1 TV session-token store
- `/app/downloads` for per-job MP4 files

`APP_ENCRYPTION_KEY` is mandatory. It must be at least 24 characters and should be stable across deployments; changing it makes previously stored credentials unreadable.

The download worker and mobile-conversion worker run independently, so a new F1 TV download can proceed while FFmpeg converts the previous HQ file. On startup, the converter reconciles every completed download tracked in SQLite and creates any missing mobile version. It reuses an existing source only when FFprobe confirms a sub-3-GB, no-more-than-720p H.264/AAC MP4; otherwise it performs a size-bounded two-pass encode.

Each worker fails a child process after five minutes without output. Override the watchdogs with `DOWNLOAD_INACTIVITY_TIMEOUT_MS` and `CONVERSION_INACTIVITY_TIMEOUT_MS` when slower storage or media requires longer intervals.

## Harlem deployment

Drone is the only production deployment path. Pushes to `main` run on the Harlem Linux/AMD64 runner, verify the repository, build an immutable commit-tagged image, push it to `docker-registry.nc:17788/f1tv-dl-webui`, deploy with Compose, and verify the exact commit through `/api/health`.

Production publishes host and container port `43729`. Persistent state lives at:

```text
/home/ronny/docker/f1tv-dl-webui/data
/home/ronny/docker/f1tv-dl-webui/downloads
```

Drone must provide a secret named `F1TV_DL_WEBUI_ENCRYPTION_KEY`. OpenResty hostname and TLS routing are intentionally managed outside this repository.

The service is intended for a trusted LAN/VPN. Do not expose it directly to the public internet: the UI controls account credentials and downloadable media but does not add a second application login.
