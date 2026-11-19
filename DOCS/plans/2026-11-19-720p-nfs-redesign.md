# Approved 720p library and dark interface

Approved by Ronny on 2026-11-19. Implement and push to main for the existing Drone deployment.

## Product contract

- One native 1280×720 MP4 per replay, exclusively F1 LIVE with one English audio track. No International fallback and no alternate resolution.
- Remove the transcoding worker, job table, routes, settings, controls, and tests of the removed feature. FFmpeg remains the download engine's stream-copy muxer; FFprobe validates completed files.
- Preserve the approved six-screen layout: Browse, Race weekend, Queue, Downloads, Watch, Settings. Dark graphite surfaces, Barlow/Barlow Condensed, red primary actions, real catalog imagery, compact desktop top navigation and mobile bottom navigation.
- Keep SQLite and encrypted account state on Harlem. Media belongs on Synology Homelab-workspace/f1tv-dl through a Docker-managed NFS volume. No local media fallback.
- Start fresh: clear job history, catalog cache, and other settings while preserving the existing encrypted login and deployment encryption key. Ronny has removed the old local media. No migration or automatic orphan deletion.

Approved references: [wireframes](../design/approved-wireframes.html) and [visual language](../design/approved-visual-language.html).

## Reliability

Verify NFS filesystem identity, storage marker, write access and free space before writing media. Recheck during operation; keep queued jobs durable while storage is unavailable. Publish only validated MP4s by atomic rename. Stop and await subprocesses before closing SQLite. Record unexpected worker failures. Support pause, cancellation, retry and queued-job ordering. Persist explicit deletion requests so cleanup can resume after a restart; never remove unrelated directories.

Reconcile the browser after SSE reconnect and device wake, send idle heartbeats, and retain a periodic recovery refresh. Distinguish upcoming replays, unavailable feeds, catalog errors, server disconnection, storage outages, and empty libraries. Native playback and Save MP4 share the same file and HTTP range endpoint.

## Implementation checklist

- [x] Replace conversion/database code with the fixed download policy and durable queue/deletion state.
- [x] Guard storage, validation, shutdown, worker errors and retries.
- [x] Harden the pinned upstream engine's feed/audio selection and test the compatibility patch.
- [x] Implement the approved dark React interface with real catalog data and accessible interactions.
- [x] Provision the dedicated NFS directory/marker, update Compose and Drone startup checks.
- [x] Run type checks, API/worker/storage tests, builds and desktop/mobile browser verification.
- [ ] Scan staged changes for secrets, commit and push. Verify Drone and exact production commit.
- [ ] Reset production library state retaining credentials; verify a fresh English-only 720p download on NFS and restart recovery.

The referenced writing-plans helper is not installed in this environment; this document records the approved design and executable implementation checklist directly.
