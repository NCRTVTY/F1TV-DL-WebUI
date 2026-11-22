# Portable deployment with preserved storage

## Approved design

Keep one Dockerfile, one configurable Compose file and the tracked Drone pipeline.
The default deployment builds locally and uses persistent Docker volumes. Operators
can select another disk with a direct bind mount or configure NFS. Drone supplies
the existing deployment settings explicitly, preserving data and media
attachments, storage marker, port and encryption-key secret.

New installations generate a persistent private encryption key in their data
volume. An explicit environment key always wins. Existing encrypted accounts must
never silently receive a new key when their original key is absent. Storage labels
come from configuration; filesystem, write and free-space checks remain in place.

The user additionally approved the original broadcast for pre-2022 archive races.
Those jobs select the original main feed explicitly; 2022 onward still requires
F1 LIVE without fallback. Both paths require native 720p and English audio.

License selection and redistribution rights for bundled photography are separate
from deployment.

## Implementation and verification plan

1. Parameterize Compose; keep local-image build and registry-image deployment.
2. Make NFS opt-in, storage labels configurable and credential-key creation safe.
3. Add the narrowly scoped archive-feed policy and regression checks.
4. Document a fresh Docker installation, other disks, NFS and the CI pipeline.
5. Verify types, tests, builds, both Compose configurations and a fresh container
   with persistent storage and key across restart.
6. Back up production SQLite privately. Check the resolved existing mounts before
   pushing; scan staged content and reachable history for secrets.
7. Push to main to trigger Drone. Verify its exact deployed commit, unchanged
   mounts, saved-account decryptability and all three original files including
   real byte-range requests.
8. Browse 2012 season, Brazil, queue the race and verify actual file growth on
   the configured media filesystem through both container and host paths. Record the result.

Do not reset the library, migrate media or rotate the existing key.

## Archive integration finding

The first real Brazil 2012 request authenticated successfully but exposed an HLS
compatibility issue: its 1280×720 variant labels English as `en`, while the pinned
downloader compared only with `eng`. Its first/default audio track is `zxx`
(effects only); English is the second audio track. Accept explicit English HLS
language identifiers, never fall back to the default track, and annotate the
selected English track as `eng` when copying into MP4. A native five-second copy
confirmed that HLS does not otherwise retain an MP4 audio language tag. Keep the
full-file language, codec, resolution and duration validation unchanged.

A second native five-second copy with the selected English track and an explicit
MP4 language tag passed FFprobe checks: 1280×720 H.264, exactly one AAC audio
track tagged `eng`, without encoding. The full validation suite passes 85 tests.
