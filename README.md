# Mahiro Herdr

MIT-licensed open adapter that projects normalized external usage snapshots into Herdr's Agent sidebar, provides an optional native Agy statusline quota producer module, and publishes workspace Git metadata for Herdr Web. It uses Node.js built-ins only, has no package dependencies, and does not contact providers.

Mahiro Herdr is the integration umbrella; it is not a replacement Herdr runtime or a merged web app. Sidebar projection, workspace metadata, and future supported desktop actions have separate owners. Herdr Web remains a separate project, Mahiro Mods owns Letta lifecycle reporting, and Agent Halo owns Cursor quota collection.

### Identity and existing installations

Since v0.6.0 the product, GitHub repository, package and runtime plugin identity are **Mahiro Herdr / `mahiro-herdr`**. The executable is `bin/mahiro-herdr.mjs`; metadata sources are `mahiro-herdr.usage` and `mahiro-herdr.workspace`; the config/recovery directory is owned by `mahiro-herdr`. Shared display-token names and normalized cache schemas remain unchanged because they are presentation/data contracts, not plugin identity.

**Upgrade from v0.5.0 or earlier:** while the old installation and source are still intact, run `herdr plugin uninstall mahiro-herdr-sidebar` to restore its owned configuration and clear old metadata, then install/configure the new plugin using the commands below. Back up config and verify recovery first; do not relabel the old snapshot or run both plugin IDs concurrently. Update custom keybindings, snapshot overrides (`MAHIRO_HERDR_SNAPSHOT`) and Agy producer import paths to the new identity. Mahiro Mods must also be updated and reloaded. Preserve unrelated config, caches and custom statusline output. The GitHub redirect is not a runtime plugin-ID migration.

The package remains `private: true` to prevent accidental npm publication. Distribution uses Herdr's GitHub plugin installer or a local Git clone; this project is not distributed through npm.

## Prerequisites and support boundary

- [Herdr](https://herdr.dev) 0.9.3 or newer for the current native project-action manifest
- Node.js 22 or newer
- macOS or Linux
- An external cache producer that implements the open adapter protocol, the optional native Agy statusline producer module, or the workspace metadata bridge
- For Codex rows, an external pane-token producer that identifies eligible panes

The source and isolated test suite support macOS and Linux. Listening TCP ports inspection is macOS-only; Linux clears that row while retaining Git/quota behavior. Mahiro has verified installation, configuration, events, refresh, and metadata behavior with Herdr 0.9.0 on macOS. GitHub Actions runs isolated Node 22 tests on `macos-latest` and `ubuntu-latest`; that Linux check does not claim live Herdr runtime integration.

## Install

For a released public version:

```sh
herdr plugin install mahirocoko/mahiro-herdr --ref v0.6.0
herdr plugin action invoke configure --plugin mahiro-herdr
```

To remove that installation, use Herdr's owning uninstall flow. Its manifest action restores the saved sidebar configuration before Herdr removes the plugin:

```sh
herdr plugin uninstall mahiro-herdr
```

For local development or an unreleased checkout:

```sh
git clone https://github.com/mahirocoko/mahiro-herdr.git
cd mahiro-herdr
npm run check
./install.sh
```

The installer checks the JSON plugin registry, refuses the same plugin ID at another or ambiguous root, links a new checkout disabled, configures and reloads Herdr, then enables the plugin. Re-running it from the registered checkout is supported. Reinstall failure restores the exact captured pre-operation config and enabled state when ownership evidence remains safe.

The plugin's Herdr uninstall action is intentionally restore-only because a running plugin must not unlink itself. To fully uninstall a locally linked development checkout, run:

```sh
./uninstall.sh
```

The uninstall script passes its invoking checkout root to the workflow. Before disabling or changing configuration, the workflow verifies that Herdr's single same-ID registration resolves exactly to that root. This prevents an old clone from uninstalling a newer registration.

## Architecture and boundary separation

### Opt-in project actions (v0.6.0+)

Project-specific quick actions now have a plain terminal picker, not a native
menu extension. From a normal Herdr terminal in this Git project, run:

```sh
node bin/mahiro-herdr-actions.mjs
```

Choose **Check** or **Test**. The launcher opens a new tab in the caller's same
workspace, runs the configured argv from the project root, focuses the new tab,
and retains it after completion. It never submits commands to the caller's
existing terminal. Enter on an empty picker answer cancels without creating a tab.
Escape also cancels the picker. Press **M** for Manage: **A** adds, **E** edits a
listed action's title/command, **D** deletes with explicit `yes` confirmation,
and **B** returns to the picker. Escape cancels an unfinished draft; no save or
command execution occurs. Add/Edit also show the exact argv and require `yes`
before saving. IDs stay stable on edits. Commands accept executable arguments
with quoted values, not shell pipes, redirects or variable expansion.
Projects without a catalog show an empty state and let Manage create their first
action. A concurrent file edit refuses to overwrite it; reopen the picker to
load the new state. The editor is terminal UI, not a native graphical editor.
For inspection only, use `node bin/mahiro-herdr-actions.mjs --list`; an explicit
action ID such as `check` skips the picker but still validates the target.
`node bin/mahiro-herdr-actions.mjs --manage` opens Manage directly.

TTY presentation uses the terminal's ANSI palette: yellow action shortcuts,
gray secondary command/ID text, green save feedback and red delete/error cues.
Body text and backgrounds remain theme-owned. Redirected output, `TERM=dumb`
and any `NO_COLOR` value (including empty) disable styling. Color supplements
explicit labels; exact contrast depends on the terminal theme and is not
claimed from ANSI codes alone.

The project owns its `.herdr-actions.json` file. Use version `1` and an `actions`
array containing unique `id`, readable `title`, and non-empty `argv` arrays.
Commands are trusted executable configuration, not downloaded suggestions.
No Dev/Build command is invented for this repo, and there is no native
per-workspace action editor yet.
Launching can succeed before a response is lost: if an error names a retained
tab/pane, inspect that exact target before retrying; the prototype never retries
or closes tabs automatically. See the integration protocol for the native boundary.

The manifest now declares **Project quick actions** (`project-actions`) and a
native popup terminal picker (`project-actions-picker`). The popup only selects
an action; commands still execute in new tabs, never in the popup or an existing
agent pane. The opener freezes the original project/pane/workspace context so a
popup without a pane ID cannot accidentally use the plugin's checkout.

Mahiro's local binding is **Ctrl+B, then A** (`prefix+a`). It was explicitly
approved and applied with config/snapshot backups and validated reload. It is
not installed automatically for other users. The standalone picker was accepted
by Mahiro, who subsequently reported the corrected native entry appeared to work.
The later Manage and color additions still need his full interaction/visual check.

This repository provides four distinct components:

1. **Read-only Herdr Adapter (`src/core.mjs`)**: The core plugin runtime. It reads normalized `codex.json`, `agy.json`, and `cursor.json` cache files and projects them into Herdr agent sidebar rows. It never writes to cache files, never collects provider data, and makes no network requests.
2. **Optional Agy Statusline Quota Producer (`src/agy-statusline-producer.mjs`)**: An opt-in helper module for Agy CLI users. It consumes already-delivered statusline payloads, normalizes the quota map, and publishes snapshots atomically to `agy.json`. It never reads credentials, email, plan tier, transcripts, sessions, or raw provider payloads, never invokes `agy -p`, and makes no network requests.
3. **Workspace Metadata Bridge (`src/workspace-metadata.mjs`, v0.4.0+)**: A focused module publishing a bounded, allowlisted cross-client projection of Git and listening port metadata for Herdr Web and sidebar display without replacing native Space rendering. It observes `herdr api snapshot`, inspects Git repository evidence deterministically, collects listening TCP ports per Space via bounded one-shot process-tree attribution (`lsof` + `ps` on macOS), and reports workspace metadata (`mahiro_workspace_branch`, `mahiro_workspace_git_status`, `mahiro_workspace_worktree`, `mahiro_workspace_ports`) via `herdr workspace report-metadata`.

4. **Space Agent Renderer (`src/agent-renderer.mjs`, `src/renderer-runtime.mjs`)**: Space header shows the native name only, with no summary status/dot. Below it each pane gets one row with independently colored status and glyph/vendor-name cells; empty rows collapse. Eight slots follow native order without vendor deduplication/sorting; overflow uses the final slot for a remaining-agent count. Native highlight, branch/Git/ports, gap0 and Agents remain unchanged. Sixteen allowlisted inline tokens fit one ≤16-token patch per workspace, with delta/renewal caching, TTL10s, snapshots1s and nominal250ms animation. No lifecycle/history/theme/order changes.

### Renderer lifecycle and optional font

Live configure and startup start the updater. `renderer-start` and `renderer-stop` are native actions. Stopping hides renderer-owned state marks and logos after token expiry, not the native Space name/branch/Git status/ports or Agents panel. Unknown/stale control endpoints are reported, never force-reclaimed by guessed PID or age.

`renderer-font` installs the pinned derivative icon font and one owned mapping in an existing macOS Ghostty config, with exact original/applied recovery. The immutable original survives mapping-generation upgrades; a bounded previous-applied journal supports interrupted upgrades. It does not change the main font or install patched JetBrains Mono. Radar's MIT font is extended at U+E1BB with a faithful outline of Letta Code's official static front-frame mark (Apache-2.0), not a guessed logo; notices/provenance are under `assets/agent-icons`. The build-only generator uses isolated fonttools, not a runtime dependency. Unconfigured platforms keep explicitly generic glyph + readable vendor fallback. Successful installation is not live-render acceptance; reload/native glyph inspection is required. Restore rejects drift and retains shared font bytes.

## Open adapter inputs

By default, the adapter reads:

- `~/.letta/mods/mahiro-usage/codex.json`
- `~/.letta/mods/mahiro-usage/agy.json`
- `~/.letta/mods/mahiro-usage/cursor.json`

The default preserves compatibility with [Mahiro Mods v0.10.0+](https://github.com/mahirocoko/mods/releases/tag/v0.10.0), the reference producer for model/context/provider metadata and the normalized Codex cache. Agy quota now comes from the optional Agy statusline producer below or another external producer. To use another cache root, set `MAHIRO_HERDR_USAGE_CACHE_DIR` to a non-empty absolute directory path in the environments that launch both the producer and Herdr server; plugin actions and events inherit it. Relative or empty overrides fail closed.

External producers own their collection and normalization. The optional Agy helper owns only normalization and publication of the already-delivered statusline `quota` map. Agent Halo is the canonical trusted Cursor collector and publishes only normalized `Auto` and `API` windows to `cursor.json`; this adapter does not duplicate its credential or provider-network logic. The adapter only reads bounded normalized JSON and never reads credentials or raw provider payloads. Codex publication additionally requires the pane inventory token `mahiro_sidebar_provider=openai-codex`; that token must be produced and owned externally. Agy values are labeled `Agy shared pools` because they are account-level shared pools, not active-session attribution. Cursor values are labeled `Cursor auto` and `Cursor api` on live `cursor` panes.

Codex and Agy snapshots remain usable for five minutes. Cursor snapshots remain usable for 65 minutes, covering Agent Halo's configurable maximum 60-minute usage refresh cadence plus delivery headroom while its desktop renderer is running, without adding another poller. If Agent Halo is not running or refresh fails, the cache expires and Cursor rows clear.

Cursor quota support requires Mahiro Herdr v0.5.0+ (released under the Mahiro Herdr Sidebar name) and Agent Halo v0.1.15+ as the trusted producer.

See [Open adapter integration protocol](docs/integration.md) for the exact JSON schema, milliseconds/percentage units, accepted labels, freshness and reset margins, pane-token contract, and fail-closed rules.

## Optional Agy statusline quota producer (v0.3.0+)

The module `src/agy-statusline-producer.mjs` exports pure normalization and atomic publication for Agy CLI 1.2.2+ environments:

- **Input ground truth**: In Agy CLI 1.2.2, custom statusline commands receive a top-level `quota` map with bucket IDs `gemini-5h`, `gemini-weekly`, `3p-5h`, and `3p-weekly`.
- **Pure normalization (`normalizeAgyQuota`)**: Maps the four exact IDs to `Gemini:5h`, `Gemini:7d`, `Claude-GPT:5h`, and `Claude-GPT:7d` in strict fixed order. Converts `remaining_fraction` to percentage points [0, 100], parses ISO 8601 `reset_time` with bounded `reset_in_seconds` fallback, and ignores unknown buckets and non-quota fields. If quota is absent or invalid, it returns `null` without touching the cache.
- **Atomic publication (`publishAgyQuota` / `publishAgyStatusline`)**: Writes `{ fetched, failed: false, windows }` atomically to `agy.json` using unique temporary files and atomic rename. Enforces user-only permissions (`0o600` file, `0o700` dir) and refuses symlinks in every path component or non-regular targets/directories.
- **120-second deduplication**: If the existing cache is valid and younger than 120 seconds, labels and remaining percentages match, and reset targets differ by no more than the same 120-second window, disk write and Herdr refresh are skipped. The reset tolerance prevents `reset_in_seconds` countdown payloads from becoming false changes.
- **Changed or aged write**: If semantic windows change or the existing snapshot is 120+ seconds old, the producer writes the updated snapshot and triggers at most one Herdr refresh only when the runtime has both `HERDR_ENV=1` and a non-empty `HERDR_PANE_ID`. The default runtime refresh path has a five-second deadline; cache success survives its failure.
- **Concurrency**: Multiple one-shot statusline processes race safely via unique temporary files and atomic rename without locks or destructive state.
- **Canonical integration seam**: Because Agy statusline commands render stdout directly to the terminal, a silent standalone binary would erase the user's custom statusline. The canonical integration is an import-call inside the user's custom statusline script:

```javascript
import { publishAgyStatusline } from '/absolute/path/to/mahiro-herdr/src/agy-statusline-producer.mjs'

// Receive payload from Agy CLI via stdin:
const payload = JSON.parse(stdinText)

// Finish publication before a one-shot statusline process exits.
// Failure stays isolated from the rendered statusline.
await publishAgyStatusline(payload).catch(() => null)

// Render custom statusline text to stdout:
process.stdout.write(renderStatusLine(payload))
```

## Runtime behavior

Startup and manual refresh are stateless one-shot reconciliations. They read the agent inventory and live session snapshot once, reject inventories above 128 deduplicated panes or workspaces, and send one complete owned-token patch to every selected pane and workspace. Repeated refreshes intentionally republish. Exact Herdr events reconcile only their explicit inventory-backed pane and that event's exact workspace; invalid events make no Herdr calls.

Each invocation captures one system-monotonic sequence before inventory and uses it for every report. Mahiro's live Herdr 0.9.0 macOS verification confirmed that lower and equal sequences are silently ignored and metadata TTL expires from accepted publication time.

The configured Agents rows retain native state/location/agent, model/context, Agy shared-pool, quota and summary rows. Space rows retain native name/branch/Git status and ports, plus a dedicated agent-logo/spinner/status row owned by the renderer. Quota/Git/ports metadata remains one-shot and separate from the animation owner. The adapter never clears `mahiro_sidebar_model`, `mahiro_sidebar_context`, or `mahiro_sidebar_provider`.

Quota/workspace invocations are short-lived Node processes with a 30-second deadline. Each Herdr subprocess is limited to five seconds and 256 KiB output. These adapters add no watcher/daemon/history reads. The separate agent renderer is the explicitly approved resident-updater exception, and does not expand their ownership or refresh policy.

## Configuration safety and recovery

Configuration snapshots bind the exact absolute config path and preserve original bytes, existence, regular-file/non-symlink status, and mode. Configure and restore accept only known original/applied states. Drift, path mismatch, equivalent or descendant agent-sidebar tables, escaped keys, and ambiguous ownership fail closed.

Config changes are serialized by PID-plus-nonce lock directories. A lock is reclaimed only after an operating-system `ESRCH` liveness proof; malformed, ownerless, live, permission-denied, reused, or otherwise ambiguous ownership is never forced.

If uninstall's unlink command reports failure, the workflow reads the registry again:

- If the same-ID entry is absent, uninstall succeeded and returns success.
- If the same-ID entry still resolves to the invoking root, the workflow restores the exact captured config and enabled state where safe, then reports the unlink failure.
- If registration is another-root or ambiguous, it performs no recovery mutation and fails with evidence preserved.

On a failed install or uninstall, read the complete error before retrying. Do not delete the plugin config directory or snapshot evidence. Resolve registry-root conflicts by running the script from the checkout shown by `herdr plugin list --json`. Resolve config drift manually before retrying; the adapter will not overwrite an unknown sidebar owner. A metadata-clear failure is non-destructive because Herdr TTL remains the fallback.

## Privacy and security model

The trust boundary is local and narrow: Herdr inventory, three normalized cache files, plugin-owned recovery evidence, and Herdr's CLI. Cache files are opened nonblocking without following final-component symlinks and are bounded to 64 KiB. Values and identifiers are validated and output is sanitized and bounded. No secrets are required by CI or by this adapter.

External collectors remain outside this repository's trust and lifecycle boundary. The optional Agy helper is inside the repository boundary but accepts only the documented statusline object and publishes only its normalized allowlist. Agent Halo owns Cursor collection and publication outside this repository. Keep cache directories user-readable only, publish snapshots atomically, and never place credentials or raw provider responses in the normalized files.

## Development

```sh
npm test
npm run check
bash -n install.sh uninstall.sh
git diff --check
```

Tests isolate HOME, cache, Herdr configuration, and a stub Herdr executable. They do not mutate a live Herdr installation.

## Non-goals

This repository does not contact providers, poll Agy or Cursor, invoke `agy -p` or Cursor Agent, scrape Cursor's `/usage` UI, inspect panes, attribute shared Agy quota to a session, manage Mahiro Mods, manage credentials, install upstream plugins, expose settings, emit alerts, reorder agents, or perform live installation and visual acceptance as part of source development.

The design was informed by `levi-qiao/herdr-agent-quota` at reviewed commit `0540feb1d51bb7618f94f02aa804493614b1ba0d`; no claim is made that its source was copied.
