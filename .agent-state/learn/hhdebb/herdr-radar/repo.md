# herdr-radar Learning Index

## Source

- GitHub: https://github.com/hhdebb/herdr-radar
- Origin: ./origin/ (ignored symlink to the read-only ghq clone)
- Studied commit: `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`, version 1.4.2
- Current source/code outranks this dated study. No install, daemon, tests or browser were run.

## Explorations

### 2026-10-06 2206 — default, three read-only readers

- [Architecture](2026-10-06/2206_ARCHITECTURE.md)
- [Implementation patterns](2026-10-06/2206_CODE-SNIPPETS.md)
- [Quick reference](2026-10-06/2206_QUICK-REFERENCE.md)

Main reviewed and synthesized reports, checked animation constants, Git boundaries, current event subscriptions and foreign-table guards, and verified the source SHA/worktree remained unchanged.

## Key insights

1. Custom animated indicators are implemented through a resident daemon and changing metadata tokens at a nominal 150 ms cadence, not a native animation widget API.
2. Current branch comes from direct HEAD reads for a cached tab-bar line; dirty/file/line counts and ports discovery are not evidenced capabilities.
3. Radar skips sidebar configuration when foreign Agents/Spaces tables exist. It does not automatically merge with Mahiro Herdr's quota/ports rows.
4. Radar's daemon, font/theme side effects and optional local session-record reads are broader than Mahiro Herdr's current integration boundaries. Source patterns can be studied without adopting those owners.

## Next decision — not authorized implementation

For future indicator work, decide whether animation is worth a resident updater and coordinate one sidebar table owner before writing. For Git change counts, design an explicit Git inspection owner instead of treating Radar's branch reader as an existing solution. Current ports behavior remains unchanged.
