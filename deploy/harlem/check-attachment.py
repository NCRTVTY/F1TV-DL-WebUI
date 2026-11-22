#!/usr/bin/env python3
"""Host-side deployment guard. Never inspect or print container environment."""
import json
import subprocess

MEDIA = "/mnt/homelab-workspace/f1tv-dl"
DATA = "/home/ronny/docker/f1tv-dl-webui/data"


def inspect(*args):
    return json.loads(subprocess.check_output(["docker", *args], text=True))


subprocess.run(["/usr/local/sbin/f1tv-wait-for-workspace", "--check"], check=True)
mounts = inspect("inspect", "f1tv-dl-webui", "--format", "{{json .Mounts}}")
by_target = {m["Destination"]: m for m in mounts}
data, media = by_target["/app/data"], by_target["/app/downloads"]
assert data["Type"] == "bind" and data["Source"] == DATA and data["RW"], "Refusing to change application data"
assert media["RW"], "Existing media is read-only"
assert media["Type"] == "bind" and media["Source"] == MEDIA, "Unexpected existing media bind"
print(json.dumps({"attachment": "verified host NFS bind", "dataUnchanged": True}))
