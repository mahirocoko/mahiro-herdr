# Open adapter integration protocol

Mahiro Herdr provides a read-only Herdr cache adapter (`src/core.mjs`), an optional native Agy statusline quota producer (`src/agy-statusline-producer.mjs`), and a workspace metadata bridge (`src/workspace-metadata.mjs`, v0.4.0+). Since v0.6.0 its canonical registered plugin ID is `mahiro-herdr`; see the README upgrade boundary before migrating an existing installation. Recovery snapshots must not be relabelled to bypass ownership checks.

## Orca adaptation: ownership and capability boundary

Current evidence checked on 2026-10-05: installed Herdr 0.9.3, bundled public API protocol 22/schema 1, plugin manifest action contract, and existing Mahiro consumers. This is an implementation boundary, not proof of new rendered behavior.

| Contract                                               | Current owner                                                         | Integration disposition                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space/project/worktree inventory and grouping          | Herdr workspace/worktree runtime and native TUI                       | Use authoritative identities. The metadata bridge may publish bounded Git facts, not invent repository/worktree topology.                                                                                               |
| Space agent marks and held Done                        | `src/agent-renderer.mjs`, `src/space-renderer-style.mjs`, `src/renderer-runtime.mjs` | Source-faithful mark/name and independently colored vendor-logo/name rows. 27 workspace tokens in ≤16-token patches. Agents remains unchanged. |
| Branch/dirty/linked-worktree and listening ports metadata | `src/workspace-metadata.mjs`                                          | Already implemented; shared allowlisted tokens (`mahiro_workspace_branch`, `mahiro_workspace_git_status`, `mahiro_workspace_worktree`, `mahiro_workspace_ports`) remain stable. Bounded one-shot listener collection and PID-to-Space attribution (`lsof` + `ps` on macOS), no continuous pollers or background daemons. |
| Space listening ports sidebar row configuration       | `src/core.mjs`                                                        | Configures `[ui.sidebar.spaces]` to append an owned listening ports row (`mahiro_workspace_ports`) under the existing reversible snapshot and lock contract, preserving agent rows, symbols setting, and native Space name/branch/git rows. |
| Rename/create/close tabs                               | Herdr `tab.rename`, `tab.create`, `tab.close`                         | Public operations exist; Web must extend its typed/authenticated/target-fenced mutation boundary rather than dispatch arbitrary RPC.                                                                                    |
| Reorder tabs                                           | Herdr `tab.move`                                                      | Public API exists even though the installed tab CLI help has no move command. Reordering is not moving a tab into a split.                                                                                              |
| Split/move panes                                       | Herdr `pane.split`, `pane.move`, `pane.swap`                          | Pane operations exist. Map exact destination and ownership before presenting an Orca-style move-to-split action.                                                                                                        |
| Pin/color tabs and native tab context-menu replacement | Herdr native TUI                                                      | No corresponding pin/color request contract or plugin UI-extension contract established in the inspected public schema/manifest. Do not claim support or patch upstream implicitly.                                     |
| Close others/left/right                                | Composition over Herdr tab inventory/close operations                 | No atomic bulk-close contract established. Freeze membership, confirm destructive scope and handle partial/unknown results before offering these actions; not a repeated close loop over a changing snapshot.           |
| Native project commands                                | Herdr server `[[keys.command]]`; project script owner                 | Declared project-actions action opens a native terminal picker; selected commands open new tabs in the same workspace. Mahiro approved a local prefix+a binding; native interaction acceptance remains pending.         |
| Agent launch                                           | Herdr agent/pane runtime                                              | Keep executable/argv and draft-fill commands distinct. Agent launcher integration is planned, not implemented by the metadata adapter.                                                                                  |
| Editable custom actions and key presets                | Herdr Web                                                             | Existing repo catalog is read-only draft-fill evidence. Personal action storage, validated keys, UI lifecycle and target/auth/lease checks belong to Web, not the quota adapter.                                        |
| Letta lifecycle/model/context                          | Mahiro Mods                                                           | Preserve native lifecycle authority and existing `mahiro_sidebar_*` producer ownership.                                                                                                                                 |
| Codex/Agy/Cursor normalized usage                      | Existing producer contracts; this project's read-only projection      | Keep provider collection outside adapter ownership. No new provider APIs or credentials.                                                                                                                                |
| Main executor/browser routing                          | Canonical `mahiro-skills` direct-cli and browser owners               | Herdr-first preference must retain verified Orca compatibility and system-browser QA ownership.                                                                                                                         |

### Identity migration invariants (v0.6.0)

Mahiro explicitly approved the full `mahiro-herdr` identity migration on 2026-10-06, superseding the earlier display-only boundary. The repository/checkout, plugin registry ID, config owner, executable/import paths, event IDs and metadata source IDs now agree on `mahiro-herdr`. Mahiro Mods uses the new plugin ID and config directory for refresh/snapshot detection, with `MAHIRO_HERDR_SNAPSHOT` as its explicit override. Shared display-token names and normalized-cache schemas remain unchanged; action IDs such as `refresh` and `project-actions` still name their jobs.

The transition must restore/clear/detach the old installation while its original source still validates its snapshot, then register and configure the new source. Archive the old recovery material privately; never relabel it to satisfy the new owner. Preserve unrelated user settings (including the selected `symbols` status style), caches and custom statusline rendering. Update/install consumers and reload active Letta sessions: source/install hash parity alone does not prove a loaded generation has adopted the new identity. The README owns public upgrade instructions; GitHub redirects do not migrate runtime registrations.

Future capabilities must have focused owners outside the read-only adapter. The matrix is not authorization to implement every reference feature: remote file viewing, attachments, voice, transcript UI, message queues and new quota presentation remain separately selectable follow-ups.

### Native command audit (2026-10-06)

Terminal management is now owned by `src/project-action-manager.mjs`: Escape
cancellation, Add/Edit/Delete with explicit confirmation, an empty-project entry
state, literal argv command parsing, exact-byte conflict checks and atomic
project-catalog saves under a PID-plus-nonce directory lock. The CLI revalidates
the frozen project/workspace before each save. Management never executes commands
and does not alter HOME bindings. Malformed/symlinked catalogs remain blocking
errors, not permission to overwrite. This completes the terminal manager scope,
not the graphical editor or native + New Tab extension described below.

**Latest requested entry/management surface:** Mahiro wants to create/edit project
quick actions through GUI and select them from native **+ New Tab**. The accepted
standalone terminal picker and JSON catalog are a working launch proof, not that
GUI. In Herdr 0.9.3, `src/client/shell/mouse.rs` maps the plus button directly to
the core `NewTab` action; the inspected public/plugin contracts do not expose
injection into that chooser or a native non-terminal action editor. Such a change
requires a separately approved upstream extension, not a fabricated plugin API.

The first live shortcut reached the plugin but failed because popup open forbids
explicit workspace/pane targeting (`overlay and popup plugin panes target the
active pane`). The opener now omits those parameters and preserves the original
project/workspace/pane solely in its bounded, revalidated context env. Focused
launcher tests passed 14/14 after correction; Mahiro subsequently reported that
the corrected native entry appeared to work. Later Manage/color interaction and
visual acceptance remain pending. This still does not fulfill the GUI request.

**Current human direction:** project/workspace-specific actions open a **new tab
in that same workspace** and run from the project root. Popup-only checks do not
satisfy this outcome. The opt-in prototype is `src/project-actions.mjs` plus
`bin/mahiro-herdr-actions.mjs`, with a project-owned `.herdr-actions.json` catalog
and a plain terminal picker. It uses `tab create`, validates the returned new
pane and its shell process, submits once with `pane run`, then focuses the tab.
The manifest now declares `project-actions` and the `project-actions-picker`
popup entrypoint. This is a native plugin action/terminal surface, not a new
non-terminal widget or dynamic workspace menu API. The opener passes frozen
original project/workspace/pane context; the popup does not have its own pane ID.
Mahiro accepted the standalone picker and approved the local `prefix+a` binding.
The config and recovery snapshot were backed up, only the applied snapshot was
extended, config validation and server reload passed, and the original uninstall
bytes remain unchanged. Native shortcut/popup interaction acceptance is still
human-owned; source/config checks do not establish it.

Live bounded proof on Herdr 0.9.3 opened tab `w7S:t2` in workspace `w7S` and
ran this project's Test action; all 100 tests passed and the terminal remained
available. The first launcher report exposed a CLI acknowledgement mismatch:
`pane run` succeeds silently rather than returning JSON. The client now accepts
silent exit-status success only for `pane run` and `tab focus`, while creation
and inventory still require JSON receipts. A subsequent single harmless printf
in new tab `w7S:t3` verified the corrected launcher and exact output without
resubmitting either command. Focused checks after that correction passed 12/12
(including rename identity); this is not a claim of a rerun full 101-test suite
or native popup acceptance. That proof preceded the native entrypoint addition.

Native Herdr commands are not Herdr Web's browser-local actions. The installed
Herdr 0.9.3 CLI, bundled protocol 22/schema 1, and version-pinned upstream sources
establish these owners:

- Server configuration owns `[[keys.command]]`: `shell` runs detached, `pane`
  opens a temporary zoomed pane that closes on exit, `popup` opens a session-modal
  terminal, and `plugin_action` invokes a declared plugin action. `description`
  supplies the keybind-help label; this does not prove a separately named native
  "Quick Commands" menu or editable command catalog.
- Plugin manifests own static actions with argv arrays and optional contexts
  (`global`, `workspace`, `tab`, `pane`, `selection`). Runtime action registration
  and native non-terminal plugin UI are explicitly outside plugin v1.
- `command.invoke` accepts an opaque endpoint-issued ID from the client-shell
  projection, not an arbitrary shell command or a caller-invented command ID.
  Upstream rejects stale IDs and inconsistent workspace/tab/pane targets.
- Custom key commands receive `HERDR_ACTIVE_*` target variables; plugin actions
  instead receive `HERDR_PLUGIN_CONTEXT_JSON` and available `HERDR_WORKSPACE_ID`,
  `HERDR_TAB_ID`, `HERDR_PANE_ID`. Plugin commands start in the plugin directory,
  not necessarily the selected project. Do not conflate these environment owners.
- `herdr pane run <pane-id> <command>` sends text and Enter atomically. It is not
  process execution with an idle-shell guarantee. Existing-terminal execution
  requires an explicitly selected, confirmed shell target; never send a project
  command to the currently focused agent merely because it has a pane ID.
- `herdr tab create --workspace <workspace-id> --cwd <absolute-project-path>
--no-focus` and `herdr pane split <pane-id> --cwd <absolute-project-path>
--no-focus` can create a terminal and return its identity. A future launcher
  must use that returned identity, handle unknown launch outcomes without blind
  retries, and not close a terminal it did not create.

This repository currently defines `test` and `check`, not `dev` or `build`.
The previous popup-only Check example is superseded by the new-tab action
direction. The installed local project-action binding is:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "mahiro-herdr.project-actions"
description = "Project quick actions"
```

An existing metadata action can independently be bound without
adding a new action (uninstalled config example, not a project-command launcher):

```toml
[[keys.command]]
key = "prefix+alt+r"
type = "plugin_action"
command = "mahiro-herdr.refresh"
description = "Refresh Mahiro metadata"
```

These keys are examples, not a claim that they are free in a user's configuration.
Validate a copied configuration with `HERDR_CONFIG_PATH` pointing to an isolated
fixture and `herdr config check`; validation does not execute the command or prove
rendered popup behavior. Applying bindings to HOME, reloading the live server,
or adding manifest actions at the registered source root requires a separate
live-change decision. No dev/build command, dynamic native command editor,
native UI widget, or rendered Quick Commands acceptance is claimed here.

Version-pinned evidence:

- [Configuration and execution modes](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/configuration.mdx)
- [Plugin v1 declaration and environment boundary](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/plugins.mdx)
- [Endpoint command IDs and target validation](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/custom_commands.rs)
- [Public command request schema](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/commands.rs)

The core adapter never contacts a provider, never reads credentials, and only projects normalized cache snapshots into Herdr agent rows. Quota snapshots are written to disk by an external integration implementing this protocol directly or calling one of the repository helpers, and pane identity/tokens determine eligible panes.

## Cache location

The default directory is `~/.letta/mods/mahiro-usage` for [Mahiro Mods v0.10.0+](https://github.com/mahirocoko/mods/releases/tag/v0.10.0) Codex-cache compatibility. Set `MAHIRO_HERDR_USAGE_CACHE_DIR` to a non-empty absolute path in the environments that launch both the producer and Herdr server to use another directory. Plugin actions and events inherit that value. The adapter normalizes the path before appending `codex.json`, `agy.json`, or `cursor.json`; relative and empty overrides fail closed.

A producer must create the directory with user-only permissions (`0o700`) and publish each file atomically by writing a sibling temporary regular file (`0o600`) and renaming it into place. The adapter opens final cache files read-only and nonblocking, refuses symlinks and non-regular files, and bounds reads to 64 KiB. The repository-owned Agy helper and Agent Halo's Cursor producer also refuse unsafe targets and never change a shared parent directory's permissions.

## Normalized JSON schema

The cache files use this schema. All time values are Unix epoch milliseconds and `remaining` is percentage points, not a fraction.

```json
{
  "fetched": 1789110000000,
  "failed": false,
  "windows": [
    {
      "label": "Gemini:5h",
      "remaining": 73.5,
      "reset": 1789113600000
    }
  ]
}
```

Required fields:

- `fetched`: finite number from 2020-01-01 onward and no later than the post-read clock.
- `failed`: write `false` for an available snapshot. `true` makes the complete file unavailable. Omission is currently treated like `false` by the adapter, but producers should emit it explicitly.
- `windows`: array of objects.
- `windows[].label`: string matching one of the accepted labels below.
- `windows[].remaining`: finite number in the inclusive range 0 through 100 (percentage points).
- `windows[].reset`: finite epoch-millisecond number from 2020-01-01 through 370 days after the post-read clock.

The top-level value must be a non-null JSON object. Unknown top-level fields are ignored by the reader. Invalid windows are discarded independently; malformed JSON, a failed snapshot, or an invalid top-level freshness shape makes the whole family unavailable.

Accepted labels are exact and case-sensitive:

- `codex.json`: `P:5h`, `P:7d`, `S:7d`. `P:7d` is preferred when both seven-day labels exist. Model-prefixed labels are ignored.
- `agy.json`: `Gemini:5h`, `Gemini:7d`, `Claude-GPT:5h`, `Claude-GPT:7d`.
- `cursor.json`: `Auto`, `API`. `remaining` is percentage points left (`100 - used`). A `Plan` window is ignored.

Codex and Agy caches are usable only before `fetched + 300000 ms - 5000 ms`. Cursor cache freshness is family-specific: it remains usable before `fetched + 3900000 ms - 5000 ms`, covering Agent Halo's configurable maximum 60-minute usage refresh cadence plus headroom while its desktop renderer is running, without introducing another poller. If Agent Halo is absent or refresh fails, that cache expires and Cursor rows clear. A window is displayable only when its reset is more than `5000 ms` reset margin plus `1000 ms` delivery headroom ahead. Herdr metadata expiry is bounded by both family cache freshness and the earliest displayed reset; another `1000 ms` is removed when computing the report TTL. Expired or unusable data produces token clears, never stale quota.

## Agy statusline quota producer (v0.3.0+)

The module `src/agy-statusline-producer.mjs` provides pure normalization (`normalizeAgyQuota`) and atomic publication (`publishAgyQuota`, aliased as `publishAgyStatusline`) for Agy CLI 1.2.2+ environments.

### Input ground truth

Agy CLI 1.2.2 officially delivers a top-level `quota` map to custom `statusLine` commands. Each bucket entry includes:

- `remaining_fraction`: number from 0.0 to 1.0.
- `reset_time`: ISO 8601 string (e.g. `"2026-09-14T05:00:00Z"`).
- `reset_in_seconds`: optional non-negative number of seconds until reset.

Known bucket IDs are mapped to normalized labels in strict fixed order:

1. `gemini-5h` -> `Gemini:5h`
2. `gemini-weekly` -> `Gemini:7d`
3. `3p-5h` -> `Claude-GPT:5h`
4. `3p-weekly` -> `Claude-GPT:7d`

### Normalization rules

- Fractions are converted to percentage points (`remaining_fraction * 100`). Invalid or out-of-range fractions disqualify the bucket.
- Reset calculation accepts a valid ISO 8601 `reset_time` first. If `reset_time` is absent or malformed, it falls back to bounded `reset_in_seconds` (`clock() + reset_in_seconds * 1000`). If neither is valid, the bucket is skipped.
- Unknown bucket IDs and non-quota fields (email, user ID, billing tiers, raw tokens, etc.) are ignored.
- If `quota` is absent, malformed, or produces no valid windows, normalization returns `null` and publication returns unavailable without modifying any existing cache file on disk.

### Publication and deduplication

- Writes only `{ fetched, failed: false, windows }` atomically to `agy.json`.
- Refuses symlinks in every target-path component and non-regular files or directories.
- Sets user-only permissions (`0o600` for files, `0o700` for directories).
- **120-second deduplication**: If the existing cache file is valid and younger than 120 seconds, labels and remaining percentages match, and reset targets differ by no more than 120 seconds, disk write and Herdr refresh are skipped. This treats a bounded `reset_in_seconds` countdown as the same semantic reset window.
- **Changed or aged write**: If semantic windows change or the existing snapshot is 120+ seconds old, the producer writes the updated snapshot and triggers at most one pane-only refresh through `refreshPaneMetadata` only when the runtime has both `HERDR_ENV=1` and a non-empty `HERDR_PANE_ID`. That five-second path never invokes a workspace snapshot, Git inspection, or workspace report; combined pane + workspace reconciliation remains owned by startup, manual, configure, and install refreshes.
- **Fault isolation**: Cache publication success survives Herdr refresh failure; if the refresh call errors or times out, the cache write remains committed and successful.
- **Race safety**: Multiple one-shot statusline processes write to unique temporary files before atomically renaming to `agy.json`. No lock directories or stale locks are deleted.

### Canonical integration seam

In Agy CLI, custom `statusLine` commands render their standard output directly to the interactive terminal status line. A standalone executable that remains silent on stdout would blank out the user's status line.

Therefore, the canonical integration seam is an import-call inside the user's custom statusline script:

```javascript
import { publishAgyStatusline } from '/absolute/path/to/mahiro-herdr/src/agy-statusline-producer.mjs'

// In custom statusline script receiving Agy payload on stdin:
const payload = JSON.parse(stdinText)

// Finish publication before a one-shot statusline process exits.
// Failure stays isolated from the rendered statusline.
await publishAgyStatusline(payload).catch(() => null)

// Render custom statusline text to stdout:
process.stdout.write(renderMyStatusLine(payload))
```

## Pane-token producer contract

Codex quota is eligible only for an inventory entry where:

- `agent` is exactly `letta`, and
- `tokens.mahiro_sidebar_provider` is exactly `openai-codex`.

An external integration such as Mahiro Mods must publish and own that pane token. This adapter reads it only from Herdr's agent inventory and never sets or clears it. It likewise never sets or clears `mahiro_sidebar_model` or `mahiro_sidebar_context`.

Agy quota is eligible only for an inventory entry whose `agent` is exactly `agy` and which is not launch-pending. Agy values are account-level shared pools, not active-session attribution.

Cursor quota is eligible only for an inventory entry whose `agent` is exactly `cursor` and which is not launch-pending. Agent Halo is the canonical trusted producer: its existing direct Cursor provider integration owns credential discovery, token refresh, and current-period usage collection, then publishes only `{ fetched, failed: false, windows }` to `cursor.json`. Valid [0, 100] `autoPercentUsed` and `apiPercentUsed` values become remaining `Auto` and `API` windows in fixed order with the billing-cycle reset. Plan totals, plan name, credits, tokens, credentials, history, and every other provider field must not enter the normalized cache.

At reviewed Cursor Agent version `2026.09.23-86fc751`, the custom statusline payload contains session, model, workspace, and context-window fields but no account usage. Cursor statusline and hooks are therefore not quota sources. This repository remains read-only: it does not invoke Cursor Agent, scrape the interactive `/usage` view, inspect authentication state, contact Cursor, or duplicate Agent Halo's provider integration.

## Space agent renderer boundary

Spaces use native `row_gap = 0` (Mahiro, 2026-10-07): Mahiro tried one blank line between entries, then chose the original compact spacing because native TUI gaps cannot use half-lines. Name/logo/branch/ports and Agents rows remain unchanged.

The renderer source is `mahiro-herdr.renderer`, separate from quota/Git/ports metadata. `src/space-renderer-style.mjs` owns the exact 27-token allowlist, vendor hues and generated rows: state mark beside native `workspace`, glyph + readable vendor names on their own row, native branch/status and ports below. Header has sixteen cells, logos twelve, never exceeding Herdr's sixteen-cell row ceiling. Each report has at most sixteen tokens; patches are sequential/budgeted, and successful chunks are cached separately so spinner ticks do not republish unchanged logos. Full-frame caching commits only after all chunks succeed. Only non-null marks/logos persist, so this roster does not occupy 27 stored keys plus Git/ports. Target is **Spaces**, not Agents. Agents matches fd92029; no pane renderer tokens, headers/title rewrite or sort override. The rejected pane writer was stopped/cleared before migration.

Done tracks completion receipts or working-to-idle/done transitions, bound to pane terminal/agent/session identity. Focus observed on the one-second inventory acknowledges once; leaving a still-done pane does not resurrect it. State persists across restarts and resets for deleted/replaced panes. Every Space includes all its agents across background tabs. Source priority chooses one mark (blocked > working > done > idle > unknown); each vendor is named once independently of state. Working mark is vendor-colored where the nine-color header budget permits, otherwise shared working color; every branded logo keeps its hue on the separate row. Empty Spaces clear all logo/state tokens except a neutral `mh_ws_none` dot, preserving name alignment. Duplicate/orphan workspace membership fails closed. No idle aging, sort/view override or fabricated worktree hierarchy.

The resident updater is the sole approved daemon exception. Its private endpoint bind owns single-instance identity; status/stop check the named owner. No PID-name kill, stale-age takeover or duplicate launch on an unknown endpoint. Publication uses deltas, bounded transport and ten-second TTL; actual cadence is best effort. Stop clears only renderer tokens where possible; TTL covers failures. Restore/uninstall stops it before restoring config.

The font owner is `src/renderer-font.mjs`, with pinned derivative/source fonts, licenses and provenance in `assets/agent-icons`. `tools/build-agent-icon-font.py` adds only Letta's official front-frame mark at U+E1BB and renames the family; upstream outlines stay untouched. Mapping upgrades retain immutable original bytes and a guarded transition preimage. Restore rejects drift and retains shared font bytes. Installation, CoreText resolution, actual native glyph rendering and human visual acceptance are separate gates. Tests never install against real HOME.

## Workspace metadata bridge (v0.4.0+)

The module `src/workspace-metadata.mjs` owns bounded workspace Git facts and listening TCP ports. Git tokens support cross-client consumers; the ports token also renders in native Space rows configured by `src/core.mjs`.

### Ground truth and boundaries

- Herdr 0.9.1 already renders native Space built-ins `branch` and `git_status`, but public workspace snapshots do not expose their values.
- This plugin preserves native Space name, branch and Git status rows and adds one ports metadata row. It does not replace native lifecycle or indicators.
- Canonical source: `mahiro-herdr.workspace`.
- Canonical owned workspace tokens:
  1. `mahiro_workspace_branch`: sanitized/bounded branch name (detached HEAD uses `detached@<short sha>`).
  2. `mahiro_workspace_git_status`: exact `clean` or `dirty`.
  3. `mahiro_workspace_worktree`: bounded linked-worktree label (omitted / cleared if not linked).
  4. `mahiro_workspace_ports`: sorted numeric listening TCP ports, such as `Ports 5173 · 8787`; cleared on empty, failed, ambiguous or unsupported inspection.
- Ports inspection is macOS-only (`/bin/ps`, `/usr/sbin/lsof` and native pane shell PID inspection). Linux retains Git/quota behavior but clears ports. All tabs participate; attribution follows process ancestry, never repository cwd. Reparented or outside-Herdr servers remain unassigned. PID liveness checks are not PID-reuse protection or an atomic ownership snapshot.
- Ports have a three-second collection sub-budget within the existing invocation deadline. Collection failures clear only the ports value, leaving time for Git reports. More than 128 panes fails closed instead of attributing from a truncated inventory.
- Ports refresh only on existing startup/manual/pane events, not immediately on every socket change. Values expire with the metadata TTL; no watcher or daemon is added.
- Configure upgrades only an exact known applied/original configuration under the existing lock, preserving applied-only settings outside the owned sidebar block and immutable original uninstall bytes. Unknown drift or competing Spaces ownership is rejected.
- Subprocess argv without shell is used for Git; no shell interpolation or script wrappers.
- Display-only: values have a bounded TTL (5 minutes by default) so stale facts expire if unattended.
- Sequences use the invocation-wide system-monotonic `u64` sequence shared with pane reports.

### Deterministic repository selection

1. If `workspace.worktree.is_linked_worktree === true` and `workspace.worktree.checkout_path` is a valid absolute path, that directory is selected as the repository cwd, and its basename becomes the worktree label.
2. Otherwise, the active tab layout's focused pane (`foreground_cwd || cwd`) is selected.
3. If the focused pane has no valid cwd, deterministic fallbacks apply in strict order:
   - Non-linked `workspace.worktree.checkout_path` if present on the workspace.
   - Panes in the active tab if all valid cwds resolve to the exact same directory.
   - All panes in the workspace if all valid cwds resolve to the exact same directory.
4. If candidate cwd cannot be determined or if multiple active-tab panes have conflicting directories without a focused pane, repository evidence is ambiguous -> all owned workspace tokens are cleared.

### Path leakage prevention

Token values never leak absolute filesystem paths. Worktree labels are bounded to the directory basename (e.g. `repo-feature-worktree`), and branch names are sanitized and capped at 80 characters.

### Lifecycle coordination & fault isolation

- **Startup / manual refresh**: reconciles all bounded workspaces in addition to pane quota reconciliation.
- **Exact pane events**: reconcile only that explicit inventory-backed pane for quota, and additionally reconcile only that event's exact workspace.
- **Uninstall / restore**: best-effort clears both pane-owned and workspace-owned tokens (`clearOwnedMetadata`).
- **Fault isolation**: failure of workspace metadata inspection or reporting never touches quota cache files (`agy.json`, `codex.json`, `cursor.json`) and never broadens pane token ownership.

## Fail-closed behavior

Missing, stale, oversized, malformed, symlinked, non-regular, future-dated, or explicitly failed caches are unavailable. Unknown providers and labels are not inferred. The adapter sends a complete set-or-clear decision for every token it owns, so unavailable input clears its quota presentation. Errors never trigger credential reads, raw payload reads, pane-content inspection, collection, or network fallback.
