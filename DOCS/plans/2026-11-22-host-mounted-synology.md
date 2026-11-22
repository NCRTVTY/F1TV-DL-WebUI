# Harlem host-mounted Synology attachment

The requested design attaches the existing NAS directory through
`/mnt/homelab-workspace/f1tv-dl:/app/downloads` and preserves the local data bind,
key, library, ports, permissions, image pipeline and restart policy. No data is
moved. The existing Docker NFS volume and its options remain for rollback.

An application entrypoint wait is too late to prevent a wrong bind. A separate
container supervisor would also need to replace Docker's restart policy and
coordinate every deployment. Instead, install a Docker service ExecStartPre gate
that verifies the exact host NFS export, read/write attachment, non-symlink media
path, NFS filesystem and existing storage marker before dockerd starts. It retries
the existing fstab mount unit when absent and waits without a startup timeout.
All Docker startup waits for this one export; SSH has no dependency on Docker.
Attached hard NFS reads use one synchronous probe and kernel recovery, not a
growing collection of timed-out processes. Existing fstab options are untouched.

Version the gate, installer and attachment checks under `deploy/harlem/`; Drone
installs them on the actual host and reloads systemd before applying Compose.
The privileged installer uses the existing Docker administrative access, changes
only the documented gate files, backs up previous gate configuration and never
restarts Docker. CI accepts only the known legacy volume or desired host bind;
the first transition compares NAS directory and replay inodes/sizes.

Verify missing/wrong/local/readonly storage rejection and automatic recovery;
exercise the real gate in an isolated mount namespace without unmounting the
live host share. Check systemd's loaded boot path, SSH independence and unchanged
unrelated containers. Record the limitations: no host reboot or physical NAS
outage is part of this task. Verify all four HTTP replay files before/after,
mount identity inside the container, a unique temporary write and its removal,
account/database preservation, successful Drone deployment and rollback steps.
