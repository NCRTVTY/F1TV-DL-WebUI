# Documentation map

Current onboarding starts at the root [README](../README.md) and [llms.txt](../llms.txt).

- [Storage](storage.md): capacity budgets, persistence, permissions and NFS.
- [Operations](operations.md): bounded health checks, backups, keys, updates and recovery.
- [Deployment](deployment.md): local Docker builds and optional CI/Drone.
- [Explicit library reset](maintenance.md): destructive maintenance, never onboarding.
- [Scripts](../scripts/README.md): automatic patches/build steps and maintenance scope.
- [Licenses and exclusions](../THIRD_PARTY_NOTICES.md): MIT application scope and retained third-party terms.

`IMPLEMENTATION-SPEC.md`, dated files under `plans/`, and HTML design studies
record historical requirements and decisions. They may describe old hosts,
frameworks, ports, feed policies or removed transcoding. Do not use them to
override current user instructions, README, Compose, configuration or tests.
