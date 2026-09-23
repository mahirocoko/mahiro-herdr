# Open adapter integration protocol

Mahiro Herdr Sidebar provides a read-only Herdr cache adapter (`src/core.mjs`), an optional native Agy statusline quota producer (`src/agy-statusline-producer.mjs`), and a workspace metadata bridge (`src/workspace-metadata.mjs`, v0.4.0+).

The core adapter never contacts a provider, never reads credentials, and only projects normalized cache snapshots into Herdr agent rows. Quota snapshots are written to disk by an external producer (such as Mahiro Mods or the native Agy producer module), and pane tokens identify eligible panes.

## Cache location

The default directory is `~/.letta/mods/mahiro-usage` for [Mahiro Mods v0.10.0+](https://github.com/mahirocoko/mods/releases/tag/v0.10.0) Codex-cache compatibility. Set `MAHIRO_HERDR_USAGE_CACHE_DIR` to a non-empty absolute path in the environments that launch both the producer and Herdr server to use another directory. Plugin actions and events inherit that value. The adapter normalizes the path before appending `codex.json` or `agy.json`; relative and empty overrides fail closed.

A producer must create the directory with user-only permissions (`0o700`) and publish each file atomically by writing a sibling temporary regular file (`0o600`) and renaming it into place. The adapter opens final cache files read-only and nonblocking, refuses symlinks and non-regular files, and bounds reads to 64 KiB. The Agy producer also refuses unsafe targets and never changes a shared parent directory's permissions.

## Normalized JSON schema

Both `codex.json` and `agy.json` use this schema. All time values are Unix epoch milliseconds and `remaining` is percentage points, not a fraction.

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

A cache is usable only before `fetched + 300000 ms - 5000 ms`. A window is displayable only when its reset is more than `5000 ms` reset margin plus `1000 ms` delivery headroom ahead. Herdr metadata expiry is bounded by both cache freshness and the earliest displayed reset; another `1000 ms` is removed when computing the report TTL. Expired or unusable data produces token clears, never stale quota.

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
- **Fault isolation**: failure of workspace metadata inspection or reporting never touches quota cache files (`agy.json`, `codex.json`) and never broadens pane token ownership.

## Fail-closed behavior

Missing, stale, oversized, malformed, symlinked, non-regular, future-dated, or explicitly failed caches are unavailable. Unknown providers and labels are not inferred. The adapter sends a complete set-or-clear decision for every token it owns, so unavailable input clears its quota presentation. Errors never trigger credential reads, raw payload reads, pane-content inspection, collection, or network fallback.
