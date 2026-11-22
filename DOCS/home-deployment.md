# Maintainer home deployment

This is the maintainer's existing home installation. New users should follow the root
[README](../README.md); do not copy these host paths, registry or NAS address.


The tracked `.drone.yml` explicitly supplies the existing home configuration to the same portable Compose file. Drone is the production deployment path. A push to `main` verifies the repository on Harlem, builds and pushes an immutable commit-tagged image, applies Compose and verifies the exact commit and writable storage at `/api/health`.

- Local SQLite and provider session: `/home/ronny/docker/f1tv-dl-webui/data` → `/app/data`.
- Media: Synology `192.168.0.15:/volume2/Homelab-workspace` → existing fstab mount `/mnt/homelab-workspace` → bind `/mnt/homelab-workspace/f1tv-dl:/app/downloads:rw`.
- Host service port: `43729`.

Deployment refuses an unexpected existing data path or media attachment and requires an idle queue before replacing the container. It creates a private SQLite backup first; it never resets the library.

The NAS directory must contain `.f1tv-storage-id` with the non-secret identity `f1tv-dl-media-v1`, and allow UID/GID 1000 to write. This attaches the same existing NAS directory, without moving or importing files. `REQUIRE_NFS=true` remains set. The application requires an NFS filesystem, matching identity, write access and sufficient free space before claiming jobs. Failed readiness keeps the durable queue waiting. Application storage probes time out after five seconds and never accumulate duplicate blocked probes. Hard NFS mounts retain their kernel-level retry behavior during outages.

## Host startup gate

The maintained source is [deploy/harlem](../deploy/harlem/), installed by Drone
on the actual host before Compose runs. `/drone/src` is the CI checkout, not a
host deployment directory. Installed configuration:

- `/usr/local/sbin/f1tv-wait-for-workspace`: exact export/type/rw, canonical media
  path, NFS filesystem and storage-marker checks.
- `/etc/systemd/system/docker.service.d/30-f1tv-workspace.conf`: runs that script
  with `--wait` as Docker's `ExecStartPre`, with no startup timeout.
- `/home/ronny/docker/f1tv-dl-webui/deployment/`: maintained copies, attachment
  guard and `before-gate-*` backups of previous gate configuration.

This delays **all Docker container startup** while the workspace is unavailable,
including socket-activated Docker starts. It waits only for
`192.168.0.15:/volume2/Homelab-workspace` at `/mnt/homelab-workspace`; it does not
gate `/mnt/client-work` or `/mnt/fpv-archive`. If absent, it requests the existing
fstab-generated mount unit every five seconds. Wrong shares/readonly mounts are
rejected without mounting over them. A read on attached hard NFS waits for
kernel recovery synchronously, avoiding accumulated probe processes. SSH has no
Docker dependency and remains available. Neither fstab nor NFS tuning is changed.

Installation uses a short-lived privileged helper through existing Docker
administrative access, installs only these gate files, and runs
`systemctl daemon-reload`. It does **not** restart Docker or unrelated services.
An application entrypoint wait alone cannot prevent Docker from binding the
wrong underlying directory, so keep this gate installed while using the bind.

For a mount-only outage/recovery simulation, run as host root:

```sh
sh /home/ronny/docker/f1tv-dl-webui/deployment/verify-gate-namespace.sh
```

It creates a private mount namespace, rejects absent/local/wrong-root/read-only
attachments, waits while absent and verifies recovery after restoring the
expected NFS mount inside that namespace. It does not reboot Harlem, restart
Docker, unmount the live host share or simulate physical NAS/network loss.

The original `f1tv-dl-media` volume and its exact NFS options remain declared for
rollback; the service no longer uses it. Do not delete or prune it.

## Roll back the attachment

1. Wait for an idle queue and preserve data/key/media. Keep the workspace startup
   gate installed; it is also useful to other host-bound workspace services.
2. In `.drone.yml` set `DOWNLOAD_PATH: media` (the Compose volume key) and
   `DOWNLOAD_MOUNT_OPTIONS: rw,nocopy`. Retain the existing `MEDIA_VOLUME_NAME`,
   `MEDIA_TYPE`, `MEDIA_DEVICE` and `MEDIA_OPTIONS`, which identify the original
   `f1tv-dl-media` volume. Keep the current attachment guard; the pre-change guard
   rejected bind mounts and is not suitable for this reverse transition.
3. Commit/push through Drone. Its idle check and SQLite backup still run. Verify
   `/app/downloads` is again volume `f1tv-dl-media`, NFS/marker readiness and all
   four existing replays through their normal HTTP download links.

No data copy, volume removal, key change or whole-stack `down` is involved.
If deliberately undoing only the gate installation after reverting the media
attachment, restore the first `deployment/before-gate-*` backup: files marked
`.absent` were absent originally, otherwise restore the saved file to the matching
installed path above. Then run `systemctl daemon-reload`, without restarting
Docker. Removing the gate reintroduces the boot race for other NAS-bound apps.
For the initial installation, both gate files were absent: removing only
`/etc/systemd/system/docker.service.d/30-f1tv-workspace.conf` and
`/usr/local/sbin/f1tv-wait-for-workspace`, then running
`systemctl daemon-reload`, restores that original startup configuration. Do this
only as an intentional rollback after reverting the media attachment.

Keep the local database off NFS. Back up the local data directory and the deployment encryption key securely. `APP_ENCRYPTION_KEY` must remain stable; Drone supplies it from `F1TV_DL_WEBUI_ENCRYPTION_KEY`. Changing it makes saved credentials unreadable, and startup now verifies that the saved account can be decrypted before reporting healthy. API responses never return stored account values. The service is designed for the existing trusted LAN/VPN; public hostname and TLS routing are managed outside this repository.

The legacy local media folder is no longer mounted. Existing content is not migrated or imported.
