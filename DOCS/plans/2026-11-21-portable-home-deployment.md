# Portable deployment with preserved home storage

## Approved design

Keep one Dockerfile, one configurable Compose file and the tracked Drone pipeline.
The default deployment builds locally and uses persistent Docker volumes. Operators
can select another disk with a direct bind mount or configure NFS. Drone supplies
the existing Harlem settings explicitly, including the existing data bind, media
volume name and NFS options, storage marker, port and encryption-key secret.

New installations generate a persistent private encryption key in their data
volume. An explicit environment key always wins. Existing encrypted accounts must
never silently receive a new key when their original key is absent. Storage labels
come from configuration; filesystem, write and free-space checks remain in place.

The user additionally approved the original broadcast for pre-2022 archive races.
Those jobs select the original main feed explicitly; 2022 onward still requires
F1 LIVE without fallback. Both paths require native 720p and English audio.

Repository visibility stays private. License selection and redistribution rights
for bundled photography remain publication gates, separate from deployment.

## Production baseline

Before changes, Harlem runs commit 46d94a223a2b64ae7d0504960ad4225f5fe94a41.
The queue is idle and unpaused, with exactly three completed, available downloads:

| Job | Title | Bytes |
| --- | --- | --- |
| ca3e790a-bb20-4c06-be90-9bd032a87878 | 2026 São Paulo GP - Qualifying | 3754139888 |
| 3c31b216-e5ef-41d2-8c05-e6ba8340aeb8 | 2026 São Paulo Grand Prix | 3135113249 |
| e6fd28ed-7620-432c-90f6-483e82026716 | 2026 Singapore GP - Qualifying | 1856805449 |

All use `<job-id>/replay.mp4`. Data is bound from
`/home/ronny/docker/f1tv-dl-webui/data`; downloads use volume `f1tv-dl-media`,
with type `nfs`, device `:/volume2/Homelab-workspace/f1tv-dl`, and options
`addr=192.168.0.15,nfsvers=4.1,rw,hard,timeo=50,retrans=2,rsize=1048576,wsize=1048576`.

## Implementation and verification plan

1. Parameterize Compose; keep local-image build and registry-image deployment.
2. Make NFS opt-in, storage labels configurable and credential-key creation safe.
3. Add the narrowly scoped archive-feed policy and regression checks.
4. Document a fresh Docker installation, other disks, NFS and the home pipeline.
5. Verify types, tests, builds, both Compose configurations and a fresh container
   with persistent storage and key across restart.
6. Back up production SQLite privately. Check the resolved home mounts before
   pushing; scan staged content and reachable history for secrets.
7. Push to main to trigger Drone. Verify its exact deployed commit, unchanged
   mounts, saved-account decryptability and all three original files including
   real byte-range requests.
8. Browse 2012 season, Brazil, queue the race and verify actual file growth on
   the Synology export through both container and host paths. Record the result.

Do not reset the library, migrate media, rotate the home key or publish the repo.
