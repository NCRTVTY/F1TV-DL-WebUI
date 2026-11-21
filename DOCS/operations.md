# Health checks, backups and updates

## Verify the installation

Use `docker compose config --quiet` to validate without printing a resolved
configuration that may contain an encryption key. Never paste full environment,
database, provider-session or resolved-config dumps into a chat or issue.

Inspect persistent mounts without exposing environment values:

```sh
docker compose ps
docker inspect --format '{{range .Mounts}}{{println .Type .Source .Destination .RW}}{{end}}' "$(docker compose ps -q app)"
```

Both `/app/data` and `/app/downloads` need writable persistent storage. This
bounded check uses Node already installed inside the container, not host Node:

```sh
docker compose exec -T app node -e 'fetch("http://127.0.0.1:43729/api/health",{signal:AbortSignal.timeout(8000)}).then(async r=>{const d=await r.json();console.log(JSON.stringify({ok:d.ok,storage:d.storage,queue:d.queue},null,2));if(!r.ok||!d.storage.ready||!d.storage.writable||!d.storage.enoughSpace)process.exitCode=1}).catch(()=>{console.error("Health/storage check did not complete");process.exitCode=1})'
```

Check reported free bytes against the planned queue, not just `enoughSpace`.
The Docker healthcheck requires writable storage but does not prove a whole
replay fits. Network probes can time out; do not accumulate repeated blocked
probes or treat an unknown capacity as sufficient space.

## Backups and encryption keys

Back up the full local data volume: SQLite, provider session, generated
`credential-encryption.key`, relevant configuration and existing media separately.
Use a consistent SQLite backup, or stop the idle app before copying its data.
Copying only an active SQLite main file can omit WAL contents. `.sqlite-wal` and
`.sqlite-shm` are sidecars, not standalone backup databases; check real `.sqlite`
backup files when validating a restore.

A fresh installation generates its own private key. An explicit
`APP_ENCRYPTION_KEY` from the process environment or CI secret store wins. Keep
an existing installation's original key unchanged. Lost/changed keys make saved
credentials unreadable. Restore the correct key/data rather than resetting the
database or generating a replacement to hide a recovery problem.

Protect backups: the database and key together can reveal the saved account.
Use an external secret store when applicable. Repository-local secret files,
only when explicitly required, belong in ignored root `SECRETS/`. Use `.env` for
non-secret paths/settings and never commit credentials or provider sessions.

## Stop or update

Finish active downloads and resolve pending work first. Pause affects the next
job, not a running transfer. Interrupted downloads restart from the beginning.

```sh
docker compose down
git pull
docker compose up -d --build
```

Ordinary `down` preserves named volumes. Do not add `-v`, remove volumes, run
`docker system prune --volumes`, or reset the library as an onboarding/update
step. Preserve an existing server's project identity, data path, external key,
media volume/options, NFS guard, marker, port and image settings. Verify the same
library after starting. The maintainer's Drone pipeline requires an idle queue;
it aborts a busy deployment instead of waiting automatically. Retry once idle.

## Troubleshooting

| Symptom | Next check |
| --- | --- |
| Clone fails | Check the repository URL, Git installation, network connection and any required Git authentication |
| Build fails with disk/signature/write errors | Check Docker host/VM capacity; do not disable package-signature checks |
| Permission denied | Verify the actual mount, then narrowly fix UID/GID 1000 ownership/ACLs |
| Storage offline or wrong identity | Restore the expected disk/export; check marker and host authorization |
| Low space / queue waiting | Check actual media free bytes and budget; select a larger disk or quota |
| Saved account will not unlock | Restore the original key and data; do not reset or rotate keys |
| Replay unavailable | Check subscription/region, replay timing, feed, 720p and English availability |
| Browser playback fails | Check H.264/HEVC support; try the saved file in a compatible local player |
| No offline file on a flight | Save the complete MP4 to the travel device, then test networking off |

The destructive [library reset](maintenance.md) is documented separately and
requires an explicit request. It is never a default repair step.
