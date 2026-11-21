# F1TV-DL-WebUI

**Download at home. Watch on the plane, on the train, or wherever the connection
is too slow for streaming.**

F1TV-DL-WebUI is a self-hosted tool for saving supported F1 TV replays before you
travel. Browse a season, queue a race, and save the finished MP4 to your phone,
tablet or laptop. Think of the familiar Netflix-style “save now, watch later”
workflow, with storage you manage yourself. This is an independent tool, not an
official F1 TV offline feature or an affiliation with either service.

You need your own F1 TV account with access to the replay. Subscription access,
regional availability and permission to save content are separate matters; the
software does not bypass unsupported DRM or geographic restrictions.

> **Use at your own risk.** Downloading or storing replays with this tool may
> violate the [F1 TV subscription terms](https://www.formula1.com/en/information/f1-tv-subscription-terms.384sQqjslhQ2Rhm1LdKgfD),
> including clause 9.2, and could result in account suspension or termination.
> You are responsible for your use of the software and compliance with applicable
> terms and laws. This disclaimer does not grant permission to save or redistribute
> content or override F1 TV's terms.

## Before starting

Install Docker Engine with Compose v2, or Docker Desktop. Host Node.js, npm,
Chromium and FFmpeg are not needed for the Docker installation.

Choose persistent storage and check its actual free space. The default Compose
file already uses persistent Docker volumes for both account data and media;
an external drive or NAS is optional, not required for persistence. As practical
starting recommendations, budget **10 GB free on Docker's build/image disk**
and **20 GB free on the media disk**. These are planning allowances, not measured
hardware minima or a guarantee that a queue fits. See [storage planning](DOCS/storage.md).
If images, data and media share Docker's disk/VM, add the allowances rather than
counting the same free bytes twice.

AI assistants should start with
[llms.txt](llms.txt) and the repository's [AGENTS.md](AGENTS.md).

## Docker Compose quick start

Use the persistent defaults below, or configure [your chosen disk or NAS](#storage-configuration)
before running `up`. Install Docker Engine with Compose v2 (or Docker Desktop), then:

```sh
git clone https://github.com/NCRTVTY/F1TV-DL-WebUI.git
cd F1TV-DL-WebUI
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Open [the application](http://localhost:43729) and enter your own F1 TV account in
Settings. On a separate server, replace `localhost` with that server's address.
The first build installs all runtime dependencies inside the image and can take
several minutes. New default installations generate their own persistent
encryption key; you do not need to invent or paste one.
If you changed `APP_PORT`, open that port instead of 43729.
The default installation uses persistent Docker volumes for account settings,
queue, provider session, encryption key and downloads. Drone is not required.
Use `docker compose down` to stop it; **do not use `down -v`** unless you intend
to delete its persistent volumes. Updates use `git pull` followed by
`docker compose up -d --build`; finish active downloads before updating.

The interface has no separate application login. Use it on a trusted LAN or VPN;
if exposing it through a reverse proxy, configure authentication and HTTPS there.
The default port is reachable on the host's network interfaces. Set
`BIND_ADDRESS=127.0.0.1` when only a local reverse proxy should access it.

## Save a replay for offline viewing

1. In **Browse**, select a season, weekend and supported replay, then **Add to queue**.
2. Wait for it to appear in **Downloads** as complete. Failed or missing files
   are not ready to take with you.
3. On the device you will travel with, choose **Save MP4**. Wait for the entire
   file to finish downloading to that device, not just your home server.
4. Open the local file in a compatible player, such as VLC. Test playback and
   seeking with networking off before leaving.

Once the file is on the device, viewing does not need the home server, VPN or a
fast connection. The web interface itself is not an offline app, and a replay
stored only on your NAS is not yet an offline copy on your phone.

Check Settings before downloading: storage must be connected, writable and have
enough free space for the planned files. A healthy container alone does not prove
that a replay fits. For diagnostics, see [operations](DOCS/operations.md).

## Storage configuration

### Download to another disk

For a new installation without an existing `.env`, copy `.env.example` to `.env`,
then uncomment and set this **non-secret** value. Preserve an existing file and
its settings instead of overwriting it:

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

### Network storage and capacity

For already-mounted NAS shares and direct Docker NFS volumes, follow
[storage planning and NFS](DOCS/storage.md). Verify the expected share on the
actual Docker host before starting; a local folder at a missing mount point is
not proof of a mounted NAS. Never create a substitute directory to hide a failed
network mount.

Named volumes are persistent, but not a backup. Docker Desktop's storage VM can
be full even when the Mac or Windows host has plenty of free disk. A 200 MB
media target is unusable: the app's default 2 GB free-space floor already exceeds
it, and complete replays take several GB. That floor is an admission check, not a
file-size estimate or reserved space. Do not lower it to bypass a capacity issue.

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

## Build separately or use Drone

The same Dockerfile builds local and CI images. Drone is optional; see
[Docker and CI deployment](DOCS/deployment.md) for separate build/run commands
and adapting the tracked home pipeline to your own CI and registry.
Build your own image from the included Dockerfile with
`docker compose up -d --build`; no project-provided prebuilt image is needed.

## Download policy

Every new download uses **1280×720 and English only**. Seasons from 2022 onward require **F1 LIVE**. Pre-2022 archive races explicitly use the **original main broadcast**, independently checked against the provider's season metadata. The pinned downloader selects the provider's native stream and copies video and one English AAC track into MP4 without encoding. A missing feed, resolution or language is reported as unavailable; there is no automatic feed or resolution fallback for modern races. FFprobe verifies resolution, codecs, audio language and replay duration before an atomic rename publishes the file.

The provider may deliver HEVC or H.264. Native HEVC works in suitable device players; browser playback depends on the browser and installed codecs. Save MP4 uses the same file, supports HTTP ranges and works independently of browser decoding. File size depends on replay length and provider bitrate. There are no conversion workers, alternate copies, encoding presets or transcoding services.

## Interface and queue

The interface has Browse, Weekend sessions, Queue, Downloads, Watch and Settings screens, with desktop top navigation and mobile bottom navigation. Real catalog imagery decorates weekends and sessions. City labels distinguish Miami, Austin and Las Vegas. Upcoming weekends remain browsable without pretending replays are available.

The queue runs one download at a time. Pause prevents the next job from starting; a current download continues. Reorder queued jobs, cancel active work, retry failures or remove a replay and its files. SQLite persists queue state and pause across restarts. Interrupted downloads restart from the beginning of their staging directory; segment-level resume is not supported by the upstream engine. A five-minute inactivity watchdog considers both process output and file activity. Explicit deletion requests persist until storage recovers; unrelated directories are never swept.

The browser refreshes its snapshot after reconnect, device wake and periodically while open. Idle SSE heartbeats keep the connection alive. Empty, offline, low-space, catalog-error and failed-download states have distinct messages.

## Development and verification

Use Node.js 22 and FFmpeg/FFprobe. Install with `npm ci` and run `npm run dev` plus `npm run dev:client`. Open [the local client](http://localhost:43730); Vite proxies to port 43729. Development uses local `data/` and `downloads/` directories unless configured otherwise.

`npm run verify` runs TypeScript checks, queue/API/storage tests, real FFmpeg media-validation tests, upstream patch checks, notice generation and production builds. `npm run licenses` regenerates the complete lockfile license inventory and client notices; the built app serves them at `/licenses/index.html`. See the [script guide](scripts/README.md). Chromium is included in the runtime for provider authentication. Installation rejects modified upstream source instead of silently losing the policy or authentication patches.

Never commit account details or deployment secrets. Repository-local secret files, only when explicitly requested, belong under the ignored root `SECRETS/` directory.

## Existing home deployment and maintenance

The tracked `.drone.yml` explicitly supplies the maintainer's existing home
settings to the same portable Compose file. Its registry, runner, paths and NAS
address are installation-specific; new users do not need that infrastructure.
See [home deployment](DOCS/home-deployment.md).

Before updating an existing server, preserve its data directory, encryption key,
media volume/options and project identity. Follow [backups, safe updates and
troubleshooting](DOCS/operations.md). Drone backs up SQLite and requires an idle
queue before replacing the container; a busy queue aborts the deployment and
needs a retry once idle. It does not wait automatically.

The destructive [library reset](DOCS/maintenance.md) is separate maintenance,
never an installation, ordinary update or default repair step.

## Use and licensing

The original application and original documentation are [MIT licensed](LICENSE).
Dependencies, adapted upstream source, fonts and imagery retain their own terms;
read [third-party notices and license scope](THIRD_PARTY_NOTICES.md). MIT does not
license broadcasts, Formula 1/Netflix marks or photographs.

This project is intended for a personal offline-viewing workflow, not content
redistribution or a hosted sharing service. A paid subscription does not itself
establish permission to save content. See the use-at-your-own-risk disclaimer
above. [Historical plans](DOCS/README.md) are not setup guides.
