# herdr-radar: Architecture

Source commit: `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`, version 1.4.2. Study: 2026-10-06, default three-reader mode. External source remained clean. No runtime/plugin/test/install execution. Reader: repo-scout; synthesis and contradiction checks: Main.

## Owner map

| Owner | Responsibility |
| --- | --- |
| herdr-plugin.toml | Registration, setup/build, startup commands, actions, agent-detected watchdog |
| bin/agent-state.js | First-start setup, endpoint health check, confirmed stalled-daemon replacement and detached launch |
| lib/daemon.js | Resident process, timers, event subscription, control endpoint and shutdown |
| lib/frame.js | Current presentation, state transitions, changed-token writes, sorting/grouping and workspace marks |
| lib/state.js | Inventory normalization, labels, glyph/title composition and metadata projection |
| lib/activity.js | Persisted activity timestamps and optional CLI-record recovery |
| lib/managed-config.js | Generated tab-bar/theme/sidebar blocks and foreign-table checks |
| lib/config.js | Plugin-local settings parsed at startup |
| lib/herdr.js + lib/ipc.js | Herdr API adapter, bounded socket calls and CLI transport fallback |
| lib/control.js | Separate daemon ping/stop/view endpoint and instance ownership |
| lib/git.js + lib/tabline.js | Focused-directory branch reading and cached tab-bar line |
| lib/font.js + dist | Per-user fonts and terminal codepoint mapping |

## Runtime flow

1. Installation setup configures permitted managed blocks and fonts. Startup/state-start performs idempotent setup checks and starts the resident daemon. Setup/build and daemon launch are distinct operations.
2. Daemon binds its control endpoint. The endpoint is instance-lock authority; a PID file alone is not enough to prove daemon identity or progress.
3. Herdr event subscription sends wake hints. Each frame reads a fresh agent.list snapshot, derives display state and publishes only token deltas. Failed inventory is null, not an authoritative empty list.
4. Active working animation uses a nominal 150 ms cadence. A 120 ms scheduling floor, 50 ms wake debounce, two-second heartbeat and 30-second catch-all deadline serve different scheduling jobs.
5. Two-second tab-line refresh and periodic appearance checks run alongside frames. Config/state watchers provide other wake hints.
6. Normal state-stop clears marks but retains titles/sort keys; uninstall uses purge for all Radar tokens. These are different cleanup contracts.

References: bin/agent-state.js lines 6–75; lib/daemon.js lines 33–42, 117–177, 181–238, 289–357; lib/frame.js lines 117–214, 464–543, 622–665.

## Two sockets, two configurations

The Herdr socket owns native inventory/metadata APIs. Radar's own control socket owns daemon ping, stop and view commands. They are not interchangeable. Herdr transport uses newline-delimited JSON and bounded concurrency, with CLI fallback on transport failure (lib/herdr.js lines 18–45, 127–153, 179–245; lib/ipc.js lines 18–68).

Herdr config receives managed tab-bar/theme/sidebar blocks. Plugin-local config contains Radar settings, parsed once per process; saving settings restarts the daemon. Managed writes back up, validate via Herdr and roll back unparsable output; symlink resolution is explicit in the atomic writer (lib/managed-config.js; lib/toml-blocks.js lines 222–239; bin/settings.js lines 441–482).

Foreign theme/sidebar tables are detected outside Radar markers. Radar skips its sidebar block rather than merging another plugin's Agents/Spaces tables. This means automatic coexistence with Mahiro Herdr's rows is not established, even though both publish metadata.

## State authority versus presentation

Herdr agent_status is the input; Radar is not a replacement agent detector. Presentation adds held done marks until focus, blocked glyph behavior and age-based idle tiers. Activity timestamps survive daemon restarts. Optional recovery reads timestamps from Claude/Codex session records or a Kilo SQLite row when read-only SQLite support is safe. This scope differs from Mahiro Herdr's prohibition on session/transcript reads and cannot be copied wholesale into that owner.

Events exclude pane.updated and workspace.metadata_updated to avoid feedback from Radar's own writes. Status-specific/lifecycle/focus/name events remain, and reconnect triggers resync. Comments about historical update-event loops must not be mistaken for the current subscription list (lib/subscribe.js lines 18–55).

## Git surfaces are intentionally different

- Agent/worktree grouping uses Herdr workspace labels and repo_key/linked-worktree metadata; it does not obtain that topology by polling Git. Workspace movement is optional and off by default (lib/workspace-order.js).
- Tab-bar branch reads the focused foreground cwd and .git/HEAD, including .git pointer files and detached HEAD. This avoids spawning git on the two-second cache refresh. It explicitly does not inspect working-tree dirty state, changed files or line totals (lib/git.js lines 3–58).
- Herdr's tab-bar command reads the cached line at its separately configured interval. Branch cache refresh is not immediate visible paint; the default status-command interval introduces additional delay (lib/managed-config.js lines 147–193).
- Generated Radar Spaces rows deliberately omit branch/ahead-behind information in favor of agent status marks. A tab-bar branch feature is not a Space dirty/change-count feature.

## Dependencies and evidence limits

Node 18 minimum, no package runtime dependencies, Prettier development dependency. Fonts are committed outputs with Python build/check tooling. Manifest platforms are macOS/Windows/Linux; README says macOS and Windows tested, Linux not yet tested. Optional activity recovery has stronger Node version requirements than the base plugin.

Tests/CI were source-inspected only. The proof harness mutates source and restores it in finally; it was not run. No CPU/RAM/cadence smoothness or live compatibility measurement was obtained.

## Application boundaries

Radar is evidence for custom animated token presentation, not for a native animation API, ports discovery or Git change counts. Its resident daemon, raw socket transport, font setup, activity-record recovery and managed theme/sidebar configuration are separate choices that require explicit ownership and approval before adapting them into Mahiro Herdr. Preserve our accepted ports/quota rows and existing no-daemon contract until the human deliberately reopens that scope.
