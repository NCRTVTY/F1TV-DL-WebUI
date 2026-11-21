# Repository Security

- Never request, provide, invent, echo, commit, or push credentials, tokens, private keys, passwords, or other sensitive information.
- If Ronny explicitly requires repository-local secret files, store them only under the uppercase root `SECRETS/` directory.
- Keep `/SECRETS/` in the root `.gitignore` at all times.
- Before every commit and push, verify that no sensitive information or files from `SECRETS/` are staged or tracked.

## Installation and support

- Read [llms.txt](llms.txt) before helping with setup, storage changes, updates or offline-viewing checks. It defines persistence, capacity, mount validation and travel-device acceptance.
- Default Compose named volumes are persistent. Get explicit confirmation only for intentionally disposable storage; do not invent a confirmation requirement for the normal persistent setup.
- Stop on an absent expected network mount or an unusable capacity budget. Never create a local substitute at an expected NAS path, lower free-space protection, reset data or replace an existing encryption key to make checks pass.
- Preserve the maintainer's existing Drone/home configuration and library. The root README, current Compose/configuration and current operations guides take precedence over historical design plans.
- MIT covers original project contributions; preserve the third-party terms in `THIRD_PARTY_NOTICES.md`. Changing a dependency requires checking its license/source notices too.
