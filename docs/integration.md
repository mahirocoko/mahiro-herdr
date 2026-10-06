# Open adapter integration protocol

Mahiro Herdr provides a read-only Herdr cache adapter (`src/core.mjs`), an optional native Agy statusline quota producer (`src/agy-statusline-producer.mjs`), and a workspace metadata bridge (`src/workspace-metadata.mjs`, v0.4.0+). Its registered plugin ID remains `mahiro-herdr-sidebar`; see the README identity boundary before changing installed configuration.

## Orca adaptation: ownership and capability boundary

Current evidence checked on 2026-10-05: installed Herdr 0.9.3, bundled public API protocol 22/schema 1, plugin manifest action contract, and existing Mahiro consumers. This is an implementation boundary, not proof of new rendered behavior.

| Contract                                               | Current owner                                                         | Integration disposition                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space/project/worktree inventory and grouping          | Herdr workspace/worktree runtime and native TUI                       | Use authoritative identities. The metadata bridge may publish bounded Git facts, not invent repository/worktree topology.                                                                                               |
| Working animation and attention                        | Herdr native TUI/status aggregation; agent-specific runtime reporters | Keep Agents anatomy. Native spinner rendering is not a plugin-provided widget API. Space/Tab attention aggregates may prioritize unseen completion over working; any current-activity summary must be separately named. |
| Branch/dirty/linked-worktree metadata for Web          | `src/workspace-metadata.mjs`                                          | Already implemented; shared allowlisted tokens remain stable.                                                                                                                                                           |
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

### Rename invariants

The display/package rename does not change the config owner, usage/workspace sources, registry ID, action IDs, executable/import paths, or config snapshot paths. Mahiro Mods currently uses the exact legacy registry ID for refresh and its config directory for cache-only consumers. Existing recovery/install/uninstall tests continue to bind that same identity and root. No installed config, plugin registration, HOME data or GitHub repository has been migrated by source changes.

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
command = "mahiro-herdr-sidebar.project-actions"
description = "Project quick actions"
```

An existing metadata action can independently be bound without
adding a new action (uninstalled config example, not a project-command launcher):

```toml
[[keys.command]]
key = "prefix+alt+r"
type = "plugin_action"
command = "mahiro-herdr-sidebar.refresh"
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
import { publishAgyStatusline } from '/absolute/path/to/mahiro-herdr-sidebar/src/agy-statusline-producer.mjs'

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

## Workspace metadata bridge (v0.4.0+)

The module `src/workspace-metadata.mjs` implements an allowlisted, bounded cross-client projection of workspace Git facts for Herdr Web.

### Ground truth and boundaries

- Herdr 0.9.1 already renders native Space built-ins `branch` and `git_status`, but public workspace snapshots do not expose their values.
- This plugin does **NOT** replace native Space rendering. It publishes cross-client workspace tokens for web and remote clients.
- Canonical source: `mahiro-herdr-sidebar.workspace`.
- Canonical owned workspace tokens:
  1. `mahiro_workspace_branch`: sanitized/bounded branch name (detached HEAD uses `detached@<short sha>`).
  2. `mahiro_workspace_git_status`: exact `clean` or `dirty`.
  3. `mahiro_workspace_worktree`: bounded linked-worktree label (omitted / cleared if not linked).
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
