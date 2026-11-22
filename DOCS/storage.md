# Storage planning

Check three separate locations: Docker's build/image disk, the replay filesystem,
and the travel device. With a remote Docker context, the relevant host is the
server running Docker, not necessarily the laptop running the commands.

## Persistent or disposable?

| Configuration | Persistence | Check |
| --- | --- | --- |
| Default Compose named `data` and `media` volumes | Survives container replacement and ordinary `down` | Docker disk/VM capacity and backups |
| Local or USB bind path | Survives container replacement | Correct path/drive and UID/GID 1000 access |
| Already-mounted NAS bind path | Depends on the intended share staying mounted | Actual server/share, filesystem and permissions |
| Direct Docker NFS volume | Files live on the NAS | Export authorization, marker and NFS guard |
| Container writable layer with no persistent mounts | Lost on removal/replacement | Choose persistent mounts before a real installation |
| tmpfs, `/tmp`, disposable CI workspace | Volatile | Use only for an explicitly approved disposable test |

An external disk is not required: named volumes are persistent. They are not a
backup. `docker compose down` keeps them; `down -v`, volume deletion, a Docker
Desktop reset, disk failure or loss of the Docker storage disk can lose data.

## Plan capacity

These are recommendations, not benchmarked minima or file-size guarantees:

| Location | Practical starting allowance |
| --- | --- |
| Docker images, build layers and updates | At least 10 GB free, more for other apps and retained caches |
| Local account, queue and browser-session data | Allow at least 1 GB plus backups/growth; keep it off NFS |
| Replay library | Start with 20 GB free; budget about 8 GB per long replay plus working headroom |
| Travel device | Space for the complete chosen file plus free-space headroom |

If these locations share a physical disk or Docker VM, add their budgets: do not
count the same free bytes several times. The default named-volume setup shares
Docker storage; these starting allowances total about 31 GB before other workloads.

Observed 720p files in the maintainer's installation ranged from 1.86 GB to
4.10 GB. These are examples, not upper bounds. Longer sessions or higher provider
bitrates can be larger. Plan for retained files, every queued replay, space for
the largest planned replay again as working headroom, and an OS reserve.
The app normally stages one MP4 then renames it; this allowance does not imply
that it always creates two complete copies or transcodes files.

The default application admission floor is **2,000,000,000 bytes free** (2 GB,
about 1.86 GiB) before claiming a download. This is not a space reservation,
queue-size calculation or guarantee that a whole replay fits. A target with
200 MB free cannot start. Choose another disk, mount a suitable NAS, expand the
appropriate quota, or remove only files you explicitly choose to delete. Do not
lower `STORAGE_MIN_FREE_BYTES` to conceal the problem.

Docker Desktop's VM/disk-image limit is separate from host free space: a Mac
with hundreds of GB free can still have a full Docker VM. A large NAS also does
not solve a full Docker build disk. Check both before building.

## Local or USB path

Set `DOWNLOAD_PATH` in the ignored `.env` to an absolute path on the Docker host.
Create the intended local directory and grant UID/GID 1000 read/write access and
permission to traverse parent directories. Prefer narrowly scoped ownership or
ACL changes; do not recursively change an entire share or default to `chmod 777`.
Docker Desktop must be allowed to share that drive/path with the container.

Choose the location before downloading. The app does not import existing media
or migrate the library when a storage setting changes. Existing installations
need a migration plan preserving the database, key and relative media paths.

## An already-mounted network share

On the actual Linux Docker host, inspect `findmnt -T /your/download/path` (or the
platform's mount inspection) and verify the expected server/share and filesystem.
A directory merely existing is insufficient: Compose's short bind syntax can
create a local directory at a misspelled or unmounted path.

If the share is absent, reconnect it or deliberately select another real disk.
Never create a substitute folder at the expected NAS path to make checks pass.
Check export/share authorization for the actual Docker host and UID/GID access.
SMB/CIFS needs host-level identity/availability checks; the application's NFS
guard does not validate arbitrary network filesystem types.

Before using a host-mounted share with Docker's automatic restart policy, install
a host startup gate that verifies the expected export **before dockerd starts**.
An entrypoint wait or checking a directory after Docker has bound it is too late:
mounting NFS later does not repair a container's existing private bind. The
maintainer's [home deployment](home-deployment.md#host-startup-gate) documents one
Linux/systemd approach and its effect on all Docker startup. For an NFS bind,
retain `REQUIRE_NFS=true` and the marker guard; use ordinary `rw` bind options.

## Direct Docker NFS volume

Use your own server/export in these non-secret `.env` settings. Leave
`DOWNLOAD_PATH` unset so Compose uses its named `media` volume:

```dotenv
MEDIA_TYPE=nfs
MEDIA_DEVICE=:/export/replays
MEDIA_OPTIONS=addr=nas.example,nfsvers=4.1,rw,hard,timeo=50,retrans=2
DOWNLOAD_MOUNT_OPTIONS=rw,nocopy
REQUIRE_NFS=true
STORAGE_ID=f1tv-dl-media-v1
STORAGE_LABEL=My NAS / replays
```

This requires a Linux Docker host with NFS support and export authorization for
its actual client address. Grant UID/GID 1000 access, confirm the intended export,
then put `.f1tv-storage-id` there with the configured `STORAGE_ID`. Do not
overwrite an existing marker to silence an identity mismatch.

Docker mounts the export before startup. The app checks NFS type, the marker,
write access and free space. Failed readiness keeps jobs waiting; guarded NFS
mode has no local-folder fallback. Hard NFS mounts retain kernel retry behavior.

Named-volume driver options are fixed at creation. Changing them requires a
migration plan, preservation of existing media, and a new `MEDIA_VOLUME_NAME`.
Do not delete a volume or reset the library as a shortcut. Keep SQLite and the
provider session on local persistent storage, separate from NFS media.
