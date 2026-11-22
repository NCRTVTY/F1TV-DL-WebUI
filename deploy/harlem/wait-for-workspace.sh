#!/bin/sh
# Runs on the Docker host BEFORE dockerd can restore containers and bind paths.
set -eu

workspace=/mnt/homelab-workspace
media=$workspace/f1tv-dl
expected_source=192.168.0.15:/volume2/Homelab-workspace
mount_unit='mnt-homelab\x2dworkspace.mount'

ready() {
  record=$(findmnt --noheadings --raw --nocanonicalize --mountpoint "$workspace" --output SOURCE,FSTYPE,OPTIONS 2>/dev/null) || return 1
  # This export has no whitespace; reject multiple mounts or unexpected fields.
  set -- $record
  [ "$#" -eq 3 ] || return 1
  [ "$1" = "$expected_source" ] || return 1
  case "$2" in nfs|nfs4) ;; *) return 1 ;; esac
  case ",$3," in *,rw,*) ;; *) return 1 ;; esac
  [ "$(readlink -e "$media")" = "$media" ] || return 1
  [ "$(stat -f -c %t "$media")" = 6969 ] || return 1
  [ "$(cat "$media/.f1tv-storage-id")" = f1tv-dl-media-v1 ] || return 1
}

case "${1:---check}" in
  --check)
    if ! ready; then
      echo 'Expected Synology workspace/media identity is not ready' >&2
      exit 1
    fi
    ;;
  --wait)
    while ! ready; do
      echo 'Waiting for Synology workspace; Docker has not started' >&2
      # Use the EXISTING fstab-generated unit and its options. Never create a
      # directory, unmount a live share, or stack a mount over an unexpected one.
      if ! findmnt --noheadings --nocanonicalize --mountpoint "$workspace" >/dev/null 2>&1; then
        systemctl --no-block start "$mount_unit" || true
      fi
      sleep 5
    done
    echo 'Expected Synology workspace and F1TV media identity verified'
    ;;
  *) echo 'Usage: f1tv-wait-for-workspace [--check|--wait]' >&2; exit 2 ;;
esac

# A read on an attached hard NFS mount can wait for kernel recovery. It is
# deliberately synchronous: do not accumulate timed-out NFS probe processes.
