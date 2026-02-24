# Warden

Scaffold for a repo monitoring CLI that collects git stats, staleness data, and maintenance debt markers into structured snapshots.

## Setup

```bash
pnpm install
pnpm warden --help
```

## Planned commands

- `warden init <path>`
- `warden collect [--repo <slug>]`
- `warden report [--repo <slug>]`

See `IM06-warden-phase-1.md` for the implementation sequence.
