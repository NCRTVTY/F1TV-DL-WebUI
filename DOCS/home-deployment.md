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

The old `f1tv-dl-media` Docker volume was retired after verifying the host bind.
It is not a backup or another copy of the downloads. The home pipeline no longer
supplies its NFS driver settings or requires that volume to exist; its attachment
guard accepts only the host bind above. Keep the generic Compose named-volume
support for other installations separate from this home configuration.

The existing `f1tv-dl-media-v1` storage marker identifies the NAS directory. It is
independent of Docker's volume definitions and stays unchanged. Keep the Docker
startup gate installed while this or other applications bind the workspace.

Keep the local database off NFS. Back up the local data directory and the deployment encryption key securely. `APP_ENCRYPTION_KEY` must remain stable; Drone supplies it from `F1TV_DL_WEBUI_ENCRYPTION_KEY`. Changing it makes saved credentials unreadable, and startup now verifies that the saved account can be decrypted before reporting healthy. API responses never return stored account values. The service is designed for the existing trusted LAN/VPN; public hostname and TLS routing are managed outside this repository.

The legacy local media folder is no longer mounted. Existing content is not migrated or imported.
