#!/usr/bin/env python3
"""Host-side deployment guard. Never inspect or print container environment."""
import json
import os
import subprocess

MEDIA = "/mnt/homelab-workspace/f1tv-dl"
DATA = "/home/ronny/docker/f1tv-dl-webui/data"


def inspect(*args):
    return json.loads(subprocess.check_output(["docker", *args], text=True))


subprocess.run(["/usr/local/sbin/f1tv-wait-for-workspace", "--check"], check=True)
volume = inspect("volume", "inspect", "f1tv-dl-media")[0]
options = volume.get("Options") or {}
assert volume["Driver"] == "local", "Unexpected rollback volume driver"
assert options.get("type") == "nfs", "Unexpected rollback volume filesystem"
assert options.get("device") == ":/volume2/Homelab-workspace/f1tv-dl", "Unexpected rollback export"
assert "addr=192.168.0.15" in options.get("o", "").split(","), "Unexpected rollback NAS"

mounts = inspect("inspect", "f1tv-dl-webui", "--format", "{{json .Mounts}}")
by_target = {m["Destination"]: m for m in mounts}
data, media = by_target["/app/data"], by_target["/app/downloads"]
assert data["Type"] == "bind" and data["Source"] == DATA and data["RW"], "Refusing to change application data"
assert media["RW"], "Existing media is read-only"
if media["Type"] == "volume":
    assert media.get("Name") == "f1tv-dl-media", "Unexpected existing media volume"
    # Equal file IDs through the two exports prove an attachment change, not
    # a migration to an empty/different directory. Include every existing MP4.
    old = media["Source"]
    assert os.stat(old).st_ino == os.stat(MEDIA).st_ino, "NAS directory identity differs"
    compared = 0
    for root, dirs, files in os.walk(old):
        for name in files:
            if not name.endswith(".mp4"):
                continue
            source = os.path.join(root, name)
            target = os.path.join(MEDIA, os.path.relpath(source, old))
            a, b = os.stat(source), os.stat(target)
            assert (a.st_ino, a.st_size) == (b.st_ino, b.st_size), "Existing replay identity differs"
            compared += 1
    print(json.dumps({"attachment": "verified legacy NFS volume", "sameReplayInodesAndSizes": compared}))
else:
    assert media["Type"] == "bind" and media["Source"] == MEDIA, "Unexpected existing media bind"
    print(json.dumps({"attachment": "verified host NFS bind", "dataUnchanged": True}))
