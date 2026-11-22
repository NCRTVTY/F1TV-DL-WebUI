# Script guide

Normal Docker installation only needs the root README's Compose commands.
Do not run maintenance scripts as part of onboarding.

The installation-specific [deploy/harlem](../deploy/harlem/) scripts are separate
host administration: Drone installs the workspace startup gate and verifies the
existing media attachment before applying Compose. They are not required for a
normal local Docker-volume installation. See [home deployment](../DOCS/home-deployment.md)
for exact installed files, startup consequences and rollback.

| Script / command | Purpose | When it runs |
| --- | --- | --- |
| `patch-f1tv-dl.mjs` | Apply exact-version authentication and media-policy patches | Automatically during `npm ci` / install, including Docker builds |
| `f1tv-token.cjs` | Replacement authentication module loaded by that patch | Through the downloader, not a manual credential-entry utility |
| `patch-download-policy.mjs` | Native 720p, explicit feed and English-track selection; rejects source drift | Called by postinstall; safe to re-run against supported exact sources |
| `download-policy-hashes.json` | Integrity fingerprints of pinned upstream source | Read by the patch; these are not account keys |
| `prepare-notices.mjs` / `npm run licenses` | Generate the lockfile license inventory and copy original/third-party notices to the client | Automatically before the production client build; requires installed npm dependencies |
| `reset-library.cjs` | **Destructive:** clear queue/history/cache/preferences after a private backup | Never automatic; requires the explicit reset flag and an idle queue |

`npm run verify` performs type checks, tests (including real FFmpeg media checks),
notice generation and builds. Patches do not silently accept modified upstream
code; investigate a drift failure rather than skipping postinstall or editing
integrity fingerprints to suppress it. `npm ci --ignore-scripts` is not a valid
installation of this patched downloader.

`prepare-notices.mjs` reads the current lockfile. It keeps legacy license
declarations explicit, rejects unknown missing declarations and requires exact
source records for MPL package versions. Generated `public/licenses/` files are
ignored by Git and included by Vite in `dist/client/licenses/`; do not hand-edit
them. Update root notices and `LICENSES/mpl-sources.json`, then regenerate. The
image also retains npm and Debian package notices; public binary redistribution
still needs the corresponding-source review in `THIRD_PARTY_NOTICES.md`.

For a deliberately requested reset, read [maintenance](../DOCS/maintenance.md).
For installation, capacity, missing disks and account-key recovery, use
[llms.txt](../llms.txt) and [operations](../DOCS/operations.md) instead. None of
these scripts should print real credentials, session cookies or signed URLs.
