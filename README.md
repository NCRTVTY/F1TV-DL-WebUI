# F1TV-DL-WebUI

A self-hosted replay library for desktop, phone and tablet. Browse Formula 1 weekends, queue replays and watch or save a single native 720p MP4.

## Download policy

Every new download uses **1280×720, F1 LIVE, English only**. The pinned downloader selects the provider's native stream and copies video and one English AAC track into MP4 without encoding. A missing feed, resolution or language is reported as unavailable; there is no International or resolution fallback. FFprobe verifies resolution, codecs, audio language and replay duration before an atomic rename publishes the file.

The provider may deliver HEVC or H.264. Native HEVC works in suitable device players; browser playback depends on the browser and installed codecs. Save MP4 uses the same file, supports HTTP ranges and works independently of browser decoding. File size depends on replay length and provider bitrate. There are no conversion workers, alternate copies, encoding presets or transcoding services.

## Interface and queue

The approved dark interface has Browse, Weekend sessions, Queue, Downloads, Watch and Settings screens, with desktop top navigation and mobile bottom navigation. Real catalog imagery decorates weekends and sessions. City labels distinguish Miami, Austin and Las Vegas. Upcoming weekends remain browsable without pretending replays are available.

The queue runs one download at a time. Pause prevents the next job from starting; a current download continues. Reorder queued jobs, cancel active work, retry failures or remove a replay and its files. SQLite persists queue state and pause across restarts. Interrupted downloads restart from the beginning of their staging directory; segment-level resume is not supported by the upstream engine. A five-minute inactivity watchdog considers both process output and file activity. Explicit deletion requests persist until storage recovers; unrelated directories are never swept.

The browser refreshes its snapshot after reconnect, device wake and periodically while open. Idle SSE heartbeats keep the connection alive. Empty, offline, low-space, catalog-error and failed-download states have distinct messages.

## Development and verification

Use Node.js 22 and FFmpeg/FFprobe. Install with `npm ci`, provide a private `APP_ENCRYPTION_KEY` through your environment, and run `npm run dev` plus `npm run dev:client`. Open [the local client](http://localhost:43730); Vite proxies to port 43729. Development uses local `data/` and `downloads/` directories unless configured otherwise.

`npm run verify` runs TypeScript checks, queue/API/storage tests, real FFmpeg media-validation tests, upstream patch checks and production builds. Chromium is included in the runtime for provider authentication. Installation rejects modified upstream source instead of silently losing the policy or authentication patches.

Never commit account details or deployment secrets. Repository-local secret files, only when explicitly requested, belong under the ignored root `SECRETS/` directory.

## Harlem and Synology

Drone is the production deployment path. A push to `main` verifies the repository on Harlem, builds and pushes an immutable commit-tagged image, applies Compose and verifies the exact commit and writable storage at `/api/health`.

- Local SQLite and provider session: `/home/ronny/docker/f1tv-dl-webui/data` → `/app/data`.
- Media: Synology `192.168.0.15:/volume2/Homelab-workspace/f1tv-dl` → Docker NFS volume `f1tv-dl-media` → `/app/downloads`.
- Host service port: `43729`.

The NAS directory is also visible on Harlem at `/mnt/homelab-workspace/f1tv-dl`. It must contain `.f1tv-storage-id` with the non-secret identity `f1tv-dl-media-v1`, and allow UID/GID 1000 to write. Compose mounts that export directly with `volume.nocopy`; it never binds a local downloads directory. Docker waits for the NFS mount before starting the application. The application then requires an NFS filesystem, matching identity, write access and sufficient free space before claiming jobs. Failed readiness keeps the durable queue waiting. Storage probes time out after five seconds and never accumulate duplicate blocked probes. Hard NFS mounts retain their kernel-level retry behavior during outages.

Keep the local database off NFS. Back up the local data directory and the deployment encryption key securely. `APP_ENCRYPTION_KEY` must remain stable; Drone supplies it from `F1TV_DL_WEBUI_ENCRYPTION_KEY`. Changing it makes saved credentials unreadable. API responses never return stored account values. The service is designed for the existing trusted LAN/VPN; public hostname and TLS routing are managed outside this repository.

The legacy local media folder is no longer mounted. Existing content is not migrated or imported.

## Explicit fresh start

After confirming the queue has no queued or running jobs, the authorized one-time reset is:

```sh
docker exec f1tv-dl-webui node scripts/reset-library.cjs --confirm-reset-library
```

It creates a private SQLite backup under local `data/backups/`, clears job history, catalog cache and preferences, and verifies that the saved encrypted account remains identical. It leaves the local encryption key, provider session and all media files untouched. It never runs automatically on deployment or startup. Refresh the browser afterward.

See [the approved scope](DOCS/plans/2026-11-19-720p-nfs-redesign.md) for layout and rollout acceptance criteria. The earlier implementation specification is historical where it differs from this policy.
