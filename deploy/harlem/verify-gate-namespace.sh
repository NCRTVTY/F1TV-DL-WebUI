#!/bin/sh
# Manual host-root verification. Changes mount attachments ONLY in a fresh,
# private namespace, never the host's mount namespace or live NAS contents.
set -eu
if [ "${1:-}" != --isolated ]; then
  exec unshare --mount --propagation private /bin/sh "$0" --isolated
fi
[ "$(readlink /proc/self/ns/mnt)" != "$(readlink /proc/1/ns/mnt)" ]
gate=/usr/local/sbin/f1tv-wait-for-workspace
workspace=/mnt/homelab-workspace
temporary=$(mktemp -d /run/f1tv-gate-verification-XXXXXXXX)
saved=$temporary/expected
waiter=
cleanup() {
  if [ -n "$waiter" ]; then kill "$waiter" 2>/dev/null || true; wait "$waiter" 2>/dev/null || true; fi
  if mountpoint -q "$saved"; then umount "$saved"; fi
  rm -rf "$temporary"
}
trap cleanup EXIT
reject() {
  if "$gate" --check >"$temporary/check.log" 2>&1; then
    echo "Unsafe attachment was accepted: $1" >&2
    exit 1
  fi
  echo "Rejected: $1"
}
"$gate" --check
mkdir "$saved"
mount --bind "$workspace" "$saved"
umount "$workspace"
reject 'absent mount, underlying local directory'

mount -t tmpfs -o size=1m,mode=755 tmpfs "$workspace"
mkdir "$workspace/f1tv-dl"
printf '%s\n' f1tv-dl-media-v1 >"$workspace/f1tv-dl/.f1tv-storage-id"
reject 'local filesystem, even with a matching marker'
umount "$workspace"

mount --bind "$saved/f1tv-dl" "$workspace"
reject 'NFS with the wrong export root'
umount "$workspace"

mount --bind "$saved" "$workspace"
mount -o remount,bind,ro "$workspace"
reject 'read-only expected NFS export'
umount "$workspace"

"$gate" --wait >"$temporary/wait.log" 2>&1 &
waiter=$!
sleep 1
kill -0 "$waiter"
if grep -q 'identity verified' "$temporary/wait.log"; then
  echo 'Startup passed before storage was restored' >&2
  exit 1
fi
mount --bind "$saved" "$workspace"
wait "$waiter"
waiter=
"$gate" --check
echo 'Waited while absent and recovered automatically after the expected NFS mount returned'
