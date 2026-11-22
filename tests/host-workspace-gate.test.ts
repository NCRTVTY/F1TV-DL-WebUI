import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true });
});

// Exercise the production shell's decisions without mounting or calling systemd
// on the test machine. A separate live namespace test uses real mount tables.
function run(state: Record<string, unknown>, mode = "--check") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-workspace-gate-"));
  temporary.push(dir);
  const statePath = path.join(dir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state));
  const command = path.join(dir, "command.cjs");
  fs.writeFileSync(command, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const file=process.env.GATE_TEST_STATE,s=JSON.parse(fs.readFileSync(file)),name=path.basename(process.argv[1]);
const args=process.argv.slice(2),media='/mnt/homelab-workspace/f1tv-dl';
if(name==='findmnt') {
  if(s.missing)process.exit(1);
  if(args.includes('--output'))console.log(s.record||'192.168.0.15:/volume2/Homelab-workspace nfs4 rw,hard');
} else if(name==='readlink') console.log(s.symlink?'/other/path':media);
else if(name==='stat')console.log(s.magic||'6969');
else if(name==='cat')console.log(s.marker||'f1tv-dl-media-v1');
else if(name==='systemctl') {s.mountAttempts=(s.mountAttempts||0)+1;s.lastMountArgs=args;}
else if(name==='sleep') {
  s.cycles=(s.cycles||0)+1;
  if(s.cycles>=s.recoverAfter){delete s.missing;delete s.record;}
}
fs.writeFileSync(file,JSON.stringify(s));
`);
  fs.chmodSync(command, 0o755);
  for (const name of ["findmnt", "readlink", "stat", "cat", "systemctl", "sleep"])
    fs.symlinkSync(command, path.join(dir, name));
  const result = spawnSync("/bin/sh", ["deploy/harlem/wait-for-workspace.sh", mode], {
    env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, GATE_TEST_STATE: statePath },
    encoding: "utf8",
    timeout: 4000,
  });
  return { ...result, state: JSON.parse(fs.readFileSync(statePath, "utf8")) };
}

describe("Docker host workspace startup gate", () => {
  it("accepts only the expected writable NFS media identity", () => {
    expect(run({}).status).toBe(0);
  });

  it.each([
    { missing: true },
    { record: "192.168.0.15:/volume2/Homelab-workspace ext4 rw" },
    { record: "192.168.0.99:/volume2/Homelab-workspace nfs4 rw" },
    { record: "192.168.0.15:/volume2/OtherShare nfs4 rw" },
    { record: "192.168.0.15:/volume2/Homelab-workspace nfs4 ro,hard" },
    { symlink: true },
    { magic: "ef53" },
    { marker: "another-library" },
  ])("rejects an unsafe attachment: %j", (state) => {
    const result = run(state);
    expect(result.status).toBe(1);
    expect(result.state.mountAttempts).toBeUndefined();
  });

  it("waits and retries the fstab unit until the share returns", () => {
    const result = run({ missing: true, recoverAfter: 2 }, "--wait");
    expect(result.status).toBe(0);
    expect(result.state.cycles).toBe(2);
    expect(result.state.mountAttempts).toBe(2);
    expect(result.state.lastMountArgs).toEqual(["--no-block", "start", "mnt-homelab\\x2dworkspace.mount"]);
  });

  it("never mounts over a wrong existing share while waiting for correction", () => {
    const result = run({ record: "wrong:/export nfs4 rw", recoverAfter: 2 }, "--wait");
    expect(result.status).toBe(0);
    expect(result.state.cycles).toBe(2);
    expect(result.state.mountAttempts).toBeUndefined();
  });
});
