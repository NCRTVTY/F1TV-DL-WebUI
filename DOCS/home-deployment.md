# Maintainer home deployment

This is the existing private home installation. New users should follow the root
[README](../README.md); do not copy these host paths, registry or NAS address.


The tracked `.drone.yml` explicitly supplies the existing home configuration to the same portable Compose file. Drone is the production deployment path. A push to `main` verifies the repository on Harlem, builds and pushes an immutable commit-tagged image, applies Compose and verifies the exact commit and writable storage at `/api/health`.

- Local SQLite and provider session: `/home/ronny/docker/f1tv-dl-webui/data` → `/app/data`.
- Media: Synology `192.168.0.15:/volume2/Homelab-workspace/f1tv-dl` → Docker NFS volume `f1tv-dl-media` → `/app/downloads`.
- Host service port: `43729`.

Deployment refuses an unexpected existing data path or media volume and requires an idle queue before replacing the container. It creates a private SQLite backup first; it never resets the library.

The NAS directory is also visible on Harlem at `/mnt/homelab-workspace/f1tv-dl`. It must contain `.f1tv-storage-id` with the non-secret identity `f1tv-dl-media-v1`, and allow UID/GID 1000 to write. Compose mounts that export directly with `volume.nocopy`; it never binds a local downloads directory. Docker waits for the NFS mount before starting the application. The application then requires an NFS filesystem, matching identity, write access and sufficient free space before claiming jobs. Failed readiness keeps the durable queue waiting. Storage probes time out after five seconds and never accumulate duplicate blocked probes. Hard NFS mounts retain their kernel-level retry behavior during outages.

Keep the local database off NFS. Back up the local data directory and the deployment encryption key securely. `APP_ENCRYPTION_KEY` must remain stable; Drone supplies it from `F1TV_DL_WEBUI_ENCRYPTION_KEY`. Changing it makes saved credentials unreadable, and startup now verifies that the saved account can be decrypted before reporting healthy. API responses never return stored account values. The service is designed for the existing trusted LAN/VPN; public hostname and TLS routing are managed outside this repository.

The legacy local media folder is no longer mounted. Existing content is not migrated or imported.
