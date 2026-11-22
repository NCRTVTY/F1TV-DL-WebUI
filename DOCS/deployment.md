# Docker and CI deployment

The same Dockerfile and Compose file support local builds and CI. The root
README's Docker path does not require Drone, a registry account or host Node.js.
Configure and validate storage before either workflow.

Build your own image from the included Dockerfile. The standard installation is
`docker compose up -d --build`; it does not depend on a project-provided prebuilt
image. The registry workflow below is optional for operators running their own CI.

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

The tracked `.drone.yml` contains the existing production pipeline. Its runner,
registry, paths, storage checks and secret references are deployment-specific;
preserve them when updating that installation. Operators adapting the pipeline
must supply their own configuration and secret store. The standard Compose
installation does not require this pipeline.

The pipeline verifies repository checks, builds a commit-tagged image, checks
host storage prerequisites and existing mount identities, backs up SQLite, and
verifies the deployed commit and writable storage. Host prerequisites must be
provisioned separately; deployment does not install them. It aborts while
downloads are queued/running. Retry once idle.

If you distribute a prebuilt image to others, record the exact binary/source
package versions and satisfy the source and notice obligations in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
A generic upstream source link or project MIT notice alone is not sufficient.
