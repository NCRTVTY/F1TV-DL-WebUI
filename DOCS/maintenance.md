# Explicit library reset

This destructive maintenance operation is not an installation, repair or update
step. AI agents must not run it without an explicit request to clear this library.
Use normal restart, storage and key diagnostics first. Never delete volumes or
regenerate keys to repair a setup.


After confirming the queue has no queued or running jobs, the authorized one-time reset is:

```sh
docker exec f1tv-dl-webui node scripts/reset-library.cjs --confirm-reset-library
```

It creates a private SQLite backup under local `data/backups/`, clears job history, catalog cache and preferences, and verifies that the saved encrypted account remains identical. It leaves the local encryption key, provider session and all media files untouched. It never runs automatically on deployment or startup. Refresh the browser afterward.

See [the historical scope](plans/2026-11-19-720p-nfs-redesign.md) for layout and rollout acceptance criteria. The earlier implementation specification is historical where it differs from this policy.
