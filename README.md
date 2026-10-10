# F1TV-DL-WebUI

Self-hosted, tablet-friendly web UI for `f1tv-dl` with encrypted F1 TV credential settings, direct session submission, a durable download queue, and MP4 playback or download.

## Implementation handoff

See [DOCS/IMPLEMENTATION-SPEC.md](DOCS/IMPLEMENTATION-SPEC.md) for the complete requirements, architecture, upstream integration findings, security requirements, deployment instructions, and acceptance criteria.

Current status: the initial direct-URL feature slice is implemented. Live F1 TV compatibility and production deployment have not yet been verified.

## Current feature slice

- Configure or remove F1 TV credentials without returning stored values to the browser.
- Encrypt credentials at rest with AES-256-GCM using a deployment-provided key.
- Submit an `https://f1tv.formula1.com/detail/...` session URL with quality, audio, and optional feed selection.
- Process one durable download at a time and recover an interrupted job after restart.
- View progress, failures, completed downloads, and cancel queued or active work.
- Stream or save completed MP4 files with HTTP range support.
- Use a responsive phone and tablet interface.

Full season, event, and session catalog browsing is the next product increment. The direct URL workflow remains the fallback when F1 TV changes its catalog APIs.

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

The runtime image includes Chromium, FFmpeg, FFprobe, and the pinned `@thedave42/f1tv-dl` CLI. The upstream package references an unpublished scoped FFmpeg wrapper, so `package.json` reproducibly redirects that dependency to its compatible public `fluent-ffmpeg` release.

Runtime state uses two paths:

- `/app/data` for SQLite and the upstream F1 TV session-token store
- `/app/downloads` for per-job MP4 files

`APP_ENCRYPTION_KEY` is mandatory. It must be at least 24 characters and should be stable across deployments; changing it makes previously stored credentials unreadable.

## Harlem deployment

Drone is the only production deployment path. Pushes to `main` run on the Harlem Linux/AMD64 runner, verify the repository, build an immutable commit-tagged image, push it to `docker-registry.nc:17788/f1tv-dl-webui`, deploy with Compose, and verify the exact commit through `/api/health`.

Production publishes host and container port `43729`. Persistent state lives at:

```text
/home/ronny/docker/f1tv-dl-webui/data
/home/ronny/docker/f1tv-dl-webui/downloads
```

Drone must provide a secret named `F1TV_DL_WEBUI_ENCRYPTION_KEY`. OpenResty hostname and TLS routing are intentionally managed outside this repository.

The service is intended for a trusted LAN/VPN. Do not expose it directly to the public internet: the UI controls account credentials and downloadable media but does not add a second application login.
