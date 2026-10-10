# Repository Security

- Never request, provide, invent, echo, commit, or push credentials, tokens, private keys, passwords, or other sensitive information.
- If Ronny explicitly requires repository-local secret files, store them only under the uppercase root `SECRETS/` directory.
- Keep `/SECRETS/` in the root `.gitignore` at all times.
- Before every commit and push, verify that no sensitive information or files from `SECRETS/` are staged or tracked.
