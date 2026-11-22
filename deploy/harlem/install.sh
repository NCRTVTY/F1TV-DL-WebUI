#!/bin/sh
# Install on Harlem as root; daemon-reload only, NEVER restart Docker here.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Host root access is required' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment=/home/ronny/docker/f1tv-dl-webui/deployment
gate=/usr/local/sbin/f1tv-wait-for-workspace
dropin=/etc/systemd/system/docker.service.d/30-f1tv-workspace.conf

install -d -m 755 "$deployment" /etc/systemd/system/docker.service.d
# Keep exact previous host configuration, including absence, for rollback.
if ! cmp -s "$source_dir/wait-for-workspace.sh" "$gate" || ! cmp -s "$source_dir/docker-workspace.conf" "$dropin"; then
  backup=$(mktemp -d "$deployment/before-gate-XXXXXXXX")
  chmod 700 "$backup"
  for target in "$gate" "$dropin"; do
    name=$(basename "$target")
    if [ -e "$target" ]; then cp -p "$target" "$backup/$name"; else touch "$backup/$name.absent"; fi
  done
fi
for name in wait-for-workspace.sh install.sh check-attachment.py docker-workspace.conf verify-gate-namespace.sh; do
  install -m 644 "$source_dir/$name" "$deployment/$name"
done
install -m 755 "$source_dir/wait-for-workspace.sh" "$gate"
install -m 644 "$source_dir/docker-workspace.conf" "$dropin"
systemctl daemon-reload
"$gate" --check
systemctl show docker.service -p ExecStartPre --value | grep -F "$gate --wait" >/dev/null
echo 'Docker startup gate installed and loaded; running services were not restarted'
