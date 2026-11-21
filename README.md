# F1TV-DL-WebUI

A self-hosted replay library for desktop, phone and tablet. Browse Formula 1 weekends, queue replays and watch or save a single native 720p MP4.

## Docker Compose quick start

Install Docker Engine with Compose v2 (or Docker Desktop), then:

```sh
git clone https://github.com/NCRTVTY/F1TV-DL-WebUI.git
cd F1TV-DL-WebUI
docker compose up -d --build
```

Open [the application](http://localhost:43729) and enter your own F1 TV account in
Settings. The first build installs all runtime dependencies inside the image.
The default installation uses persistent Docker volumes for account settings,
queue, provider session, encryption key and downloads. Drone is not required.
Use `docker compose down` to stop it; **do not use `down -v`** unless you intend
to delete its persistent volumes. Updates use `git pull` followed by
`docker compose up -d --build`; finish active downloads before updating.

The interface has no separate application login. Use it on a trusted LAN or VPN;
if exposing it through a reverse proxy, configure authentication and HTTPS there.
The default port is reachable on the host's network interfaces. Set
`BIND_ADDRESS=127.0.0.1` when only a local reverse proxy should access it.

### Download to another disk

Copy `.env.example` to `.env`, then uncomment and set this **non-secret** value:

```dotenv
DOWNLOAD_PATH=/absolute/path/to/downloads
```

Create that directory and grant container UID/GID 1000 read/write/traverse access
before starting. The directory may be on an internal disk, USB disk or an already
mounted network share. Keep the database and provider session on local storage.

This uses a regular Docker bind mount, including Docker Desktop's host-path
sharing support. To change an existing installation's disk, stop the app and
preserve its existing media. The app does not import or migrate existing files
automatically. Do not delete its old volume as part of changing the path.

### Direct NFS storage

Use the same Compose file with these non-secret settings, replacing the example
server and export for your own network:

```dotenv
MEDIA_TYPE=nfs
MEDIA_DEVICE=:/export/replays
MEDIA_OPTIONS=addr=nas.example,nfsvers=4.1,rw,hard,timeo=50,retrans=2
DOWNLOAD_MOUNT_OPTIONS=rw,nocopy
REQUIRE_NFS=true
STORAGE_ID=f1tv-dl-media-v1
STORAGE_LABEL=My NAS / replays
```

Create `.f1tv-storage-id` containing the configured `STORAGE_ID` on that export,
and grant UID/GID 1000 access. Direct NFS mounting requires a Linux Docker host
with NFS support and export authorization. Leave `DOWNLOAD_PATH` unset for this
named-volume mode. Docker volume options are fixed at creation; changing NFS
options requires a different `MEDIA_VOLUME_NAME` after preserving existing media.
`REQUIRE_NFS=true` refuses a local
filesystem or a missing/mismatched marker, so jobs wait instead of writing to a
fallback directory. Local disks do not need a marker. All storage modes retain
write checks, free-space checks and timed probes.

### Encryption and backups

A fresh installation automatically creates a random private
`credential-encryption.key` in its persistent data volume. The key never appears
in API responses. Back up the complete data volume, including that key, SQLite
and provider session, separately from your media. Anyone with both the key and
database can access the saved account, so protect backups.

An existing `APP_ENCRYPTION_KEY` supplied through the process environment or a CI
secret store takes precedence. Keep that key unchanged and back it up securely.
An existing account without its original key fails startup rather than receiving
a replacement key. Do not put secrets in the tracked example or ordinary `.env`.
Repository-local secret files, when explicitly required, belong only in ignored
root `SECRETS/`; production keys can remain in the CI secret store.

### Build and run separately, or use CI

The Dockerfile is the common image recipe. For a separate build, use
`docker build -t f1tv-dl-webui:local .`, then `docker compose up -d --no-build`.
CI can build and push a commit-tagged image, set `APP_IMAGE` and `TAG`, then run
`docker compose pull && docker compose up -d --no-build`. The tracked `.drone.yml`
is the maintainer's home pipeline; other operators can adapt its host and registry
settings and supply their own secret store without needing the maintainer's LAN.

## Download policy

Every new download uses **1280×720 and English only**. Seasons from 2022 onward require **F1 LIVE**. Pre-2022 archive races explicitly use the **original main broadcast**, independently checked against the provider's season metadata. The pinned downloader selects the provider's native stream and copies video and one English AAC track into MP4 without encoding. A missing feed, resolution or language is reported as unavailable; there is no automatic feed or resolution fallback for modern races. FFprobe verifies resolution, codecs, audio language and replay duration before an atomic rename publishes the file.

The provider may deliver HEVC or H.264. Native HEVC works in suitable device players; browser playback depends on the browser and installed codecs. Save MP4 uses the same file, supports HTTP ranges and works independently of browser decoding. File size depends on replay length and provider bitrate. There are no conversion workers, alternate copies, encoding presets or transcoding services.

## Interface and queue

The approved dark interface has Browse, Weekend sessions, Queue, Downloads, Watch and Settings screens, with desktop top navigation and mobile bottom navigation. Real catalog imagery decorates weekends and sessions. City labels distinguish Miami, Austin and Las Vegas. Upcoming weekends remain browsable without pretending replays are available.

The queue runs one download at a time. Pause prevents the next job from starting; a current download continues. Reorder queued jobs, cancel active work, retry failures or remove a replay and its files. SQLite persists queue state and pause across restarts. Interrupted downloads restart from the beginning of their staging directory; segment-level resume is not supported by the upstream engine. A five-minute inactivity watchdog considers both process output and file activity. Explicit deletion requests persist until storage recovers; unrelated directories are never swept.

The browser refreshes its snapshot after reconnect, device wake and periodically while open. Idle SSE heartbeats keep the connection alive. Empty, offline, low-space, catalog-error and failed-download states have distinct messages.

## Development and verification

Use Node.js 22 and FFmpeg/FFprobe. Install with `npm ci` and run `npm run dev` plus `npm run dev:client`. Open [the local client](http://localhost:43730); Vite proxies to port 43729. Development uses local `data/` and `downloads/` directories unless configured otherwise.

`npm run verify` runs TypeScript checks, queue/API/storage tests, real FFmpeg media-validation tests, upstream patch checks and production builds. Chromium is included in the runtime for provider authentication. Installation rejects modified upstream source instead of silently losing the policy or authentication patches.

Never commit account details or deployment secrets. Repository-local secret files, only when explicitly requested, belong under the ignored root `SECRETS/` directory.

## Harlem and Synology

The tracked `.drone.yml` explicitly supplies the existing home configuration to the same portable Compose file. Drone is the production deployment path. A push to `main` verifies the repository on Harlem, builds and pushes an immutable commit-tagged image, applies Compose and verifies the exact commit and writable storage at `/api/health`.

- Local SQLite and provider session: `/home/ronny/docker/f1tv-dl-webui/data` → `/app/data`.
- Media: Synology `192.168.0.15:/volume2/Homelab-workspace/f1tv-dl` → Docker NFS volume `f1tv-dl-media` → `/app/downloads`.
- Host service port: `43729`.

Deployment refuses an unexpected existing data path or media volume and requires an idle queue before replacing the container. It creates a private SQLite backup first; it never resets the library.

The NAS directory is also visible on Harlem at `/mnt/homelab-workspace/f1tv-dl`. It must contain `.f1tv-storage-id` with the non-secret identity `f1tv-dl-media-v1`, and allow UID/GID 1000 to write. Compose mounts that export directly with `volume.nocopy`; it never binds a local downloads directory. Docker waits for the NFS mount before starting the application. The application then requires an NFS filesystem, matching identity, write access and sufficient free space before claiming jobs. Failed readiness keeps the durable queue waiting. Storage probes time out after five seconds and never accumulate duplicate blocked probes. Hard NFS mounts retain their kernel-level retry behavior during outages.

Keep the local database off NFS. Back up the local data directory and the deployment encryption key securely. `APP_ENCRYPTION_KEY` must remain stable; Drone supplies it from `F1TV_DL_WEBUI_ENCRYPTION_KEY`. Changing it makes saved credentials unreadable, and startup now verifies that the saved account can be decrypted before reporting healthy. API responses never return stored account values. The service is designed for the existing trusted LAN/VPN; public hostname and TLS routing are managed outside this repository.

The legacy local media folder is no longer mounted. Existing content is not migrated or imported.

## Explicit fresh start

After confirming the queue has no queued or running jobs, the authorized one-time reset is:

```sh
docker exec f1tv-dl-webui node scripts/reset-library.cjs --confirm-reset-library
```

It creates a private SQLite backup under local `data/backups/`, clears job history, catalog cache and preferences, and verifies that the saved encrypted account remains identical. It leaves the local encryption key, provider session and all media files untouched. It never runs automatically on deployment or startup. Refresh the browser afterward.

See [the approved scope](DOCS/plans/2026-11-19-720p-nfs-redesign.md) for layout and rollout acceptance criteria. The earlier implementation specification is historical where it differs from this policy.

## Public release status

Portable deployment does not itself change repository visibility or grant a source
license. The repository is currently marked UNLICENSED. An open-source license,
third-party notices, image redistribution rights (including embedded design
photography), and a final history review must be resolved before public release.
The application is unofficial. F1 TV subscriptions, regional availability and
[provider terms](https://www.formula1.com/en/information/f1-tv-subscription-terms.384sQqjslhQ2Rhm1LdKgfD)
remain applicable; supplying an account does not establish permission to archive
content. Unsupported streams or DRM are not bypassed.
