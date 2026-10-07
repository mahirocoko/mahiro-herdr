# herdr-radar: Quick Reference

Study date: 2026-10-06. Source: `hhdebb/herdr-radar`, commit `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`, package version 1.4.2.
Evidence: read-only source review; not installed, executed or browser-tested. Reader: repo-scout; synthesized and source-checked by Main.

## Purpose and requirements

Radar provides vendor logos, lifecycle glyphs, activity ordering, workspace/worktree grouping, a directory/branch tab-bar segment, and optional light/dark appearance following. It publishes display metadata rather than changing agents or pane names.

- Herdr 0.9.0+, Node 18+ (package.json; README.md lines 50–97).
- Manifest declares macOS/Linux/Windows; README reports Windows 11/macOS tested, Linux not yet tested.
- npm scripts: check, test, prove, format and format:fix. Prettier is a development dependency, not a runtime dependency.
- Optional Kilo recovery uses read-only node:sqlite only on supported runtimes, including Node 22.12+/23.2+; older versions fall back to plain idle (lib/activity.js).

## Documented installation — not executed

```sh
herdr plugin install hhdebb/herdr-radar
herdr plugin action invoke hhdebb.herdr-radar.state-start
```

Checkout installation uses `herdr plugin link` followed by state-start. Do not interpret these commands as an adoption recommendation. Starting/stopping the entire Herdr server is unnecessary and would terminate pane processes.

## Capability map

| Capability | Source reality |
| --- | --- |
| Animated working indicator | Resident daemon writes changing display tokens; not native widget animation |
| Custom glyphs | Existing states accept `glyphs.<state>` configuration; optional render_hook transforms existing label/title/state/activity inputs |
| Fonts | Per-user icon font; Ghostty/kitty codepoint maps; patched font route for terminals without mappings |
| Activity grouping | Agents/workspaces/worktrees use display grouping and sort metadata |
| Current branch | Reads `.git/HEAD`, including worktree gitdir indirection |
| Git dirty/file/line counts | Not implemented by the Git helper; it explicitly declines dirty detection |
| Space branch/ahead-behind display | Removed from Radar's generated Spaces row (lib/managed-config.js lines 520–530) |
| Listening ports | No discovery/reporting capability evidenced in reviewed bin/lib/manifest/README |

Configuration and hook references: lib/config.js lines 94–131, 167–229; lib/hook.js lines 3–24. Git reference: lib/git.js lines 3–55.

## Side effects and coexistence

Setup manages tab-bar, theme and sidebar blocks, installs fonts and adds mappings to existing Ghostty/kitty configs. This is broader than metadata-only integration. The daemon and private state/control endpoint remain additional operational owners.

Radar owns `[ui.sidebar.agents]`, `[ui.sidebar.agents.rows_by_agent]` and `[ui.sidebar.spaces]`. Foreign tables outside its marker blocks cause it to **skip the entire sidebar block**, not merge or overwrite that owner. Therefore installing alongside Mahiro Herdr would not automatically combine Radar indicators with our quota/ports rows. Both require one deliberately coordinated table owner. Generated rows are bounded to Herdr's 16-token ceiling (lib/managed-config.js lines 69–80, 284–296, 608–646).

Writes are backed up and validated through Herdr's parser. Unconfigure removes owned blocks and restores recorded theme origin where available; fonts have a separate removal action. State/backups remain. This is not the same as Mahiro Herdr's exact original/applied byte snapshot contract.

## Study safety

No installer, startup daemon, formatter or tests were executed. In particular, `npm run prove` deliberately mutates source before restoring it in finally; interruption could leave source dirty (tools/prove-checks.js lines 1–18, 585–626).

## Application to Mahiro Herdr

Radar proves custom animated indicators are possible through resident token updates. It does not prove a native animation API or solve our ports/Git-change-count jobs. Reuse decisions should separate animation cadence, token ownership, config ownership and daemon lifecycle rather than install it as a transparent add-on. Any adoption or animation implementation needs separate human approval.
