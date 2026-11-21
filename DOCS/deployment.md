# Docker and CI deployment

The same Dockerfile and Compose file support local builds and CI. The root
README's Docker path does not require Drone, a registry account or host Node.js.
Configure and validate storage before either workflow.

## Build and run separately

```sh
docker build -t f1tv-dl-webui:local .
docker compose up -d --no-build
```

Default storage is persistent Docker volumes. Other disks use `DOWNLOAD_PATH`;
direct NFS uses the advanced settings in [storage](storage.md).

## Registry image built by your CI

1. In a Node.js 22 job with FFmpeg/FFprobe, run `npm ci` and `npm run verify`.
2. Build the Dockerfile, tag the image with the source commit and push it to your
   own registry. Set build argument `DRONE_COMMIT` to that commit when using this
   repository's build metadata convention. Keep the generated notices.
3. On the Docker host, set `APP_IMAGE` to that full reference, `TAG` to the same
   commit, and the host's storage/port settings. Preserve an existing key through
   its original secret store; a new default installation can generate its key.
4. With an idle queue and backups ready, run:

   ```sh
   docker compose config --quiet
   docker compose pull
   docker compose up -d --no-build
   ```

5. Verify the exact image/commit, persistent mounts, saved account, free-space
   budget, health and existing files. Never print keys or the full resolved config.

## Drone

The tracked `.drone.yml` performs these steps for the maintainer's home. Its
runner selector, registry, data bind, NFS export and port are installation-specific.
Other operators must adapt those values and supply their own secret store when
using an externally managed key. They do not need the maintainer's LAN or disks.
The MIT grant does not grant access to that private infrastructure or account.

See [home deployment](home-deployment.md) for the existing installation that must
remain intact. The pipeline backs up SQLite, checks existing mount identities,
and aborts deployment while downloads are queued/running. Retry it once idle.

Repository visibility stays private. Before distributing any prebuilt image
publicly, record the exact binary/source package versions and satisfy the source
and notice obligations in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
A generic upstream source link or project MIT notice alone is not sufficient.
